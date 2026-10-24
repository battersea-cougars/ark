// Passkeys (ADR 0023): a member adds one on the You page ("Use Face ID next time"), and from then on signs in with
// their face, finger or PIN, no email needed: for when Gmail is down, a new code would be one too many, or the inbox is
// on another phone. The emailed code stays for a first sign-in, a new phone, or a lost passkey. Driven through the
// real handlers in the fake world, with a fake authenticator that signs real WebAuthn responses
// (testing.authenticator.ts, ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Pat Plain", position: "D", rating: 40, email: "pat@example.com" },
];
// The fake world's team app is at https://team.test: its passkeys belong to team.test
const ORIGIN = "https://team.test";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Browser = ReturnType<ReturnType<typeof testWorld>["browser"]>;
type Device = ReturnType<ReturnType<typeof testWorld>["authenticator"]>;

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** On the You page: "Use Face ID next time", the device's own question, and it's added. */
async function addPasskey(b: Browser, device: Device, ua = IPHONE, now = NOW) {
  const options = await b.call(
    "POST",
    "/api/auth/passkeys/register-options",
    {},
    { now, headers: { "user-agent": ua } },
  );
  expect(options.status).toBe(200);
  return b.call(
    "POST",
    "/api/auth/passkeys/register",
    { response: device.create(options.body.options, ORIGIN) },
    { now, headers: { "user-agent": ua } },
  );
}
/** On the sign-in page: "Sign in with a passkey", and the device's face check. */
async function passkeyOptions(b: Browser, now = NOW) {
  const r = await b.call("POST", "/api/auth/passkeys/sign-in-options", {}, { now });
  expect(r.status).toBe(200);
  return r.body.options;
}
const signInWith = (b: Browser, response: Json, now = NOW) =>
  b.call("POST", "/api/auth/passkeys/sign-in", { response }, { now });
async function passkeySignIn(device: Device, b = w.browser(), now = NOW) {
  const res = await signInWith(b, device.get(await passkeyOptions(b, now), ORIGIN), now);
  return { b, res };
}
const myPasskeys = async (b: Browser) => (await b.call("GET", "/api/auth/passkeys")).body.passkeys as Json[];
const record = (action: string) =>
  (w.db.raw.prepare("SELECT member_id, detail FROM audit_log WHERE action = ? ORDER BY id").all(action) as Json[]).map(
    (r) => ({ memberId: r.member_id, ...JSON.parse(r.detail) }),
  );
const idOf = (email: string) =>
  (w.db.raw.prepare("SELECT id FROM members WHERE email = ?").get(email) as { id: number }).id;
const sessions = () => (w.db.raw.prepare("SELECT count(*) n FROM auth_sessions").get() as { n: number }).n;

describe("a member adds a passkey, and signs in with it next time", () => {
  it("an iPhone's Face ID: added on the You page, named for the phone, then a sign-in with no email at all", async () => {
    const reg = await w.signedIn("reg@example.com");
    const phone = w.authenticator();
    const added = await addPasskey(reg, phone);
    expect(added.status).toBe(200);
    expect(await myPasskeys(reg)).toEqual([
      expect.objectContaining({ name: "iPhone · iCloud Keychain", createdAt: NOW.toISOString(), lastUsedAt: null }),
    ]);
    const mailsBefore = w.mails.length;

    // The next day, a new browser on the same phone: no email, no code
    const { b, res } = await passkeySignIn(phone, w.browser(), minutes(24 * 60));
    expect(res.status).toBe(200);
    expect((await b.club({ now: minutes(24 * 60) })).status).toBe(200);
    expect(w.mails.length).toBe(mailsBefore);
    expect(record("sign_in").at(-1)).toEqual({ memberId: idOf("reg@example.com"), method: "passkey" });
    expect((await myPasskeys(b))[0].lastUsedAt).toBe(minutes(24 * 60).toISOString());
  });

  it("Windows Hello's RS256 works as well as a phone's ES256", async () => {
    const pat = await w.signedIn("pat@example.com");
    const laptop = w.authenticator({ alg: "RS256", synced: false });
    expect((await addPasskey(pat, laptop, WINDOWS)).status).toBe(200);
    expect((await myPasskeys(pat))[0].name).toBe("Windows");
    expect((await passkeySignIn(laptop)).res.status).toBe(200);
    expect((await passkeySignIn(laptop)).res.status).toBe(200);
  });

  it("asks for a discoverable passkey with the face check, and never adds the same one twice", async () => {
    const reg = await w.signedIn("reg@example.com");
    const phone = w.authenticator();
    await addPasskey(reg, phone);
    const { options } = (await reg.call("POST", "/api/auth/passkeys/register-options")).body;
    expect(options.rp).toEqual({ id: "team.test", name: "Battersea Cougars" });
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(options.pubKeyCredParams.map((p: Json) => p.alg)).toEqual([-7, -257]);
    // The member is a random handle, not their number or email; their other passkeys are listed so the phone says
    // it has one already
    expect(options.user.id).toBe(phone.passkeys[0].userHandle);
    expect(options.user.id).not.toMatch(/reg|^\d+$/);
    expect(options.excludeCredentials).toHaveLength(1);
    expect(() => phone.create(options, ORIGIN)).toThrow("already registered");
  });

  it("is only for someone signed in, and the challenge only for the sign-in that asked", async () => {
    expect((await w.browser().call("POST", "/api/auth/passkeys/register-options")).status).toBe(401);
    const reg = await w.signedIn("reg@example.com");
    const pat = await w.signedIn("pat@example.com");
    const { options } = (await reg.call("POST", "/api/auth/passkeys/register-options")).body;
    // Pat can't put a passkey on Reg's account with Reg's challenge, nor on her own
    const res = await pat.call("POST", "/api/auth/passkeys/register", {
      response: w.authenticator().create(options, ORIGIN),
    });
    expect(res.status).toBe(400);
    expect(w.db.raw.prepare("SELECT count(*) n FROM passkeys").get()).toEqual({ n: 0 });
  });

  it("refuses a passkey made without the face check, or for another site", async () => {
    const reg = await w.signedIn("reg@example.com");
    for (const misbehave of [{ noVerification: true }, { origin: "https://evil.test" }]) {
      const { options } = (await reg.call("POST", "/api/auth/passkeys/register-options")).body;
      const res = await reg.call("POST", "/api/auth/passkeys/register", {
        response: w.authenticator().create(options, ORIGIN, misbehave),
      });
      expect(res.status).toBe(400);
    }
    expect(await myPasskeys(reg)).toEqual([]);
  });
});

