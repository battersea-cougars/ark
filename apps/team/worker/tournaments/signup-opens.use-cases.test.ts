// When a tournament's sign-up opens (ADR 0128, 0108), members hear it once: on the day it's set to open, from the cron,
// or straight away when an admin opens it by hand. The Kumite is invitation-only, as in Bloodsport, so its notification
// is an invitation ("An invitation has arrived"); any other tournament says its sign-up's open. Opened again (Back to
// Sign-up open), it isn't news. Driven through the real handlers and the cron in the fake world (ADR 0031).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Player", position: "D", rating: 55, email: "mo@example.com" },
];
/** The Kumite series, as the club's seed has it (db/seed/club.sql): The Cougars Kumite. */
const KUMITE = 1;
/** NOW is Tuesday 6 October 2026. Sign-up opens on Monday the 12th, five past midnight in London. */
const OPENS_ON = "2026-10-12";
const OPENING = new Date("2026-10-11T23:05:00Z");
const DAY_BEFORE = new Date("2026-10-11T22:50:00Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(() => vi.restoreAllMocks());

/** What members' phones were told about tournaments (a training night opening the same Monday is its own news). */
const told = () => w.pushes.filter((p) => !p.path.startsWith("/training/friday/"));

/** A phone with the app, signed in as this member. */
async function phone(email: string) {
  const b = await w.signedIn(email);
  expect((await b.call("PUT", "/api/auth/device", { token: `token-${email}`, platform: "ios" })).status).toBe(200);
}

/** An admin schedules a tournament on Friday 23 October: the Kumite, or one in no series. */
async function schedule(o: { typeId?: number; status?: string; signupOpensOn?: string | null; name?: string } = {}) {
  const dana = await w.signedIn("dana@example.com");
  const made = await dana.call("POST", "/api/tournaments", {
    typeId: o.typeId,
    name: o.name ?? "Kumite Autumn 2026",
    heldOn: "2026-10-23",
    startTime: "19:00",
    endTime: "21:30",
    status: o.status ?? "planned",
    feePence: 0,
    kind: "draft",
    signupOpensOn: o.signupOpensOn === undefined ? OPENS_ON : o.signupOpensOn,
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  const saved = async () => ((await dana.club()).body as Json).tournaments.find((x: Json) => x.id === id) as Json;
  /** The editor's Save, everything it had with these changes. */
  const save = async (changes: object, now = NOW) =>
    dana.call("PUT", `/api/tournaments/${id}`, { ...(await saved()), ...changes }, { now });
  return { id, dana, save };
}

describe("a tournament's sign-up opens and members hear it", () => {
  it("the Kumite's is an invitation: on its opening day, once, however often the cron runs", async () => {
    await phone("reg@example.com");
    await phone("mo@example.com");
    await schedule({ typeId: KUMITE });
    await w.scheduled("*/5 * * * *", NOW);
    await w.scheduled("*/5 * * * *", DAY_BEFORE);
    expect(told()).toEqual([]);
    await w.scheduled("*/5 * * * *", OPENING);
    await w.scheduled("*/5 * * * *", new Date(OPENING.getTime() + 5 * 60_000));
    await w.scheduled("7 * * * *", new Date(OPENING.getTime() + 2 * 60_000));
    expect(told()).toHaveLength(2);
    expect(told()[0]).toMatchObject({
      title: "An invitation has arrived",
      body: "The Cougars Kumite, Fri 23 Oct.",
      path: "/tournaments/kumite",
    });
  });

  it("any other tournament just says its sign-up's open", async () => {
    await phone("reg@example.com");
    await schedule({ name: "Summer Cup" });
    await w.scheduled("*/5 * * * *", OPENING);
    expect(told()).toHaveLength(1);
    expect(told()[0]).toMatchObject({ title: "Summer Cup: sign-up's open", body: "Say you're in for Fri 23 Oct." });
  });

  it("an admin opening it by hand sends the invitation at once, and only the first time", async () => {
    await phone("reg@example.com");
    const k = await schedule({ typeId: KUMITE, signupOpensOn: null });
    expect((await k.save({ status: "open" })).status).toBe(200);
    expect(told().map((p) => p.title)).toEqual(["An invitation has arrived"]);
    // Saved again, or the cron on what would have been its day: nothing new
    expect((await k.save({ capacity: 30 })).status).toBe(200);
    await w.scheduled("*/5 * * * *", OPENING);
    expect(told()).toHaveLength(1);
  });

  it("one an admin makes with its sign-up open sends the invitation as it's made", async () => {
    await phone("reg@example.com");
    await schedule({ typeId: KUMITE, status: "open", signupOpensOn: null });
    expect(told().map((p) => p.title)).toEqual(["An invitation has arrived"]);
  });

  it("two cron runs at once send it once", async () => {
    await phone("reg@example.com");
    await schedule({ typeId: KUMITE });
    await Promise.all([w.scheduled("*/5 * * * *", OPENING), w.scheduled("7 * * * *", OPENING)]);
    expect(told()).toHaveLength(1);
  });

  it("a member who's already said Out (or declined) isn't told; the rest are", async () => {
    await phone("reg@example.com");
    await phone("mo@example.com");
    const k = await schedule({ typeId: KUMITE });
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/tournaments/${k.id}/answer`, { answer: "out" })).status).toBe(200);
    await w.scheduled("*/5 * * * *", OPENING);
    const boot = (await k.dana.club()).body as Json;
    const mo = boot.members.find((m: Json) => m.name === "Mo Player").id as number;
    expect(told().map((p) => p.memberId)).toEqual([mo]);
  });

  it("opened by hand, the same: one who's said Out isn't told", async () => {
    await phone("reg@example.com");
    await phone("mo@example.com");
    const k = await schedule({ name: "Summer Cup", signupOpensOn: null });
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/tournaments/${k.id}/answer`, { answer: "out" })).status).toBe(200);
    expect((await k.save({ status: "open" })).status).toBe(200);
    const boot = (await k.dana.club()).body as Json;
    const mo = boot.members.find((m: Json) => m.name === "Mo Player").id as number;
    expect(told().map((p) => p.memberId)).toEqual([mo]);
  });

  it("a member who turned off Your place isn't told", async () => {
    await phone("reg@example.com");
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("PUT", "/api/me/notifications", { places: false })).status).toBe(200);
    await schedule({ typeId: KUMITE });
    await w.scheduled("*/5 * * * *", OPENING);
    expect(told()).toEqual([]);
  });

  it("one made with its sign-up already open isn't news to the cron", async () => {
    await phone("reg@example.com");
    await schedule({ typeId: KUMITE, signupOpensOn: "2026-10-01" });
    await w.scheduled("*/5 * * * *", NOW);
    await w.scheduled("*/5 * * * *", OPENING);
    expect(told()).toEqual([]);
  });
});

describe("before a tournament's sign-up opens", () => {
  // Refused in the app's words, the day in Europe/London (lib/signup.ts opensWords), not a date code (#170)
  it("a member saying in is told when it opens, in words: within the week its weekday, further off with its date", async () => {
    const { id } = await schedule({ typeId: KUMITE });
    const reg = await w.signedIn("reg@example.com");
    const tuesday = await reg.call("POST", `/api/tournaments/${id}/answer`, { answer: "in" });
    expect(tuesday.status).toBe(409);
    expect(tuesday.body.error).toBe("Sign-up opens Monday.");
    const weekBefore = new Date("2026-10-02T12:00:00Z");
    const earlier = await reg.call("POST", `/api/tournaments/${id}/answer`, { answer: "in" }, { now: weekBefore });
    expect(earlier.body.error).toBe("Sign-up opens Monday 12 October.");
  });
});
