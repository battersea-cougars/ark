// A member changes their own sign-in email (ADR 0023): codes to both addresses, typed back while signed in. Driven
// through the real handler in the fake world (testing.ts, ADR 0031).
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
type Codes = { devCode?: string; devCurrentCode?: string };
/** Both codes, as typed on the sheet: the current address's and the new one's. */
const confirm = (b: Browser, codes: Codes, now?: Date) =>
  b.call("POST", "/api/me/email/confirm", { code: codes.devCode, currentCode: codes.devCurrentCode }, { now });
const other = (code: string) => (code === "000000" ? "111111" : "000000");

describe("changing your own email", () => {
  it("Reg asks for a code to his new address, types it, and signs in with it from then on, his history kept", async () => {
    const reg = await w.signedIn("reg@example.com");
    const id = idOf("reg@example.com");
    const asked = await ask(reg, "  Reg.New@Example.com ");
    expect(asked.status).toBe(200);
    expect(asked.body.devCode).toMatch(/^\d{6}$/);
    expect(emailOf(id)).toBe("reg@example.com");

    expect(asked.body.devCurrentCode).toMatch(/^\d{6}$/);
    const done = await confirm(reg, asked.body);
    expect(done.status).toBe(200);
    expect(emailOf(id)).toBe("reg.new@example.com");
    // Same member, same id: everything that points at him still does
    expect(idOf("reg.new@example.com")).toBe(id);
    // This browser stays signed in
    expect((await reg.club()).status).toBe(200);
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
    const codes = (await ask(phone, "reg.new@example.com")).body;
    expect((await confirm(phone, codes)).status).toBe(200);
    expect((await phone.club()).status).toBe(200);
    expect((await laptop.club()).status).toBe(401);
  });

  it("asking for an address that's someone else's sends no code, says the same, and tells that inbox why", async () => {
    const reg = await w.signedIn("reg@example.com");
    const asked = await ask(reg, "dana@example.com");
    expect(asked.status).toBe(200);
    expect(asked.body.devCode).toBeUndefined();
    expect(asked.body.message).toBe(
      "If dana@example.com can be yours, a code is on its way there, and another to the address you have now. Each works for 15 minutes.",
    );
    expect(w.mails.at(-1)?.subject).toMatch(/dana@example\.com.*This email is already on a Cougars account$/);
    expect((await confirm(reg, { devCode: "000000", devCurrentCode: asked.body.devCurrentCode })).status).toBe(400);
    expect(emailOf(idOf("reg@example.com"))).toBe("reg@example.com");
  });

  it("an address given to someone else after the code went isn't his", async () => {
    const reg = await w.signedIn("reg@example.com");
    const codes = (await ask(reg, "shared@example.com")).body;
    w.db.raw.prepare("UPDATE members SET email = 'shared@example.com' WHERE email = 'dana@example.com'").run();
    const r = await confirm(reg, codes);
    expect(r.status).toBe(409);
    expect(emailOf(idOf("reg@example.com"))).toBe("reg@example.com");
  });

  it("his own address again is refused, saying it's already his", async () => {
    const r = await ask(await w.signedIn("reg@example.com"), "REG@example.com");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("That's already your email.");
  });

  it("a wrong code says which and how many tries are left, and five wrong guesses spend the change", async () => {
    const reg = await w.signedIn("reg@example.com");
    const codes = (await ask(reg, "reg.new@example.com")).body;
    const wrongNew = { ...codes, devCode: other(codes.devCode) };
    const wrongCurrent = { ...codes, devCurrentCode: other(codes.devCurrentCode) };
    expect((await confirm(reg, wrongNew)).body.error).toBe(
      "The code sent to reg.new@example.com isn't right. 4 tries left.",
    );
    expect((await confirm(reg, wrongCurrent)).body.error).toBe(
      "The code sent to reg@example.com isn't right. 3 tries left.",
    );
    for (let i = 0; i < 3; i++) await confirm(reg, i % 2 ? wrongNew : wrongCurrent);
    expect((await confirm(reg, codes)).status).toBe(400);
    expect(emailOf(idOf("reg@example.com"))).toBe("reg@example.com");
  });

  it("a code works for 15 minutes, and only once", async () => {
    const reg = await w.signedIn("reg@example.com");
    const late = (await ask(reg, "late@example.com")).body;
    expect((await confirm(reg, late, minutes(16))).status).toBe(400);
    const codes = (await ask(reg, "reg.new@example.com", minutes(20))).body;
    expect((await confirm(reg, codes, minutes(21))).status).toBe(200);
    expect((await confirm(reg, codes, minutes(22))).status).toBe(400);
  });

  it("asking again spends the code before, so only the latest address can become his", async () => {
    const reg = await w.signedIn("reg@example.com");
    const first = (await ask(reg, "first@example.com")).body;
    const second = (await ask(reg, "second@example.com")).body;
    if (first.devCode !== second.devCode) expect((await confirm(reg, first)).status).toBe(400);
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
    const codes = (await ask(reg, "reg.new@example.com")).body;
    expect((await confirm(dana, codes)).status).toBe(400);
    expect(emailOf(idOf("dana@example.com"))).toBe("dana@example.com");
  });

  it("an admin changing his email meanwhile spends the code he asked for", async () => {
    const reg = await w.signedIn("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    const id = idOf("reg@example.com");
    const codes = (await ask(reg, "reg.mine@example.com")).body;
    expect((await dana.call("PUT", `/api/members/${id}/contact`, { email: "reg.admin@example.com" })).status).toBe(200);
    // The admin's change signed him out; signed in again, his old codes are gone
    const again = await w.signedIn("reg.admin@example.com");
    expect((await confirm(again, codes)).status).toBe(400);
    expect(emailOf(id)).toBe("reg.admin@example.com");
  });
});

describe("a stolen session can't move the account (security review finding 16)", () => {
  const IVY = [...ROSTER, { name: "Ivy Winger", position: "F", rating: 70, email: "ivy@example.com" }];
  beforeEach(() => {
    w = testWorld(IVY);
  });
  /** Off a local server the codes are emailed: each one's subject ends with it, and says who it was for. */
  const emailed = () => Object.assign(w.env, { TEAM_ENV: undefined, SITE_ENV: "dev", MAIL_SAFE_TO: "dev@example.com" });
  const codeIn = (to: string, subject: RegExp) => {
    const mail = w.mails.findLast((m) => m.subject.includes(to) && subject.test(m.subject));
    return { mail, code: mail?.subject.match(/(\d{6})$/)?.[1] };
  };

  it("Ivy's session is stolen: the thief gets the new address's code, but can't confirm without the one sent to Ivy's inbox; Ivy keeps her account", async () => {
    const stolen = await w.signedIn("ivy@example.com");
    const ivy = await w.signedIn("ivy@example.com");
    const id = idOf("ivy@example.com");
    emailed();
    expect((await ask(stolen, "thief@example.com")).status).toBe(200);
    // The thief reads their own inbox...
    const theirs = codeIn("thief@example.com", /email change code: \d{6}$/).code!;
    expect(theirs).toMatch(/^\d{6}$/);
    // ...and Ivy's inbox hears of it, with a code of its own, the new address half hidden
    const warning = codeIn("ivy@example.com", /\d{6}$/);
    expect(warning.code).toMatch(/^\d{6}$/);
    expect(warning.mail?.text).toContain("t***@example.com");
    expect(warning.mail?.text).not.toContain("thief@example.com");
    expect(warning.mail?.text).toMatch(/If it wasn't .*ignore this/i);

    // Without Ivy's code, or guessing it, nothing changes
    expect((await stolen.call("POST", "/api/me/email/confirm", { code: theirs })).status).toBe(400);
    for (let i = 0; i < 4; i++)
      await stolen.call("POST", "/api/me/email/confirm", { code: theirs, currentCode: other(warning.code!) });
    // Five guesses spent the change: even the right pair is too late now
    const both = { code: theirs, currentCode: warning.code };
    expect((await stolen.call("POST", "/api/me/email/confirm", both)).status).toBe(400);
    expect(emailOf(id)).toBe("ivy@example.com");
    expect((await ivy.club()).status).toBe(200);
  });

  it("Ivy changes her own email with both codes, the one from her current inbox and the new one's", async () => {
    const ivy = await w.signedIn("ivy@example.com");
    const id = idOf("ivy@example.com");
    emailed();
    expect((await ask(ivy, "ivy.new@example.com")).status).toBe(200);
    const current = codeIn("ivy@example.com", /\d{6}$/).code;
    const fresh = codeIn("ivy.new@example.com", /email change code: \d{6}$/).code;
    expect(current).not.toBeUndefined();
    const done = await ivy.call("POST", "/api/me/email/confirm", { code: fresh, currentCode: current });
    expect(done.status).toBe(200);
    expect(emailOf(id)).toBe("ivy.new@example.com");
    // Her old inbox is still told it happened
    expect(
      w.mails.some((m) => m.subject.endsWith("Your Cougars sign-in email has changed") && m.subject.includes("ivy@")),
    ).toBe(true);
  });

  it("an address that's someone else's still gets Ivy's inbox a code, and the reply is the same", async () => {
    const ivy = await w.signedIn("ivy@example.com");
    emailed();
    const mine = await ask(ivy, "ivy.new@example.com");
    const taken = await ask(ivy, "dana@example.com", minutes(1));
    expect(taken.status).toBe(mine.status);
    expect(taken.body.message).toBe(mine.body.message.replace("ivy.new@", "dana@"));
    expect(Object.keys(taken.body).sort()).toEqual(Object.keys(mine.body).sort());
  });

  it("a member with no email needs only the new address's code", async () => {
    const ivy = await w.signedIn("ivy@example.com");
    const id = idOf("ivy@example.com");
    w.db.raw.prepare("UPDATE members SET email = NULL WHERE id = ?").run(id);
    const asked = await ask(ivy, "ivy.found@example.com");
    expect(asked.status).toBe(200);
    expect(asked.body.devCurrentCode).toBeUndefined();
    expect(asked.body.message).toBe(
      "If ivy.found@example.com can be yours, a code is on its way there. It works for 15 minutes.",
    );
    expect((await confirm(ivy, asked.body)).status).toBe(200);
    expect(emailOf(id)).toBe("ivy.found@example.com");
  });

  it("an admin changing a member's email on the member's page still needs no code", async () => {
    const dana = await w.signedIn("dana@example.com");
    const id = idOf("ivy@example.com");
    expect((await dana.call("PUT", `/api/members/${id}/contact`, { email: "ivy.lost@example.com" })).status).toBe(200);
    expect(emailOf(id)).toBe("ivy.lost@example.com");
  });
});
