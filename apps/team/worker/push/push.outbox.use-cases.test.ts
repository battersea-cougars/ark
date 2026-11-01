// When a notification goes (ADR 0108): the push outbox holds each one, a row per member and notice, until it's due.
// Quiet hours, 22:00 to 08:00 in London (across the clock changes): what's news but not urgent waits for 08:00, and
// what's about something happening now (the draft on the night, the awards at the after-party) goes at once. The
// debounce: a member told something about one thing (their place on a night) isn't told about it again within two
// minutes; what comes in that time replaces what's waiting, the latest wins, and if it ends where they were last told,
// nothing's sent. A club-wide send, held overnight, goes out from 08:00 a batch an invocation, never more than the
// free plan allows. Driven through the real handlers and the cron in the fake world (ADR 0031), Firebase faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { DEBOUNCE_MINUTES, DRAIN_AT_ONCE, SEND_AT_ONCE } from "./push.rules";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Member", position: "F", rating: 55, email: "mo@example.com" },
  { name: "Wes Waiting", position: "F", rating: 50, email: "wes@example.com" },
  { name: "Val Waiting", position: "D", rating: 50, email: "val@example.com" },
  { name: "Quinn Quarterly", position: "F", rating: 50, email: "quinn@example.com" },
];
const NEXT_FRIDAY = "2026-10-09";
const news = (title: string) => ({ title, body: "Read it.", link: "", endsOn: "2027-12-31" });
const at = (iso: string) => new Date(iso);
const MINUTE = 60_000;
const after = (t: Date, minutes: number) => new Date(t.getTime() + minutes * MINUTE);

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const boot = async (b: Browser) => (await b.club()).body;
async function phone(email: string) {
  const b = await w.signedIn(email);
  expect((await b.call("PUT", "/api/auth/device", { token: `token-${email}`, platform: "ios" })).status).toBe(200);
  return b;
}
const waiting = () =>
  (w.db.raw.prepare("SELECT count(*) n FROM push_outbox WHERE state IN ('queued', 'claimed')").get() as { n: number })
    .n;
/** The run every minute (wrangler.jsonc), or the five-minute one on a minute it falls on, as Cloudflare fires them. */
const cronAt = (t: Date) => w.scheduled(t.getUTCMinutes() % 5 ? "* * * * *" : "*/5 * * * *", t);

/** Firebase on, Reg and Mo with the app, Dana to post. */
async function twoPhones() {
  const fcm = await w.firebase();
  await phone("reg@example.com");
  await phone("mo@example.com");
  const dana = await w.signedIn("dana@example.com");
  return { fcm, dana, heard: () => fcm.asked.map((a) => `${a.token} ${a.title}`).sort() };
}

describe("quiet hours, 22:00 to 08:00 in London", () => {
  it("an announcement posted at 23:00 waits for 08:00, then everyone hears it, once", async () => {
    const { fcm, dana, heard } = await twoPhones();
    // Tuesday 6 October, 23:00 BST
    const late = at("2026-10-06T22:00:00Z");
    expect((await dana.call("POST", "/api/announcements", news("Ice time moved"), { now: late })).status).toBe(201);
    expect(fcm.asked).toEqual([]);
    expect(waiting()).toBe(2);

    // Every run through the night sends nothing; 07:59 BST neither
    for (let t = after(late, 5); t < at("2026-10-07T06:59:30Z"); t = after(t, 30)) await w.cron(t);
    await w.cron(at("2026-10-07T06:59:00Z"));
    expect(fcm.asked).toEqual([]);
    // 08:00 BST
    await cronAt(at("2026-10-07T07:00:00Z"));
    expect(heard()).toEqual(["token-mo@example.com Ice time moved", "token-reg@example.com Ice time moved"]);
    await cronAt(at("2026-10-07T07:01:00Z"));
    expect(fcm.asked).toHaveLength(2);
    expect(waiting()).toBe(0);
  });

  it("at 21:59 it goes at once; from 22:00 it waits; from 08:00 it goes at once again", async () => {
    const { fcm, dana } = await twoPhones();
    await dana.call("POST", "/api/announcements", news("Before"), { now: at("2026-10-06T20:59:59Z") });
    expect(fcm.asked).toHaveLength(2);
    await dana.call("POST", "/api/announcements", news("Ten"), { now: at("2026-10-06T21:00:00Z") });
    expect(fcm.asked).toHaveLength(2);
    await dana.call("POST", "/api/announcements", news("Morning"), { now: at("2026-10-07T07:00:00Z") });
    // The morning's goes at once, and the night's with it (due now)
    expect(fcm.asked.map((a) => a.title).sort()).toEqual(["Before", "Before", "Morning", "Morning", "Ten", "Ten"]);
  });

  it("after midnight it waits for 08:00 that same morning, not the next", async () => {
    const { fcm, dana } = await twoPhones();
    await dana.call("POST", "/api/announcements", news("Small hours"), { now: at("2026-10-07T00:30:00Z") });
    await w.cron(at("2026-10-07T06:55:00Z"));
    expect(fcm.asked).toEqual([]);
    await w.cron(at("2026-10-07T07:00:00Z"));
    expect(fcm.asked).toHaveLength(2);
  });

  it("the night the clocks go back (Sunday 25 October 2026), 08:00 is 08:00 GMT, an hour later in UTC", async () => {
    const { fcm, dana } = await twoPhones();
    // Saturday 24 October, 23:30 BST
    await dana.call("POST", "/api/announcements", news("Clocks back"), { now: at("2026-10-24T22:30:00Z") });
    // 07:00 GMT (08:00 by the summer's clock): still quiet
    await w.cron(at("2026-10-25T07:00:00Z"));
    await w.cron(at("2026-10-25T07:55:00Z"));
    expect(fcm.asked).toEqual([]);
    await w.cron(at("2026-10-25T08:00:00Z"));
    expect(fcm.asked).toHaveLength(2);
  });

  it("the night the clocks go forward (Sunday 28 March 2027), 08:00 is 08:00 BST, an hour earlier in UTC", async () => {
    const { fcm, dana } = await twoPhones();
    // Saturday 27 March, 23:00 GMT
    await dana.call("POST", "/api/announcements", news("Clocks forward"), { now: at("2027-03-27T23:00:00Z") });
    await w.cron(at("2027-03-28T06:55:00Z"));
    expect(fcm.asked).toEqual([]);
    await w.cron(at("2027-03-28T07:00:00Z"));
    expect(fcm.asked).toHaveLength(2);
  });

  it("a phone Firebase says is gone at 08:00 is forgotten, and hears nothing more", async () => {
    const { fcm, dana } = await twoPhones();
    await dana.call("POST", "/api/announcements", news("Overnight"), { now: at("2026-10-06T22:30:00Z") });
    fcm.answers.set("token-mo@example.com", "gone");
    await w.cron(at("2026-10-07T07:00:00Z"));
    expect(w.db.raw.prepare("SELECT token FROM push_devices").all()).toEqual([{ token: "token-reg@example.com" }]);
    expect(waiting()).toBe(0);
    fcm.asked.length = 0;
    await dana.call("POST", "/api/announcements", news("Morning"), { now: at("2026-10-07T09:00:00Z") });
    expect(fcm.asked.map((a) => a.token)).toEqual(["token-reg@example.com"]);
  });
});

