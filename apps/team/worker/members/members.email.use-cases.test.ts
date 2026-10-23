// A member changes their own sign-in email (ADR 0023): a code to the new address, typed back while signed in. What
// they've done stays theirs, the old address hears of it, and an address that's someone else's never becomes theirs.
// Driven through the real handler in the fake world (testing.ts, ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  w = testWorld(ROSTER);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const emailOf = (id: number) =>
  (w.db.raw.prepare("SELECT email FROM members WHERE id = ?").get(id) as { email: string | null }).email;
const idOf = (email: string) =>
  (w.db.raw.prepare("SELECT id FROM members WHERE email = ?").get(email) as { id: number }).id;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const ask = (b: Browser, email: string, now?: Date) => b.call("POST", "/api/me/email", { email }, { now });
const confirm = (b: Browser, code: string, now?: Date) => b.call("POST", "/api/me/email/confirm", { code }, { now });

describe("changing your own email", () => {
  it("Reg asks for a code to his new address, types it, and signs in with it from then on, his history kept", async () => {
    const reg = await w.signedIn("reg@example.com");
    const id = idOf("reg@example.com");
    const asked = await ask(reg, "  Reg.New@Example.com ");
    expect(asked.status).toBe(200);
    expect(asked.body.devCode).toMatch(/^\d{6}$/);
    expect(emailOf(id)).toBe("reg@example.com");

    const done = await confirm(reg, asked.body.devCode);
    expect(done.status).toBe(200);
    expect(emailOf(id)).toBe("reg.new@example.com");
    // Same member, same id: everything that points at him still does
    expect(idOf("reg.new@example.com")).toBe(id);
    // This browser stays signed in
    expect((await reg.call("GET", "/api/bootstrap")).status).toBe(200);
    // The old address hears it
    // (outside production the safe inbox gets it, its subject saying who for: packages/shared/email.ts)
    const told = w.mails.find((m) => m.subject.endsWith("Your Cougars sign-in email has changed"));
    expect(told?.subject).toContain("reg@example.com");
    expect(told?.text).toContain("reg.new@example.com");
    // On the record, as an admin's change is
    const entry = w.db.raw.prepare("SELECT detail FROM audit_log WHERE action = 'member.email'").get() as {
      detail: string;
    };
    expect(JSON.parse(entry.detail)).toMatchObject({ from: "reg@example.com", to: "reg.new@example.com" });
    // The new address signs in; the old one no longer does
    expect((await w.ask(w.browser(), "reg.new@example.com")).devCode).toMatch(/^\d{6}$/);
    expect((await w.ask(w.browser(), "reg@example.com")).devCode).toBeUndefined();
  });

  it("his other sign-ins end, and this one stays", async () => {
    const phone = await w.signedIn("reg@example.com");
    const laptop = await w.signedIn("reg@example.com");
    const { devCode } = (await ask(phone, "reg.new@example.com")).body;
    expect((await confirm(phone, devCode)).status).toBe(200);
    expect((await phone.call("GET", "/api/bootstrap")).status).toBe(200);
    expect((await laptop.call("GET", "/api/bootstrap")).status).toBe(401);
  });

  it("asking for an address that's someone else's sends no code, says the same, and tells that inbox why", async () => {
    const reg = await w.signedIn("reg@example.com");
    const asked = await ask(reg, "dana@example.com");
    expect(asked.status).toBe(200);
    expect(asked.body.devCode).toBeUndefined();
    expect(asked.body.message).toBe(
      "If dana@example.com can be yours, a code is on its way there. It works for 15 minutes.",
    );
    expect(w.mails.at(-1)?.subject).toMatch(/dana@example\.com.*This email is already on a Cougars account$/);
    expect((await confirm(reg, "000000")).status).toBe(400);
    expect(emailOf(idOf("reg@example.com"))).toBe("reg@example.com");
  });

  it("an address given to someone else after the code went isn't his", async () => {
    const reg = await w.signedIn("reg@example.com");
    const { devCode } = (await ask(reg, "shared@example.com")).body;
    w.db.raw.prepare("UPDATE members SET email = 'shared@example.com' WHERE email = 'dana@example.com'").run();
    const r = await confirm(reg, devCode);
    expect(r.status).toBe(409);
    expect(emailOf(idOf("reg@example.com"))).toBe("reg@example.com");
  });

  it("his own address again is refused, saying it's already his", async () => {
    const r = await ask(await w.signedIn("reg@example.com"), "REG@example.com");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("That's already your email.");
  });

  it("a wrong code says how many tries are left, and five wrong ones spend it", async () => {
    const reg = await w.signedIn("reg@example.com");
    const { devCode } = (await ask(reg, "reg.new@example.com")).body;
    const wrong = devCode === "000000" ? "111111" : "000000";
    expect((await confirm(reg, wrong)).body.error).toBe("That's not the code. 4 tries left.");
    for (let i = 0; i < 4; i++) await confirm(reg, wrong);
    expect((await confirm(reg, devCode)).status).toBe(400);
    expect(emailOf(idOf("reg@example.com"))).toBe("reg@example.com");
  });

  it("a code works for 15 minutes, and only once", async () => {
    const reg = await w.signedIn("reg@example.com");
    const late = (await ask(reg, "late@example.com")).body.devCode;
    expect((await confirm(reg, late, minutes(16))).status).toBe(400);
    const { devCode } = (await ask(reg, "reg.new@example.com", minutes(20))).body;
    expect((await confirm(reg, devCode, minutes(21))).status).toBe(200);
    expect((await confirm(reg, devCode, minutes(22))).status).toBe(400);
  });

  it("asking again spends the code before, so only the latest address can become his", async () => {
    const reg = await w.signedIn("reg@example.com");
    const first = (await ask(reg, "first@example.com")).body.devCode;
    const second = (await ask(reg, "second@example.com")).body.devCode;
    if (first !== second) expect((await confirm(reg, first)).status).toBe(400);
    expect((await confirm(reg, second)).status).toBe(200);
    expect(emailOf(idOf("second@example.com"))).toBe("second@example.com");
  });

  it("five codes an hour is plenty: the sixth waits", async () => {
    const reg = await w.signedIn("reg@example.com");
    for (let i = 0; i < 5; i++) expect((await ask(reg, `try${i}@example.com`)).status).toBe(200);
    expect((await ask(reg, "try5@example.com")).status).toBe(429);
    expect((await ask(reg, "try5@example.com", minutes(61))).status).toBe(200);
  });

  it("someone else's code can't change his email: codes belong to who asked", async () => {
    const reg = await w.signedIn("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    const { devCode } = (await ask(reg, "reg.new@example.com")).body;
    expect((await confirm(dana, devCode)).status).toBe(400);
    expect(emailOf(idOf("dana@example.com"))).toBe("dana@example.com");
  });

  it("an admin changing his email meanwhile spends the code he asked for", async () => {
    const reg = await w.signedIn("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    const id = idOf("reg@example.com");
    const { devCode } = (await ask(reg, "reg.mine@example.com")).body;
    expect((await dana.call("PUT", `/api/members/${id}/contact`, { email: "reg.admin@example.com" })).status).toBe(200);
    // The admin's change signed him out; signed in again, his old code is gone
    const again = await w.signedIn("reg.admin@example.com");
    expect((await confirm(again, devCode)).status).toBe(400);
    expect(emailOf(id)).toBe("reg.admin@example.com");
  });
});
