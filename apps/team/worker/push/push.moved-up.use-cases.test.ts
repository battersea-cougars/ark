// Off the waiting list (ADR 0030, 0108): whoever moves up into a training's place hears it on their phone, "You're
// in", with the session and its day, and a tap opens it. However they moved up (someone saying out, an admin taking
// someone off, a limit raised, an account deleted, the register taking a walk-in off, the team maker letting them in),
// and only them, once per move: a double tap or two leaving at once tells each one who moved up once (ADR 0121).
// Driven through the real handlers in the fake world (ADR 0031); each notification is caught in its push outbox.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Member", position: "F", rating: 55, email: "mo@example.com" },
  { name: "Wes Waiting", position: "F", rating: 50, email: "wes@example.com" },
  { name: "Val Waiting", position: "D", rating: 50, email: "val@example.com" },
  { name: "Quinn Quarterly", position: "F", rating: 50, email: "quinn@example.com" },
  { name: "Kit Quarterly", position: "F", rating: 50, email: "kit@example.com" },
];
// NOW is Tuesday 6 October 2026: the next Friday is the 9th
const NEXT_FRIDAY = "2026-10-09";
const PLACE = "A place came up for Friday Training, Fri 9 Oct. Off the bench, skates on.";
const SEEDS = seeds(5);

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

const boot = async (b: Browser) => (await b.call("GET", "/api/bootstrap")).body;
let taps = 0;
const tapAt = () => ({ now: new Date(NOW.getTime() + ++taps) });

/**
 * Next Friday with two places: Reg and Mo in, Wes then Val waiting, every one of them with the app on their phone.
 * Nothing's been heard yet.
 */