describe("a club-wide send held overnight, within the free plan", () => {
  const PHONES = 120;
  async function club() {
    w = testWorld([
      ROSTER[0],
      ...Array.from({ length: PHONES - 1 }, (_, i) => ({
        name: `Member ${i + 1}`,
        position: "F",
        rating: 50,
        email: `m${i + 1}@example.com`,
      })),
    ]);
    const fcm = await w.firebase();
    const dana = await phone("dana@example.com");
    for (let i = 1; i < PHONES; i++) await phone(`m${i}@example.com`);
    await dana.call("POST", "/api/announcements", news("Overnight"), { now: at("2026-10-06T22:30:00Z") });
    expect(fcm.asked).toEqual([]);
    fcm.invocations.length = 0;
    return fcm;
  }

  it(`120 phones are each sent it once from 08:00, never more than ${SEND_AT_ONCE} in one invocation`, async () => {
    const fcm = await club();
    // 08:00 BST, the five-minute run: a smaller batch, since it sends reminders and asks for rebuilds too
    await cronAt(at("2026-10-07T07:00:00Z"));
    expect(fcm.asked).toHaveLength(DRAIN_AT_ONCE);
    // Then the run every minute, a whole batch each: everyone by 08:03
    for (let m = 1; m <= 3; m++) await cronAt(at(`2026-10-07T07:0${m}:00Z`));
    expect(fcm.asked).toHaveLength(PHONES);
    await cronAt(at("2026-10-07T07:04:00Z"));
    await cronAt(at("2026-10-07T07:05:00Z"));
    expect(fcm.asked).toHaveLength(PHONES);
    expect(new Set(fcm.asked.map((a) => a.token)).size).toBe(PHONES);
    expect(waiting()).toBe(0);
    // Each invocation: its sends, and Google's access token once at most; under the 50
    const sends = fcm.invocations.filter((n) => n > 0);
    expect(sends).toHaveLength(4);
    expect(Math.max(...sends)).toBeLessThanOrEqual(SEND_AT_ONCE + 1);
    expect(SEND_AT_ONCE + 1).toBeLessThan(50);
  });

  it.each(seeds(5))("three drains at 08:00 at once never send a phone twice (seed %i)", async (seed) => {
    const fcm = await club();
    const eight = at("2026-10-07T07:00:00Z");
    w.db.interleave(seed);
    await Promise.all([w.cron(eight), w.scheduled("*/5 * * * *", eight), w.cron(eight)]);
    w.db.interleave(null);
    for (let m = 1; m <= 6; m++) await cronAt(after(eight, m));
    expect(fcm.asked).toHaveLength(PHONES);
    expect(new Set(fcm.asked.map((a) => a.token)).size).toBe(PHONES);
    expect(fcm.invocations.filter((n) => n > 50)).toEqual([]);
  });
});

