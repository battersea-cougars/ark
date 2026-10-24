// Keeping the free tier's limits (ADR 0053, ADR 0055): reopening the app when nothing's changed costs one row read,
// and nobody, signed in or not, can hammer the API. Driven through the real handler in the fake world (testing.ts).
import { membersOf } from "../../src/app/club-whole";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaError, guard, resetBreakers } from "@cougars/shared/breaker";
import type { CacheLike } from "@cougars/shared/rate-limit";
import { LIMITS } from "./api.limits";
import { NOW, testWorld } from "../testing";
import { APP_BUILD } from "../../src/app/build";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
const PROFILE = { position: "D", phone: "", bio: "" };
let w: ReturnType<typeof testWorld>;

beforeEach(() => {
  w = testWorld(ROSTER);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetBreakers();
});

describe("reopening the app", () => {
  it("gets 'nothing's changed' until someone changes something", async () => {
    const reg = await w.signedIn("reg@example.com");
    const first = await reg.club();
    const tag = first.headers.get("etag")!;
    expect(first.status).toBe(200);
    // Never kept in the browser's cache, where members' details would outlast signing out (#81): the app asks with
    // the tag itself
    expect(first.headers.get("cache-control")).toBe("private, no-store");

    const again = await reg.club({ headers: { "if-none-match": tag } });
    expect(again.status).toBe(304);

    // Someone else's change is news to Reg too
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("PUT", "/api/me", PROFILE)).status).toBe(200);
    const after = await reg.club({ headers: { "if-none-match": tag } });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(tag);
  });

  it("hears which build of the app answered, so an app left open knows a newer one is out (ADR 0104)", async () => {
    const reg = await w.signedIn("reg@example.com");
    const first = await reg.club();
    expect(first.headers.get("x-app-build")).toBe(APP_BUILD);
    // Nothing's changed: still says which build, as the browser keeps the first reply's headers
    const again = await reg.club({
      headers: { "if-none-match": first.headers.get("etag")! },
    });
    expect(again.status).toBe(304);
    expect(again.headers.get("x-app-build")).toBe(APP_BUILD);
  });

  it("is never told 'nothing's changed' with another member's tag, or the next day", async () => {
    const reg = await w.signedIn("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    const danas = (await dana.club()).headers.get("etag")!;
    expect((await reg.club({ headers: { "if-none-match": danas } })).status).toBe(200);
    const regs = (await reg.club()).headers.get("etag")!;
    const tomorrow = new Date("2026-10-07T11:00:00Z");
    const next = await reg.club({
      now: tomorrow,
      headers: { "if-none-match": regs },
    });
    expect(next.status).toBe(200);
  });

  it("asks the database a handful of times, not once for every part of the club", async () => {
    // Each ask is a round trip the app waits on before it can show anything (ADR 0057)
    const reg = await w.signedIn("reg@example.com");
    await reg.call("GET", "/api/bootstrap"); // the day's first open also makes the coming training sessions
    const asks = vi.spyOn(w.db, "prepare");
    expect((await reg.call("GET", "/api/bootstrap")).status).toBe(200);
    expect(asks.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("makes the coming training sessions on the day's first open, and rolls them on each new day", async () => {
    const reg = await w.signedIn("reg@example.com");
    const lastSession = () =>
      (w.db.raw.prepare("SELECT max(held_on) last FROM training_sessions").get() as { last: string | null }).last;
    await reg.club();
    const today = lastSession();
    expect(today).not.toBeNull();

    const nextWeek = new Date(NOW.getTime() + 7 * 86_400_000);
    await reg.club({ now: nextWeek });
    expect(lastSession()! > today!).toBe(true);
  });

  it("doesn't count a refused change as a change", async () => {
    const reg = await w.signedIn("reg@example.com");
    const tag = (await reg.club()).headers.get("etag")!;
    expect((await reg.call("PUT", "/api/roles/1", { name: "x" })).status).toBe(403);
    expect((await reg.club({ headers: { "if-none-match": tag } })).status).toBe(304);
  });
});

describe("rate limits", () => {
  /** The Workers Cache API, in memory, as the rate limiter uses it. */
  function stubCaches() {
    const store = new Map<string, string>();
    const cache: CacheLike = {
      match: async (key) => (store.has(key) ? new Response(store.get(key)) : undefined),
      put: async (key, res) => void store.set(key, await res.text()),
    };
    vi.stubGlobal("caches", { open: async () => cache });
    // One minute window throughout, wherever the clock happens to be
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-06T11:00:00Z"));
  }

  it("slow down a member making changes faster than anyone taps, and nobody else", async () => {
    const reg = await w.signedIn("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    stubCaches();
    for (let i = 0; i < LIMITS.writesPerMember.limit; i++)
      expect((await reg.call("PUT", "/api/me", PROFILE)).status).toBe(200);
    const refused = await reg.call("PUT", "/api/me", PROFILE);
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/Wait a minute/);
    expect((await reg.club()).status).toBe(200); // reading still works
    expect((await dana.call("PUT", "/api/me", PROFILE)).status).toBe(200);
  });

  it("turn away an address that keeps asking without signing in", async () => {
    stubCaches();
    const stranger = w.browser();
    for (let i = 0; i < LIMITS.perAddress.limit; i++) await stranger.club();
    const refused = await stranger.club();
    expect(refused.status).toBe(429);
  });

  it("turn away an address sending made-up sessions, before another is looked up", async () => {
    stubCaches();
    const forger = w.browser();
    forger.jar.set("session", "made-up");
    for (let i = 0; i < LIMITS.unknownSessions.limit; i++) expect((await forger.club()).status).toBe(401);
    const refused = await forger.club();
    expect(refused.status).toBe(429);
    expect(refused.d1.roundTrips).toBe(0);
  });

  // One device on the rink's wifi going through the strangers' allowance (a page that isn't there, sign-in, error
  // reports, in a loop or on purpose) used to turn away every signed-in phone there too: members aren't behind it
  it("let a squad on one wifi keep following while a stranger there uses up the strangers' allowance", async () => {
    const reg = await w.signedIn("reg@example.com");
    stubCaches();
    const stranger = w.browser();
    for (let i = 0; i < LIMITS.perAddress.limit; i++) await stranger.call("GET", "/api/nope");
    expect((await stranger.call("GET", "/api/nope")).status).toBe(429);
    expect((await stranger.club()).status).toBe(429);
    expect((await reg.club()).status).toBe(200);
    expect((await reg.call("PUT", "/api/me", PROFILE)).status).toBe(200);
  });

  // The rink's wifi is one address (#113): a squad following a live game or the draft reloads once per change each,
  // so together they went over the address's 600 a minute and every phone there was turned away
  it("let a squad on one wifi keep following, each member counted on their own", async () => {
    const reg = await w.signedIn("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    const tag = (await reg.club()).headers.get("etag")!;
    stubCaches();
    const reload = (b: typeof reg) => b.club({ headers: { "if-none-match": tag } });
    for (let i = 0; i < LIMITS.perMember.limit; i++) expect((await reload(reg)).status).toBe(304);
    // Past what one address may ask without signing in, and Dana on the same wifi still gets through
    expect(LIMITS.perMember.limit).toBeGreaterThanOrEqual(LIMITS.perAddress.limit);
    expect((await reload(dana)).status).toBe(200);
    // One member asking more than anyone's phone does is slowed down, and only them
    const refused = await reload(reg);
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/Wait a minute/);
    expect((await reload(dana)).status).toBe(200);
    // Signing in still works there
    expect((await w.browser().call("POST", "/api/auth/start", { email: "nobody@example.com" })).status).not.toBe(429);
  });
});

describe("signing in while Gmail is paused", () => {
  it("says email isn't working, before anyone waits for a code that can't come", async () => {
    Object.assign(w.env, {
      TEAM_ENV: "dev",
      GMAIL_WEB_CLIENT_ID: "id",
      GMAIL_WEB_CLIENT_SECRET: "s",
      GMAIL_REFRESH_TOKEN: "r",
    });
    await guard("gmail", () => Promise.reject(new QuotaError("429", Date.now() + 15 * 60_000))).catch(() => {});
    const r = await w.browser().call("POST", "/api/auth/start", { email: "nobody@example.com" });
    expect(r.status).toBe(503); // member or not: it gives nothing away
    expect(r.body.error).toMatch(/Email isn't sending/);
  });
});

describe("making a change", () => {
  it("sends back the parts of the club it touched, not the whole club", async () => {
    const reg = await w.signedIn("reg@example.com");
    const r = await reg.call("PUT", "/api/me", { ...PROFILE, bio: "Stops pucks." });
    expect(r.status).toBe(200);
    // Members, as Home names them and (for a phone that's read the roster) everyone (#178), and Home's For admins
    expect(Object.keys(r.body.changed).sort()).toEqual(["forAdmins", "members", "people"]);
    expect(r.body.changed.people.find((m: { email: string }) => m.email === "reg@example.com").bio).toBe(
      "Stops pucks.",
    );
  });

  it("keeps what the change itself answered", async () => {
    const dana = await w.signedIn("dana@example.com");
    const r = await dana.call("POST", "/api/quips", { kind: "in", text: "See you on court." });
    expect(r.status).toBe(201);
    expect(r.body.id).toEqual(expect.any(Number));
    expect(r.body.changed.quips.some((q: { text: string }) => q.text === "See you on court.")).toBe(true);
  });

  it("shows only what this member may see, as the bootstrap does", async () => {
    const reg = await w.signedIn("reg@example.com");
    const changed = (await reg.call("PUT", "/api/me", PROFILE)).body.changed;
    const boot = (await reg.club()).body;
    // Put together as the app does (src/app/club-whole.ts): the roster, with your own row from Home's people
    expect(membersOf(changed.members, changed.people, boot.me)).toEqual(boot.members);
  });
});
