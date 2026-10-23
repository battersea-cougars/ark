// Sessions ending (#72, ADR 0023): an admin signs a member out everywhere from their sheet, a member does it for
// themselves on the You page, and a new sign-in email or being made inactive does it on its own. An ended session's
// phones stop hearing from the club and its live pages close. A session in use gets a new token as it's renewed, and
// ends a year after signing in however much it's used. Driven through the real handlers (testing.ts, ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Pat Plain", position: "D", rating: 40, email: "pat@example.com" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const DAY = 24 * 60;
const memberNamed = async (b: { call: Awaited<ReturnType<typeof w.signedIn>>["call"] }, name: string) =>
  (await b.call("GET", "/api/bootstrap")).body.members.find((m: Json) => m.name === name);
const phones = () =>
  (w.db.raw.prepare("SELECT token FROM push_devices ORDER BY token").all() as Json[]).map((r) => r.token);
const record = (action: string) =>
  (w.db.raw.prepare("SELECT detail FROM audit_log WHERE action = ? ORDER BY id").all(action) as Json[]).map((r) =>
    JSON.parse(r.detail),
  );
/** A second browser holding the same cookies: someone who copied them. */
const copyOf = (b: ReturnType<typeof w.browser>) => {
  const copy = w.browser();
  for (const [k, v] of b.jar) copy.jar.set(k, v);
  return copy;
};

describe("an admin signs a member out everywhere, from their sheet", () => {
  it("every browser and phone they're on: their notifications stop, their live page closes, on the record", async () => {
    const dana = await w.signedIn("dana@example.com");
    const phone = await w.listening("reg@example.com");
    const laptop = await w.signedIn("reg@example.com");
    expect((await phone.call("PUT", "/api/auth/device", { token: "regs-iphone", platform: "ios" })).status).toBe(200);
    const pat = await w.signedIn("pat@example.com");
    await pat.call("PUT", "/api/auth/device", { token: "pats-pixel", platform: "android" });
    const reg = await memberNamed(dana, "Reg Player");

    expect((await dana.call("POST", `/api/members/${reg.id}/sign-out`)).status).toBe(200);

    expect((await phone.call("GET", "/api/bootstrap")).status).toBe(401);
    expect((await laptop.call("GET", "/api/bootstrap")).status).toBe(401);
    await expect(phone.next()).rejects.toThrow("the stream ended");
    expect(phones()).toEqual(["pats-pixel"]);
    // Nobody else is touched
    expect((await pat.call("GET", "/api/bootstrap")).status).toBe(200);
    expect(record("member.signed_out")).toEqual([{ memberId: reg.id, from: { sessions: 2 }, to: { sessions: 0 } }]);
    // They come back the usual way, with a code
    expect((await (await w.signedIn("reg@example.com")).call("GET", "/api/bootstrap")).status).toBe(200);
  });

  it("only for someone who manages members, and never for someone who can do more than them", async () => {
    const dana = await w.signedIn("dana@example.com");
    const pat = await w.signedIn("pat@example.com");
    const reg = await memberNamed(dana, "Reg Player");
    const admin = await memberNamed(dana, "Dana Admin");
    expect((await pat.call("POST", `/api/members/${reg.id}/sign-out`)).status).toBe(403);
    // Reg, made a member manager, can't sign an admin out
    const { id: roleId } = (
      await dana.call("POST", "/api/roles", { name: "Helper", description: "", actions: ["manage:Member"] })
    ).body;
    expect(roleId).toBeGreaterThan(0);
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, roles: ["Helper", "Member"] });
    const helper = await w.signedIn("reg@example.com");
    expect((await helper.call("POST", `/api/members/${admin.id}/sign-out`)).status).toBe(403);
    expect((await dana.call("GET", "/api/bootstrap")).status).toBe(200);
    expect((await dana.call("POST", "/api/members/999/sign-out")).status).toBe(404);
  });
});

