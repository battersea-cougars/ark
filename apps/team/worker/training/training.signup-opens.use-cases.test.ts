// When a training night's sign-up opens (ADR 0131): a training can say its nights open a number of days before, at
// midnight London time (Friday Training: 4, the Monday). Before then a member's In is refused and the app says when it
// opens; the register and admins can still put people in. When it opens, members hear it once, from the cron (ADR
// 0108, 0121), on its day. Driven through the real handlers and the cron in the fake world (ADR 0031).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
];

// NOW is Tuesday 6 October 2026: the next Friday is the 9th (its sign-up opened on Monday the 5th), the one after the
// 16th, opening on Monday the 12th
const NEXT_FRIDAY = "2026-10-09";
const FRIDAY_AFTER = "2026-10-16";
/** Monday 12 October, five past midnight in London (BST: 23:05 on the Sunday, UTC) */
const MONDAY_MIDNIGHT = new Date("2026-10-11T23:05:00Z");
/** Sunday 11 October, ten to midnight in London */
const SUNDAY_LATE = new Date("2026-10-11T22:50:00Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(() => vi.restoreAllMocks());

/** Friday Training, its sign-up opening `days` before each night (null: always open), as Dana saves it. */
async function friday(days: unknown = 4) {
  const dana = await w.signedIn("dana@example.com");
  const sees = async (now = NOW) => (await dana.call("GET", "/api/bootstrap", undefined, { now })).body as Json;
  const b = await sees();
  const id = Object.fromEntries(b.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  const series = b.series[0];
  const save = (change: Record<string, unknown>) =>
    dana.call("PUT", `/api/series/${series.id}`, { ...series, ...change });
  expect((await save({ signupOpensDays: days })).status).toBe(200);
  const night = (day: string) => b.sessions.find((s: Json) => s.heldOn === day) as Json;
  const say = async (email: string, day: string, answer: "in" | "out", now = NOW) =>
    (await w.signedIn(email)).call("POST", `/api/sessions/${night(day).id}/answer`, { answer }, { now });
  const seen = async (day: string, now = NOW) => (await sees(now)).sessions.find((s: Json) => s.heldOn === day) as Json;
  return { dana, id, series, save, night, say, seen, sees };
}

/** A phone with the app, signed in as this member. */
async function phone(email: string) {
  const b = await w.signedIn(email);
  expect((await b.call("PUT", "/api/auth/device", { token: `token-${email}`, platform: "ios" })).status).toBe(200);
}

describe("a night's sign-up opens on its day", () => {
  it("Friday Training opens on the Monday: saved with the training, and sent to the app", async () => {
    const f = await friday(4);
    expect((await f.sees()).series[0].signupOpensDays).toBe(4);
  });

  it("before the Monday a member's In is refused, saying when it opens", async () => {
    const f = await friday(4);
    const res = await f.say("reg@example.com", FRIDAY_AFTER, "in", SUNDAY_LATE);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Sign-up opens Monday.");
    expect((await f.seen(FRIDAY_AFTER)).going).toEqual([]);
  });

  it("a night further off says the day and its date", async () => {
    const f = await friday(4);
    const res = await f.say("reg@example.com", "2026-10-23", "in");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Sign-up opens Monday 19 October.");
  });

  it("from midnight on the Monday (London) a member's In is taken", async () => {
    const f = await friday(4);
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "in", MONDAY_MIDNIGHT)).status).toBe(200);
    expect((await f.seen(FRIDAY_AFTER, MONDAY_MIDNIGHT)).going).toEqual([f.id.Reg]);
  });

  it("this week's Friday, open since Monday, takes sign-ups as before", async () => {
    const f = await friday(4);
    expect((await f.say("reg@example.com", NEXT_FRIDAY, "in")).status).toBe(200);
  });

  it("saying you can't make it is fine before it opens", async () => {
    const f = await friday(4);
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "out")).status).toBe(200);
    expect((await f.seen(FRIDAY_AFTER)).out).toEqual([f.id.Reg]);
  });

  it("an admin can still put someone in before it opens", async () => {
    const f = await friday(4);
    const res = await f.dana.call("POST", `/api/sessions/${f.night(FRIDAY_AFTER).id}/players`, {
      memberId: f.id.Paul,
      in: true,
    });
    expect(res.status).toBe(200);
    expect((await f.seen(FRIDAY_AFTER)).going).toEqual([f.id.Paul]);
  });

  it("left empty, a training's nights are always open, as before", async () => {
    const f = await friday(null);
    expect((await f.sees()).series[0].signupOpensDays).toBeNull();
    expect((await f.say("reg@example.com", "2026-10-23", "in")).status).toBe(200);
  });

  it.each([
    ["minus a day", -1],
    ["more than four weeks", 29],
    ["half a day", 1.5],
    ["a word", "monday"],
  ])("refuses opening %s before, and changes nothing", async (_, days) => {
    const f = await friday(null);
    const res = await f.save({ signupOpensDays: days, capacity: 3 });
    expect(res.status).toBe(400);
    expect((await f.sees()).series[0]).toMatchObject({ signupOpensDays: null, capacity: f.series.capacity });
  });
});