async function fullFriday() {
  const dana = await w.signedIn("dana@example.com");
  const b = await boot(dana);
  const series = b.series[0];
  expect((await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 2 })).status).toBe(200);
  const id = (name: string) => b.members.find((m: { name: string }) => m.name === name).id as number;
  const session = (await boot(dana)).sessions.find((s: { heldOn: string }) => s.heldOn === NEXT_FRIDAY) as {
    id: number;
  };
  const phone = new Map<string, Browser>();
  for (const email of ["reg@example.com", "mo@example.com", "wes@example.com", "val@example.com"]) {
    const p = await w.signedIn(email);
    expect((await p.call("PUT", "/api/auth/device", { token: `token-${email}`, platform: "ios" })).status).toBe(200);
    expect((await p.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" }, tapAt())).status).toBe(200);
    phone.set(email, p);
  }
  const night = async () => (await boot(dana)).sessions.find((s: { id: number }) => s.id === session.id);
  expect((await night()).waitlist).toEqual([id("Wes Waiting"), id("Val Waiting")]);
  expect(w.pushes).toEqual([]);
  const out = (email: string) =>
    phone.get(email)!.call("POST", `/api/sessions/${session.id}/answer`, { answer: "out" }, tapAt());
  return { dana, series, session, phone, id, night, out };
}

const youreIn = (email: string, body = PLACE) =>
  expect.objectContaining({
    token: `token-${email}`,
    title: "You're in",
    body,
    path: `/training/friday/${NEXT_FRIDAY}`,
  });

describe("moving up off a training's waiting list", () => {
  it("someone says they're out: the first waiting hears they're in, and nobody else hears a thing", async () => {
    const f = await fullFriday();
    expect((await f.out("reg@example.com")).status).toBe(200);
    expect(w.pushes).toEqual([youreIn("wes@example.com")]);
  });

  it("an admin takes someone off: the first waiting hears they're in", async () => {
    const f = await fullFriday();
    const res = await f.dana.call("POST", `/api/sessions/${f.session.id}/players`, {
      memberId: f.id("Mo Member"),
      in: false,
    });
    expect(res.status).toBe(200);
    expect(w.pushes).toEqual([youreIn("wes@example.com")]);
  });

  it("the team maker lets someone in: they hear it was the team maker", async () => {
    const f = await fullFriday();
    const res = await f.dana.call("POST", `/api/sessions/${f.session.id}/let-in`, { memberId: f.id("Val Waiting") });
    expect(res.status).toBe(200);
    expect(w.pushes).toEqual([
      youreIn("val@example.com", "The team maker let you into Friday Training, Fri 9 Oct. Don't make them regret it."),
    ]);
  });

  it("the limit's raised: everyone it lets in hears it, once each", async () => {
    const f = await fullFriday();
    const res = await f.dana.call("PUT", `/api/series/${f.series.id}`, { ...f.series, capacity: 4 });
    expect(res.status).toBe(200);
    expect((await f.night()).waitlist).toEqual([]);
    expect(w.pushes).toEqual([youreIn("wes@example.com"), youreIn("val@example.com")]);
  });

  it("the limit's saved again unchanged: nobody moves, nobody hears", async () => {
    const f = await fullFriday();
    expect((await f.dana.call("PUT", `/api/series/${f.series.id}`, { ...f.series, capacity: 2 })).status).toBe(200);
    expect(w.pushes).toEqual([]);
  });

  it("someone deletes their account: the first waiting hears they're in", async () => {
    const f = await fullFriday();
    expect((await f.phone.get("mo@example.com")!.call("DELETE", "/api/me")).status).toBe(200);
    expect(w.pushes).toEqual([youreIn("wes@example.com")]);
  });

  it("an admin deletes someone's account for them: the first waiting hears they're in", async () => {
    const f = await fullFriday();
    expect((await f.dana.call("DELETE", `/api/members/${f.id("Reg Player")}`)).status).toBe(200);
    expect(w.pushes).toEqual([youreIn("wes@example.com")]);
  });

  it.each([
    ["the night's register", "register"],
    ["a member's Fridays", "attendance"],
  ])("%s takes a walk-in off: the first waiting hears they're in", async (_, where) => {
    const dana = await w.signedIn("dana@example.com");
    const b = await boot(dana);
    const series = b.series[0];
    expect((await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 1 })).status).toBe(200);
    const session = (await boot(dana)).sessions.find((s: { heldOn: string }) => s.heldOn === NEXT_FRIDAY);
    const reg = b.members.find((m: { name: string }) => m.name === "Reg Player").id as number;
    const mark = (here: boolean) =>
      where === "register"
        ? dana.call("POST", `/api/sessions/${session.id}/register`, { memberId: reg, here })
        : dana.call("PUT", `/api/members/${reg}/attendance`, { marks: [{ sessionId: session.id, here }] });
    // Reg walks in, taking the one place; Wes signs up after and waits
    expect((await mark(true)).status).toBe(200);
    const wes = await w.signedIn("wes@example.com");
    expect(
      (await wes.call("PUT", "/api/auth/device", { token: "token-wes@example.com", platform: "ios" })).status,
    ).toBe(200);
    expect((await wes.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" })).status).toBe(200);
    expect(w.pushes).toEqual([]);

    expect((await mark(false)).status).toBe(200);

    expect(w.pushes).toEqual([youreIn("wes@example.com")]);
  });

  it("only someone who moved up hears: a Quarterly Member taking a place isn't told they're in", async () => {
    const f = await fullFriday();
    expect(
      (await f.dana.call("POST", `/api/members/${f.id("Val Waiting")}/quarterly`, { quarterly: true })).status,
    ).toBe(200);
    // Val is a Quarterly Member now, first in line: Reg going out lets her in, not Wes
    expect((await f.out("reg@example.com")).status).toBe(200);
    expect(w.pushes).toEqual([youreIn("val@example.com")]);
  });

  it("isn't heard by one who turned places off, and isn't kept for later either", async () => {
    const f = await fullFriday();
    await f.phone.get("wes@example.com")!.call("PUT", "/api/me/notifications", { places: false });
    await f.out("reg@example.com");
    expect(w.pushes).toEqual([]);
    await f.out("mo@example.com");
    expect(w.pushes).toEqual([youreIn("val@example.com")]);
  });
});

describe("moving up elsewhere", () => {
  it("a club event's limit raised: the first waiting hears there's a place for them", async () => {
    const f = await fullFriday();
    const curry = {
      title: "Curry night",
      startsAt: "2026-10-24T19:00:00.000Z",
      endsAt: "2026-10-24T22:00:00.000Z",
      venue: "",
      signup: true,
      capacity: 1,
    };
    const made = await f.dana.call("POST", "/api/club-events", curry);
    const eventId = made.body.id as number;
    for (const email of ["reg@example.com", "wes@example.com", "val@example.com"])
      await f.phone.get(email)!.call("POST", `/api/club-events/${eventId}/answer`, { answer: "in" });
    expect(w.pushes).toEqual([]);

    expect((await f.dana.call("PUT", `/api/club-events/${eventId}`, { ...curry, capacity: 2 })).status).toBe(200);

    expect(w.pushes).toEqual([
      expect.objectContaining({
        token: "token-wes@example.com",
        title: "You're in",
        body: "A place came up for Curry night. It's yours.",
        path: "/calendar",
      }),
    ]);
  });
});

describe("moving up, at once (ADR 0121)", () => {
  it.each(SEEDS)("a double tap on Out lets one in, who hears it once (seed %i)", async (seed) => {
    const f = await fullFriday();
    w.db.interleave(seed);
    await Promise.all([f.out("reg@example.com"), f.out("reg@example.com")]);
    w.db.interleave(null);
    expect((await f.night()).waitlist).toEqual([f.id("Val Waiting")]);
    expect(w.pushes).toEqual([youreIn("wes@example.com")]);
  });

  it.each(SEEDS)("two leaving at once let both waiting in, and each hears it once (seed %i)", async (seed) => {
    const f = await fullFriday();
    w.db.interleave(seed);
    await Promise.all([f.out("reg@example.com"), f.out("mo@example.com")]);
    w.db.interleave(null);
    expect((await f.night()).waitlist).toEqual([]);
    expect(w.pushes.map((p) => p.token).sort()).toEqual(["token-val@example.com", "token-wes@example.com"]);
    expect(w.pushes).toHaveLength(2);
  });
});

// A Quarterly Member signing up for a full training takes the place of the last one in paying as they go (ADR 0030,
// #97): that one hears they're on the waitlist, and where, once per bump however the requests interleave.
describe("bumped to the waiting list", () => {
  /** The full Friday, with Quinn and Kit made Quarterly Members (not signed up yet). */
  async function withQuarterlies() {
    const f = await fullFriday();
    for (const name of ["Quinn Quarterly", "Kit Quarterly"])
      expect((await f.dana.call("POST", `/api/members/${f.id(name)}/quarterly`, { quarterly: true })).status).toBe(200);
    const quinn = await w.signedIn("quinn@example.com");
    const kit = await w.signedIn("kit@example.com");
    const signUp = (b: Browser) => b.call("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" }, tapAt());
    return { ...f, quinn, kit, signUp };
  }
  const onTheWaitlist = (email: string) =>
    expect.objectContaining({ token: `token-${email}`, title: "On the waitlist" });

  it("the register for a member's Fridays puts a Quarterly walk-in in: the one bumped hears it", async () => {
    const f = await withQuarterlies();
    const res = await f.dana.call("PUT", `/api/members/${f.id("Quinn Quarterly")}/attendance`, {
      marks: [{ sessionId: f.session.id, here: true }],
    });
    expect(res.status).toBe(200);
    expect((await f.night()).waitlist).toEqual([f.id("Mo Member"), f.id("Wes Waiting"), f.id("Val Waiting")]);
    expect(w.pushes).toEqual([
      expect.objectContaining({
        token: "token-mo@example.com",
        title: "On the waitlist",
        body: "You're on the waitlist for Fri 9 Oct, first in line: a Quarterly Member took the last place.",
        path: `/training/friday/${NEXT_FRIDAY}`,
      }),
    ]);
  });

  it.each(SEEDS)("a Quarterly Member's double tap bumps one, who hears it once (seed %i)", async (seed) => {
    const f = await withQuarterlies();
    w.db.interleave(seed);
    await Promise.all([f.signUp(f.quinn), f.signUp(f.quinn)]);
    w.db.interleave(null);
    expect((await f.night()).waitlist[0]).toBe(f.id("Mo Member"));
    expect(w.pushes).toEqual([onTheWaitlist("mo@example.com")]);
  });

  it.each(SEEDS)("two Quarterly Members at once bump both, and each hears it once (seed %i)", async (seed) => {
    const f = await withQuarterlies();
    w.db.interleave(seed);
    await Promise.all([f.signUp(f.quinn), f.signUp(f.kit)]);
    w.db.interleave(null);
    expect((await f.night()).going.sort()).toEqual([f.id("Quinn Quarterly"), f.id("Kit Quarterly")].sort());
    expect(w.pushes.map((p) => `${p.token} ${p.title}`).sort()).toEqual([
      "token-mo@example.com On the waitlist",
      "token-reg@example.com On the waitlist",
    ]);
  });
});