describe("what signs a member out on its own", () => {
  it("a new sign-in email: whoever was in as them with the old one is out; a new phone number isn't", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await w.signedIn("reg@example.com");
    const { id } = await memberNamed(dana, "Reg Player");
    await dana.call("PUT", `/api/members/${id}/contact`, { email: "reg@example.com", phone: "07700 900001" });
    expect((await reg.call("GET", "/api/bootstrap")).status).toBe(200);
    await dana.call("PUT", `/api/members/${id}/contact`, { email: "reg.new@example.com", phone: "07700 900001" });
    expect((await reg.call("GET", "/api/bootstrap")).status).toBe(401);
    expect((await (await w.signedIn("reg.new@example.com")).call("GET", "/api/bootstrap")).status).toBe(200);
  });

  it("being made inactive, so letting them back in opens none of their old sign-ins", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await w.signedIn("reg@example.com");
    await reg.call("PUT", "/api/auth/device", { token: "regs-iphone", platform: "ios" });
    const m = await memberNamed(dana, "Reg Player");
    await dana.call("PUT", `/api/members/${m.id}`, { ...m, status: "inactive", roles: ["Member"] });
    expect(phones()).toEqual([]);
    await dana.call("PUT", `/api/members/${m.id}`, { ...m, status: "active", roles: ["Member"] });
    expect((await reg.call("GET", "/api/bootstrap")).status).toBe(401);
  });
});

describe("signing yourself out", () => {
  it("of this device: its phone stops hearing from the club; your other devices stay in", async () => {
    const phone = await w.signedIn("reg@example.com");
    const laptop = await w.signedIn("reg@example.com");
    await phone.call("PUT", "/api/auth/device", { token: "regs-iphone", platform: "ios" });
    expect((await phone.call("POST", "/api/auth/sign-out")).status).toBe(200);
    expect(phones()).toEqual([]);
    expect((await phone.call("GET", "/api/bootstrap")).status).toBe(401);
    expect((await laptop.call("GET", "/api/bootstrap")).status).toBe(200);
  });

  it("everywhere, from the You page: every browser and phone of yours, this one too, and nobody else's", async () => {
    const phone = await w.signedIn("reg@example.com");
    const laptop = await w.listening("reg@example.com");
    const pat = await w.signedIn("pat@example.com");
    expect((await phone.call("POST", "/api/auth/sign-out-everywhere")).status).toBe(200);
    expect((await phone.call("GET", "/api/bootstrap")).status).toBe(401);
    expect((await laptop.call("GET", "/api/bootstrap")).status).toBe(401);
    await expect(laptop.next()).rejects.toThrow("the stream ended");
    expect((await pat.call("GET", "/api/bootstrap")).status).toBe(200);
    expect(record("sign_out")).toEqual([{ everywhere: true, sessions: 2 }]);
  });
});

describe("a session as it's used (#72)", () => {
  it("gets a new token when it's renewed, and a copy of the old one stops working minutes later", async () => {
    const phone = await w.signedIn("reg@example.com");
    const stolen = copyOf(phone);
    const before = phone.jar.get("__Host-cougars_session");
    // A day on, the session is renewed: a new cookie, with the new token
    const renewed = await phone.call("GET", "/api/bootstrap", undefined, { now: minutes(DAY + 1) });
    expect(renewed.status).toBe(200);
    expect(renewed.headers.getSetCookie().join()).toMatch(/__Host-cougars_session=.+Max-Age=15552000/);
    expect(phone.jar.get("__Host-cougars_session")).not.toBe(before);
    // Requests already on their way with the old one still land
    expect((await stolen.call("GET", "/api/bootstrap", undefined, { now: minutes(DAY + 3) })).status).toBe(200);
    // ...but not for long
    expect((await stolen.call("GET", "/api/bootstrap", undefined, { now: minutes(DAY + 30) })).status).toBe(401);
    expect((await phone.call("GET", "/api/bootstrap", undefined, { now: minutes(DAY + 30) })).status).toBe(200);
  });

  it("renews once when two requests arrive together with the token that's due", async () => {
    const phone = await w.signedIn("reg@example.com");
    const tab = copyOf(phone);
    const at = { now: minutes(DAY + 1) };
    const [a, b] = await Promise.all([
      phone.call("GET", "/api/bootstrap", undefined, at),
      tab.call("GET", "/api/bootstrap", undefined, at),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const set = [a, b].filter((r) => r.headers.getSetCookie().length).length;
    expect(set).toBe(1);
  });

  it("ends a year after signing in, however much it's used", async () => {
    const phone = await w.signedIn("reg@example.com");
    for (let day = 30; day <= 360; day += 30)
      expect((await phone.call("GET", "/api/bootstrap", undefined, { now: minutes(day * DAY) })).status).toBe(200);
    expect((await phone.call("GET", "/api/bootstrap", undefined, { now: minutes(366 * DAY) })).status).toBe(401);
  });

  it("isn't renewed by a request in the same day", async () => {
    const phone = await w.signedIn("reg@example.com");
    const r = await phone.call("GET", "/api/bootstrap", undefined, { now: new Date(NOW.getTime() + 3600_000) });
    expect(r.headers.getSetCookie()).toEqual([]);
  });
});