describe("members hear it's open", () => {
  it("once, when it opens: the cron sends one notification for the night, however often it runs", async () => {
    await phone("reg@example.com");
    await phone("paul@example.com");
    const f = await friday(4);
    // This week's Friday opened yesterday, before Friday Training had an opening day: not news now
    await w.scheduled("*/5 * * * *", NOW);
    // Nor anything until the next one opens
    await w.scheduled("*/5 * * * *", SUNDAY_LATE);
    expect(w.pushes).toEqual([]);
    // Monday, just past midnight: the five-minute run, again five minutes later, and the hourly run
    await w.scheduled("*/5 * * * *", MONDAY_MIDNIGHT);
    await w.scheduled("*/5 * * * *", new Date(MONDAY_MIDNIGHT.getTime() + 5 * 60_000));
    await w.scheduled("7 * * * *", new Date(MONDAY_MIDNIGHT.getTime() + 2 * 60_000));
    expect(w.pushes.map((p) => p.memberId).sort()).toEqual([f.id.Reg, f.id.Paul].sort());
    expect(w.pushes[0]).toMatchObject({
      title: "Friday Training: sign-up's open",
      body: "Say you're in for Friday 16 October.",
      // The night's own page, not the series'
      path: `/training/${f.series.slug}/2026-10-16`,
    });
  });

  it("two runs at once send it once", async () => {
    await phone("reg@example.com");
    await friday(4);
    await Promise.all([w.scheduled("*/5 * * * *", MONDAY_MIDNIGHT), w.scheduled("7 * * * *", MONDAY_MIDNIGHT)]);
    const forThe16th = w.pushes.filter((p) => p.body.includes("16 October"));
    expect(forThe16th).toHaveLength(1);
  });

  it("a member who turned off Your place isn't told", async () => {
    await phone("reg@example.com");
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("PUT", "/api/me/notifications", { places: false })).status).toBe(200);
    await friday(4);
    await w.scheduled("*/5 * * * *", MONDAY_MIDNIGHT);
    expect(w.pushes).toEqual([]);
  });

  it("a member who's said Out for the night isn't told, nor one already in; the rest are", async () => {
    await phone("reg@example.com");
    await phone("paul@example.com");
    await phone("dana@example.com");
    const f = await friday(4);
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "out")).status).toBe(200);
    const put = await f.dana.call("POST", `/api/sessions/${f.night(FRIDAY_AFTER).id}/players`, {
      memberId: f.id.Paul,
      in: true,
    });
    expect(put.status).toBe(200);
    await w.scheduled("*/5 * * * *", MONDAY_MIDNIGHT);
    expect(w.pushes.filter((p) => p.body.includes("16 October")).map((p) => p.memberId)).toEqual([f.id.Dana]);
  });

  it("a night that's called off isn't announced", async () => {
    await phone("reg@example.com");
    const f = await friday(4);
    await f.dana.call("POST", `/api/sessions/${f.night(FRIDAY_AFTER).id}/cancelled`, { cancelled: true });
    await w.scheduled("*/5 * * * *", MONDAY_MIDNIGHT);
    expect(w.pushes).toEqual([]);
  });

  it("a training that's always open sends nothing", async () => {
    await phone("reg@example.com");
    await friday(null);
    await w.scheduled("*/5 * * * *", NOW);
    await w.scheduled("*/5 * * * *", MONDAY_MIDNIGHT);
    expect(w.pushes).toEqual([]);
  });
});