// A Quarterly Member signing up for a full night bumps the last in paying as they go (ADR 0131); one going out lets
// the first waiting in. Each is news on the `places` topic, about that member's place on that night.
describe(`the debounce: ${DEBOUNCE_MINUTES} minutes per member and thing`, () => {
  let taps = 0;
  const tapAt = () => ({ now: new Date(NOW.getTime() + ++taps) });

  /** Next Friday with two places: Reg and Mo in, Wes then Val waiting, all with the app; Quinn a Quarterly Member. */
  async function fullFriday() {
    const fcm = await w.firebase();
    const dana = await w.signedIn("dana@example.com");
    const b = await boot(dana);
    const series = b.series[0];
    expect((await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 2 })).status).toBe(200);
    const id = (name: string) => b.members.find((m: { name: string }) => m.name === name).id as number;
    const session = b.sessions.find((s: { heldOn: string }) => s.heldOn === NEXT_FRIDAY) as { id: number };
    const answer = (p: Browser, a: "in" | "out") =>
      p.call("POST", `/api/sessions/${session.id}/answer`, { answer: a }, tapAt());
    const people = new Map<string, Browser>();
    for (const who of ["reg", "mo", "wes", "val"]) {
      const p = await phone(`${who}@example.com`);
      expect((await answer(p, "in")).status).toBe(200);
      people.set(who, p);
    }
    expect(
      (await dana.call("POST", `/api/members/${id("Quinn Quarterly")}/quarterly`, { quarterly: true })).status,
    ).toBe(200);
    const quinn = await w.signedIn("quinn@example.com");
    const night = async () => (await boot(dana)).sessions.find((s: { id: number }) => s.id === session.id);
    const heard = () => fcm.asked.map((a) => `${a.token.replace(/^token-|@example.com$/g, "")}: ${a.title}`);
    return { fcm, dana, id, session, answer, people, quinn, night, heard };
  }

  it("in, bumped and back in within the window: they hear they're in, and nothing more", async () => {
    const f = await fullFriday();
    // Reg out: Wes, first waiting, is in, and hears it at once
    await f.answer(f.people.get("reg")!, "out");
    expect(f.heard()).toEqual(["wes: You're in"]);
    // Quinn signs up: the last in paying as they go goes back to waiting
    await f.answer(f.quinn, "in");
    expect((await f.night()).waitlist[0]).toBe(f.id("Wes Waiting"));
    // Quinn's out again: Wes is back in. All inside two minutes
    await f.answer(f.quinn, "out");
    expect((await f.night()).going).toContain(f.id("Wes Waiting"));
    for (let m = 1; m <= 10; m++) await w.cron(new Date(NOW.getTime() + m * MINUTE));
    expect(f.heard()).toEqual(["wes: You're in"]);
    expect(waiting()).toBe(0);
  });

  it("in, then bumped within the window: the bump waits out the window, then they hear it, once", async () => {
    const f = await fullFriday();
    await f.answer(f.people.get("reg")!, "out");
    await f.answer(f.quinn, "in");
    expect(f.heard()).toEqual(["wes: You're in"]);
    await w.cron(new Date(NOW.getTime() + (DEBOUNCE_MINUTES * MINUTE) / 2));
    expect(f.heard()).toEqual(["wes: You're in"]);
    for (let m = DEBOUNCE_MINUTES; m <= DEBOUNCE_MINUTES + 5; m++) await w.cron(new Date(NOW.getTime() + m * MINUTE));
    expect(f.heard()).toEqual(["wes: You're in", "wes: On the waitlist"]);
  });

  it("the latest wins: bumped, in and bumped again inside the window is one 'On the waitlist'", async () => {
    const f = await fullFriday();
    await f.answer(f.people.get("reg")!, "out");
    await f.answer(f.quinn, "in");
    await f.answer(f.quinn, "out");
    await f.answer(f.quinn, "in");
    for (let m = 1; m <= 10; m++) await w.cron(new Date(NOW.getTime() + m * MINUTE));
    expect(f.heard()).toEqual(["wes: You're in", "wes: On the waitlist"]);
  });

  it("only the same thing waits: another member, or other news, goes at once", async () => {
    const f = await fullFriday();
    await f.answer(f.people.get("reg")!, "out");
    // Mo out too: Val's in, at once, though Wes heard about the same night a moment ago
    await f.answer(f.people.get("mo")!, "out");
    expect(f.heard()).toEqual(["wes: You're in", "val: You're in"]);
    // An announcement to Wes isn't held by his place
    await f.dana.call("POST", "/api/announcements", news("Pub after"), tapAt());
    expect(f.heard().filter((h) => h.startsWith("wes"))).toEqual(["wes: You're in", "wes: Pub after"]);
  });

  it("past the window, the same thing is news again, at once", async () => {
    const f = await fullFriday();
    await f.answer(f.people.get("reg")!, "out");
    expect(f.heard()).toEqual(["wes: You're in"]);
    // Ten minutes on, Quinn signs up and bumps Wes: he hears it then and there
    const later = { now: new Date(NOW.getTime() + 10 * MINUTE) };
    await f.quinn.call("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" }, later);
    expect(f.heard()).toEqual(["wes: You're in", "wes: On the waitlist"]);
  });
});