describe("a passkey's sign-in is refused when it should be", () => {
  let phone: Device;
  beforeEach(async () => {
    phone = w.authenticator();
    await addPasskey(await w.signedIn("reg@example.com"), phone);
  });

  it("a challenge works once: the same response sent again signs no one in", async () => {
    const b = w.browser();
    const response = phone.get(await passkeyOptions(b), ORIGIN);
    expect((await signInWith(b, response)).status).toBe(200);
    const again = w.browser();
    for (const [k, v] of b.jar) if (k.includes("passkey")) again.jar.set(k, v);
    expect((await signInWith(b, response)).status).toBe(400);
    expect((await signInWith(again, response)).status).toBe(400);
  });

  it("only in the browser that asked, and only for five minutes", async () => {
    const asked = w.browser();
    const response = phone.get(await passkeyOptions(asked), ORIGIN);
    // Another browser (a phishing page relaying the reply) has no nonce for it
    expect((await signInWith(w.browser(), response)).status).toBe(400);
    // Too late
    const late = w.browser();
    const slow = phone.get(await passkeyOptions(late), ORIGIN);
    expect((await signInWith(late, slow, minutes(6))).status).toBe(400);
    // ...but in time, in the browser that asked, it's fine
    expect((await signInWith(asked, response)).status).toBe(200);
  });

  it("a response signed for another challenge, another site, or without the face check", async () => {
    for (const misbehave of [
      { challenge: Buffer.from("not the one the club sent").toString("base64url") },
      { origin: "https://evil.test" },
      { noVerification: true },
    ]) {
      const b = w.browser();
      expect((await signInWith(b, phone.get(await passkeyOptions(b), ORIGIN, misbehave))).status).toBe(400);
    }
    expect(record("sign_in").filter((r) => r.method === "passkey")).toEqual([]);
  });

  it("a removed passkey: the member takes it off on the You page, and it signs no one in", async () => {
    const reg = (await passkeySignIn(phone)).b;
    const [key] = await myPasskeys(reg);
    // Nobody else can take it off
    const pat = await w.signedIn("pat@example.com");
    expect((await pat.call("DELETE", `/api/auth/passkeys/${key.id}`)).status).toBe(404);
    expect((await reg.call("DELETE", `/api/auth/passkeys/${key.id}`)).status).toBe(200);
    expect(await myPasskeys(reg)).toEqual([]);
    const { res } = await passkeySignIn(phone);
    expect(res.status).toBe(400);
    // The phone is told it's gone, so it stops offering it
    expect(res.body.unknownCredential).toBe(true);
    // Signed in still (removing a passkey isn't signing out)
    expect((await reg.club()).status).toBe(200);
  });

  it("an inactive member: refused, and being made inactive takes their passkeys away", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = (await dana.club()).body.members.find((m: Json) => m.name === "Reg Player");
    const b = w.browser();
    const response = phone.get(await passkeyOptions(b), ORIGIN);
    expect((await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, status: "inactive" })).status).toBe(200);
    expect((await signInWith(b, response)).status).toBe(400);
    expect(w.db.raw.prepare("SELECT count(*) n FROM passkeys").get()).toEqual({ n: 0 });
    // Let back in: the code, then a passkey again if they like
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, status: "active" });
    expect((await passkeySignIn(phone)).res.status).toBe(400);
  });

  it("an inactive member whose passkey is somehow still there is refused all the same", async () => {
    w.db.raw.prepare("UPDATE members SET status = 'inactive' WHERE email = 'reg@example.com'").run();
    const before = sessions();
    expect((await passkeySignIn(phone)).res.status).toBe(400);
    expect(sessions()).toBe(before);
  });

  it("a copy of a passkey whose counter has fallen behind is refused (a clone)", async () => {
    const key = w.authenticator({ synced: false });
    await addPasskey(await w.signedIn("pat@example.com"), key, WINDOWS);
    const [copied] = key.copy();
    expect((await passkeySignIn(key)).res.status).toBe(200);
    expect((await passkeySignIn(key)).res.status).toBe(200);
    // The copy signs with the counter it had when it was copied (1, after the club saw 2)
    const b = w.browser();
    const res = await signInWith(b, key.get(await passkeyOptions(b), ORIGIN, { passkey: { ...copied, counter: 0 } }));
    expect(res.status).toBe(400);
    expect(record("sign_in.passkey_cloned")).toEqual([expect.objectContaining({ memberId: idOf("pat@example.com") })]);
  });
});

