// Someone asks to join the club in the app (ADR 0069): the admins hear about it at once, by email, with a link to the
// member's sheet; once an admin lets them in, the member hears too, with the way in. Outside production every email
// goes only to the allowed addresses (ADR 0027), and Gmail sits behind its breaker (ADR 0055). Driven through the real
// handlers in the fake world (ADR 0031); with no Gmail in tests, the emails are captured.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const asks = () =>
  w.browser().call("POST", "/api/auth/request", { name: "Nina New", email: "nina@example.com", position: "F" });

describe("someone asks to join", () => {
  it("the admins get an email at once, with a link to the member's sheet", async () => {
    expect((await asks()).status).toBe(200);
    const dana = await w.signedIn("dana@example.com");
    const nina = (await dana.club()).body.members.find((m: Json) => m.name === "Nina New");
    const mail = w.mails.find((m) => /Nina New/.test(m.subject))!;
    expect(mail).toBeTruthy();
    expect(mail.subject).toMatch(/asking to join/i);
    expect(mail.text).toContain(`https://team.test/settings/members?member=${nina.id}`);
  });

  it("asking twice with the same email sends nothing more", async () => {
    await asks();
    const before = w.mails.length;
    await asks();
    expect(w.mails.length).toBe(before);
  });

  it("once an admin lets them in, they get “You're in” with the way to sign in", async () => {
    await asks();
    const dana = await w.signedIn("dana@example.com");
    const nina = (await dana.club()).body.members.find((m: Json) => m.name === "Nina New");
    expect(
      (await dana.call("PUT", `/api/members/${nina.id}`, { ...nina, status: "active", roles: ["Member"] })).status,
    ).toBe(200);
    const mail = w.mails.at(-1)!;
    expect(mail.subject).toMatch(/You're in/);
    expect(mail.text).toContain("https://team.test/?email=nina%40example.com");
  });

  it("an edit that doesn't let anyone in sends nothing", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = (await dana.club()).body.members.find((m: Json) => m.name === "Reg Player");
    const before = w.mails.length;
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, rating: 61, roles: ["Member"] });
    expect(w.mails.length).toBe(before);
  });
});
