// Break glass (ADR 0023): Gmail is down, every admin has lost their passkeys and none is signed in, so nobody can let
// anyone in. Someone with the club's Bitwarden and Cloudflare runs `npm run admin:break-glass -- <admin's email>` at
// a terminal: it writes one sign-in code for that admin (scripts/lib/break-glass.mjs) and prints it there, never by
// email. The admin types their email and that code on the usual sign-in page. The first browser to ask for that
// admin's code claims it, and from there it's a code like any other: 15 minutes, once, five wrong tries. Every step
// is on the record, and every admin hears of it (their phone, their email if it's working, and a line on Home), with
// a way to sign that session out. Driven through the real handlers in the fake world, the script's own module
// writing to the same D1.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, humanToken, minutes, testWorld } from "../testing";
import { issueBreakGlass } from "../../../../scripts/lib/break-glass.mjs";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Alex Admin", position: "F", rating: 70, email: "alex@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Browser = ReturnType<ReturnType<typeof testWorld>["browser"]>;

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** The script, at the operator's terminal, against this world's D1 (rows back, as D1's API gives them). */
const breakGlass = (email: string, now = NOW) =>
  issueBreakGlass(
    async (sql: string, params: unknown[] = []) => {
      const statement = w.db.prepare(sql).bind(...params);
      return /^\s*SELECT/i.test(sql)
        ? (await statement.all<Record<string, unknown>>()).results
        : (await statement.run(), []);
    },
    { email, now, by: "operator@laptop" },
  );
/** The sign-in page: their email, then the code. */
async function signIn(b: Browser, email: string, code: string, now = NOW) {
  const asked = await b.call("POST", "/api/auth/start", { email, turnstile: humanToken("sign-in") }, { now });
  expect(asked.status).toBe(200);
  return { asked: asked.body, res: await b.call("POST", "/api/auth/verify", { code }, { now }) };
}
const record = (action: string) =>
  (w.db.raw.prepare("SELECT member_id, detail FROM audit_log WHERE action = ? ORDER BY id").all(action) as Json[]).map(
    (r) => ({ memberId: r.member_id, ...JSON.parse(r.detail) }),
  );
const idOf = (email: string) =>
  (w.db.raw.prepare("SELECT id FROM members WHERE email = ?").get(email) as { id: number }).id;

describe("an admin locked out of everything signs in with a break-glass code", () => {
  it("made at the terminal, typed on the usual sign-in page: it signs in once, and never by email", async () => {
    const { code, expiresAt } = await breakGlass("Dana@Example.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt).toBe(minutes(15).toISOString());
    // Only its hash is kept, like any code
    expect(JSON.stringify(w.db.raw.prepare("SELECT * FROM login_challenges").all())).not.toContain(code);

    const b = w.browser();
    const { asked, res } = await signIn(b, "dana@example.com", code, minutes(5));
    // No code of the usual kind was made for this browser (so none on screen here, none emailed anywhere)
    expect(asked.devCode).toBeUndefined();
    expect(res.status).toBe(200);
    expect((await b.club({ now: minutes(5) })).status).toBe(200);
    expect(w.db.raw.prepare("SELECT method FROM auth_sessions").all()).toEqual([{ method: "break_glass" }]);

    // Spent: it signs no one else in
    const again = w.browser();
    expect((await signIn(again, "dana@example.com", code, minutes(6))).res.status).toBe(400);
  });

  it("runs out after 15 minutes", async () => {
    const { code } = await breakGlass("dana@example.com");
    expect((await signIn(w.browser(), "dana@example.com", code, minutes(16))).res.status).toBe(400);
  });

  it("is only for an active member who can do everything: not a plain member, a stranger or a former admin", async () => {
    await expect(breakGlass("reg@example.com")).rejects.toThrow(/isn't an admin/);
    await expect(breakGlass("nobody@example.com")).rejects.toThrow(/No active member/);
    w.db.raw.prepare("UPDATE members SET status = 'inactive' WHERE email = 'alex@example.com'").run();
    await expect(breakGlass("alex@example.com")).rejects.toThrow(/No active member/);
    expect(w.db.raw.prepare("SELECT count(*) n FROM login_challenges").get()).toEqual({ n: 0 });
  });

  it("belongs to the first browser to ask, which gets only the usual five tries at it", async () => {
    const { code } = await breakGlass("dana@example.com");
    const first = w.browser();
    await first.call("POST", "/api/auth/start", { email: "dana@example.com", turnstile: humanToken("sign-in") });
    // Another browser asking now gets an ordinary code (on screen here: this is a local server), not the break-glass one
    const second = w.browser();
    expect((await signIn(second, "dana@example.com", code)).res.status).toBe(400);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await first.call("POST", "/api/auth/verify", { code: wrong });
    expect((await first.call("POST", "/api/auth/verify", { code })).status).toBe(400);
  });

  it("a new one takes the place of one not yet used", async () => {
    const old = await breakGlass("dana@example.com");
    const fresh = await breakGlass("dana@example.com");
    const b = w.browser();
    expect((await signIn(b, "dana@example.com", old.code)).res.status).toBe(old.code === fresh.code ? 200 : 400);
    if (old.code !== fresh.code)
      expect((await b.call("POST", "/api/auth/verify", { code: fresh.code })).status).toBe(200);
    expect(
      w.db.raw.prepare("SELECT count(*) n FROM login_challenges WHERE expires_at > ?").get(NOW.toISOString()),
    ).toEqual({ n: 1 });
  });
});

describe("everyone who should know, knows", () => {
  it("on the record when it's made and when it's used, and every admin is told on their phone and by email", async () => {
    w.firebase();
    const alex = await w.signedIn("alex@example.com");
    await alex.call("PUT", "/api/auth/device", { token: "alexs-iphone", platform: "ios" });
    const mailsBefore = w.mails.length;
    const { code } = await breakGlass("dana@example.com");
    await signIn(w.browser(), "dana@example.com", code, minutes(2));

    const dana = idOf("dana@example.com");
    expect(record("auth.break_glass")).toEqual([
      { memberId: dana, step: "issued", by: "operator@laptop", expiresAt: minutes(15).toISOString() },
      { memberId: dana, step: "signed_in", sessionId: expect.any(Number) },
    ]);
    expect(w.pushes).toEqual([
      expect.objectContaining({
        token: "alexs-iphone",
        title: "Break-glass sign-in",
        body: expect.stringContaining("Dana"),
      }),
    ]);
    const told = w.mails.slice(mailsBefore);
    expect(
      told
        .map((m) => m.to)
        .flat()
        .sort(),
    ).toEqual(["alex@example.com", "dana@example.com"]);
    expect(told[0].subject).toMatch(/break-glass/i);
  });

  it("a line on every admin's Home, and an admin signs that session out (or calls off a code not yet used)", async () => {
    const alex = await w.signedIn("alex@example.com");
    const first = await breakGlass("dana@example.com");
    let seen = (await alex.call("GET", "/api/break-glass", undefined, { now: minutes(1) })).body.breakGlass;
    expect(seen).toEqual([expect.objectContaining({ kind: "code", memberId: idOf("dana@example.com"), live: true })]);
    // A code nobody asked for: called off
    expect((await alex.call("POST", `/api/break-glass/codes/${seen[0].id}/end`)).status).toBe(200);
    expect((await signIn(w.browser(), "dana@example.com", first.code, minutes(2))).res.status).toBe(400);

    const { code } = await breakGlass("dana@example.com", minutes(3));
    const danaB = w.browser();
    expect((await signIn(danaB, "dana@example.com", code, minutes(4))).res.status).toBe(200);
    seen = (await alex.call("GET", "/api/break-glass", undefined, { now: minutes(5) })).body.breakGlass;
    const session = seen.find((s: Json) => s.kind === "session");
    expect(session).toMatchObject({ memberId: idOf("dana@example.com"), live: true, at: minutes(4).toISOString() });
    expect(
      (await alex.call("POST", `/api/break-glass/sessions/${session.id}/end`, {}, { now: minutes(6) })).status,
    ).toBe(200);
    expect((await danaB.club({ now: minutes(7) })).status).toBe(401);
    expect(record("auth.break_glass").map((r) => r.step)).toEqual(["issued", "ended", "issued", "signed_in", "ended"]);
    // Still on Home, as over now
    seen = (await alex.call("GET", "/api/break-glass", undefined, { now: minutes(8) })).body.breakGlass;
    expect(seen.every((s: Json) => !s.live)).toBe(true);
  });

  it("is for admins only to see and to end", async () => {
    await breakGlass("dana@example.com");
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("GET", "/api/break-glass")).status).toBe(403);
    expect((await reg.call("POST", "/api/break-glass/codes/1/end")).status).toBe(403);
  });
});