describe("what a passkey has to do with signing out", () => {
  it("sign out everywhere ends sessions, not passkeys: the member signs in again with their face", async () => {
    const phone = w.authenticator();
    const reg = await w.signedIn("reg@example.com");
    await addPasskey(reg, phone);
    expect((await reg.call("POST", "/api/auth/sign-out-everywhere")).status).toBe(200);
    expect((await reg.club()).status).toBe(401);
    expect((await passkeySignIn(phone)).res.status).toBe(200);
  });

  it("a new sign-in email takes the passkeys with the sessions: whoever had the account before is out", async () => {
    const phone = w.authenticator();
    await addPasskey(await w.signedIn("reg@example.com"), phone);
    const dana = await w.signedIn("dana@example.com");
    await dana.call("PUT", `/api/members/${idOf("reg@example.com")}/contact`, {
      email: "reg.new@example.com",
      phone: "",
    });
    expect((await passkeySignIn(phone)).res.status).toBe(400);
  });

  it("deleting your account deletes your passkeys", async () => {
    const reg = await w.signedIn("reg@example.com");
    await addPasskey(reg, w.authenticator());
    expect((await reg.call("DELETE", "/api/me")).status).toBe(200);
    expect(w.db.raw.prepare("SELECT count(*) n FROM passkeys").get()).toEqual({ n: 0 });
  });
});

describe("an admin and a member's passkeys, from their sheet", () => {
  it("sees them by device and date, and removes them all: on the record, and they sign in with a code", async () => {
    const phone = w.authenticator();
    const laptop = w.authenticator({ alg: "RS256", synced: false });
    const reg = await w.signedIn("reg@example.com");
    await addPasskey(reg, phone);
    await addPasskey(reg, laptop, WINDOWS, minutes(60));
    const dana = await w.signedIn("dana@example.com");
    const id = idOf("reg@example.com");
    const seen = await dana.call("GET", `/api/members/${id}/passkeys`);
    expect(seen.status).toBe(200);
    expect(seen.body.passkeys.map((p: Json) => [p.name, p.createdAt])).toEqual([
      ["iPhone · iCloud Keychain", NOW.toISOString()],
      ["Windows", minutes(60).toISOString()],
    ]);
    // Nobody who doesn't manage members
    const pat = await w.signedIn("pat@example.com");
    expect((await pat.call("GET", `/api/members/${id}/passkeys`)).status).toBe(403);
    expect((await pat.call("DELETE", `/api/members/${id}/passkeys`)).status).toBe(403);

    expect((await dana.call("DELETE", `/api/members/${id}/passkeys`)).status).toBe(200);
    expect((await passkeySignIn(phone)).res.status).toBe(400);
    expect((await passkeySignIn(laptop)).res.status).toBe(400);
    expect(record("member.passkeys_removed")).toEqual([
      expect.objectContaining({ memberId: idOf("reg@example.com"), from: { passkeys: 2 }, to: { passkeys: 0 } }),
    ]);
    // Their sign-ins aren't touched: that's Sign out everywhere's job
    expect((await reg.club()).status).toBe(200);
  });

  it("never an admin's, for someone who only manages members", async () => {
    const dana = await w.signedIn("dana@example.com");
    await addPasskey(dana, w.authenticator());
    const { id: roleId } = (
      await dana.call("POST", "/api/roles", { name: "Helper", description: "", actions: ["manage:Member"] })
    ).body;
    expect(roleId).toBeGreaterThan(0);
    const reg = (await dana.club()).body.members.find((m: Json) => m.name === "Reg Player");
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, roles: ["Helper", "Member"] });
    const helper = await w.signedIn("reg@example.com");
    expect((await helper.call("DELETE", `/api/members/${idOf("dana@example.com")}/passkeys`)).status).toBe(403);
  });
});
