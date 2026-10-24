// Friday sign-up opening, everyone at once (docs/load-testing.md). A real D1 runs each statement, and each batch,
// atomically, but two requests' statements interleave between their awaits; the fake D1 interleaves them the same way
// (`interleave`, a seed each run), so a decision counted in one statement and written in the next is caught. Driven
// through the real Worker handlers, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const SKATERS = 30;
const QUARTERLY = 4;
const KEEPERS = 3;
const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: SKATERS }, (_, i) => ({
    name: `Skater ${i + 1}`,
    position: i % 3 ? "F" : "D",
    rating: 50,
    email: `s${i + 1}@example.com`,
  })),
  ...Array.from({ length: QUARTERLY }, (_, i) => ({
    name: `Quarterly ${i + 1}`,
    position: "F",
    rating: 50,
    email: `q${i + 1}@example.com`,
  })),
  ...Array.from({ length: KEEPERS }, (_, i) => ({
    name: `Keeper ${i + 1}`,
    position: "G",
    rating: 50,
    email: `k${i + 1}@example.com`,
  })),
];
const skaters = Array.from({ length: SKATERS }, (_, i) => `s${i + 1}@example.com`);
const quarterlies = Array.from({ length: QUARTERLY }, (_, i) => `q${i + 1}@example.com`);
const keepers = Array.from({ length: KEEPERS }, (_, i) => `k${i + 1}@example.com`);
/** Each run interleaves the requests differently. */
const SEEDS = seeds(5);

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  taps = 0;
});

/** Each tap a millisecond after the one before: each phone's own moment. */
let taps = 0;
const tapAt = () => ({ now: new Date(NOW.getTime() + ++taps) });

/**
 * Next Friday with 20 skaters' places and 2 keepers', the Quarterly members made so by an admin, and everyone signed
 * in already (sign-in isn't the rush).
 */
async function friday({ places = 20, keeperPlaces = 2 as number | null } = {}) {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.club()).body as Json;
  const idOf = new Map<string, number>(boot.members.map((m: Json) => [m.email ?? m.name, m.id]));
  const byName = new Map<string, number>(boot.members.map((m: Json) => [m.name, m.id]));
  const series = boot.series[0];
  const saved = await dana.call("PUT", `/api/series/${series.id}`, {
    ...series,
    capacity: places,
    goalieCapacity: keeperPlaces,
  });
  expect(saved.status).toBe(200);
  for (let i = 1; i <= QUARTERLY; i++) {
    const r = await dana.call("POST", `/api/members/${byName.get(`Quarterly ${i}`)}/quarterly`, { quarterly: true });
    expect(r.status).toBe(200);
  }
  const session = ((await dana.club()).body as Json).sessions.find((s: Json) => s.heldOn >= "2026-10-06");
  const phones = new Map<string, Awaited<ReturnType<typeof w.signedIn>>>();
  for (const email of [...skaters, ...quarterlies, ...keepers]) phones.set(email, await w.signedIn(email));
  const id = (email: string) => {
    const n = email.match(/^([sqk])(\d+)@/)!;
    const name = { s: "Skater", q: "Quarterly", k: "Keeper" }[n[1] as "s" | "q" | "k"];
    return byName.get(`${name} ${n[2]}`) ?? idOf.get(email)!;
  };
  /** Everyone given taps at once, each a millisecond after the one before. */
  const atOnce = (given: [string, "in" | "out"][]) =>
    Promise.all(
      given.map(([email, answer]) =>
        phones.get(email)!.call("POST", `/api/sessions/${session.id}/answer`, { answer }, tapAt()),
      ),
    );
  /** Taps one after another, each answered before the next: how a night fills over a week. */
  const inTurn = async (given: [string, "in" | "out"][]) => {
    for (const tap of given) await atOnce([tap]);
  };
  /** The night as the database has it: each list in its one order. */
  const seen = async () => ((await dana.club()).body as Json).sessions.find((s: Json) => s.id === session.id);
  /** Each member's rows: never more than one. */
  const rows = () =>
    w.db.raw
      .prepare("SELECT member_id m, COUNT(*) n FROM attendance WHERE session_id = ? GROUP BY member_id")
      .all(session.id) as { m: number; n: number }[];
  const keeperIds = new Set(keepers.map(id));
  return { session, id, atOnce, inTurn, seen, rows, keeperIds };
}

describe("Friday sign-up opens: everyone taps In at once", () => {
  it.each(SEEDS)(
    "30 skaters for 20 places: 20 in, 10 waiting in sign-up order, nobody twice (seed %i)",
    async (seed) => {
      const f = await friday();
      w.db.interleave(seed);
      const replies = await f.atOnce(skaters.map((e) => [e, "in"]));
      w.db.interleave(null);
      expect(replies.map((r) => r.status)).toEqual(skaters.map(() => 200));
      const night = await f.seen();
      expect(night.going).toHaveLength(20);
      expect(night.waitlist).toHaveLength(10);
      expect(f.rows().every((r) => r.n === 1)).toBe(true);
      expect(new Set([...night.going, ...night.waitlist]).size).toBe(30);
      // The waiting list is in the order they tapped, whichever landed first
      const tapped = skaters.map(f.id);
      expect(night.waitlist).toEqual(tapped.filter((m) => night.waitlist.includes(m)));
    },
  );

  it.each(SEEDS)(
    "keepers are counted on their own side: 2 keepers' places, 3 keepers, 22 skaters (seed %i)",
    async (seed) => {
      const f = await friday();
      w.db.interleave(seed);
      // Interleaved: keepers among the skaters
      const taps: [string, "in"][] = skaters.slice(0, 22).map((e) => [e, "in"]);
      taps.splice(3, 0, [keepers[0], "in"]);
      taps.splice(11, 0, [keepers[1], "in"]);
      taps.splice(17, 0, [keepers[2], "in"]);
      await f.atOnce(taps);
      w.db.interleave(null);
      const night = await f.seen();
      const keepersIn = night.going.filter((m: number) => f.keeperIds.has(m));
      const keepersWaiting = night.waitlist.filter((m: number) => f.keeperIds.has(m));
      expect(keepersIn).toHaveLength(2);
      expect(keepersWaiting).toHaveLength(1);
      expect(night.going.length - keepersIn.length).toBe(20);
      expect(night.waitlist.length - keepersWaiting.length).toBe(2);
    },
  );

  it.each(SEEDS)(
    "Quarterly members tapping in at once with everyone else each take a place; those bumped wait first (seed %i)",
    async (seed) => {
      const f = await friday();
      // The night's already full of skaters paying as they go
      await f.inTurn(skaters.slice(0, 20).map((e) => [e, "in"]));
      w.db.interleave(seed);
      // Then the Quarterly members, and the last ten skaters, all at once
      const taps: [string, "in"][] = [...skaters.slice(20).map((e): [string, "in"] => [e, "in"])];
      quarterlies.forEach((q, i) => taps.splice(i * 3, 0, [q, "in"]));
      await f.atOnce(taps);
      w.db.interleave(null);
      const night = await f.seen();
      const q = quarterlies.map(f.id);
      expect(night.going).toHaveLength(20);
      expect(night.waitlist).toHaveLength(14);
      expect(night.going.slice(0, QUARTERLY).sort()).toEqual([...q].sort());
      // The four bumped are the last four in (skaters 17–20), and they're at the top of the waiting list, in their order
      expect(night.waitlist.slice(0, 4)).toEqual(skaters.slice(16, 20).map(f.id));
      expect(f.rows().every((r) => r.n === 1)).toBe(true);
    },
  );

  it.each(SEEDS)(
    "a place freed while several sign up goes to the first waiting, not a newcomer (seed %i)",
    async (seed) => {
      const f = await friday();
      // Full, with five waiting
      await f.inTurn(skaters.slice(0, 25).map((e) => [e, "in"]));
      const before = await f.seen();
      expect(before.waitlist).toEqual(skaters.slice(20, 25).map(f.id));
      w.db.interleave(seed);
      // Skater 1 drops out while five more tap in
      await f.atOnce([
        [skaters[25], "in"],
        [skaters[26], "in"],
        [skaters[0], "out"],
        [skaters[27], "in"],
        [skaters[28], "in"],
        [skaters[29], "in"],
      ]);
      w.db.interleave(null);
      const night = await f.seen();
      expect(night.going).toHaveLength(20);
      expect(night.going).toContain(f.id(skaters[20]));
      expect(night.going).not.toContain(f.id(skaters[0]));
      for (const late of skaters.slice(25)) expect(night.going).not.toContain(f.id(late));
      expect(night.waitlist).toEqual(skaters.slice(21).map(f.id));
    },
  );

  it.each(SEEDS)("a double tap on the last place keeps it (seed %i)", async (seed) => {
    const f = await friday();
    await f.inTurn(skaters.slice(0, 19).map((e) => [e, "in"]));
    w.db.interleave(seed);
    // Skater 20 taps twice (a slow phone), for the last place
    await f.atOnce([
      [skaters[19], "in"],
      [skaters[19], "in"],
    ]);
    w.db.interleave(null);
    const night = await f.seen();
    expect(night.going).toHaveLength(20);
    expect(night.going).toContain(f.id(skaters[19]));
    expect(night.waitlist).toEqual([]);
  });

  it.each(SEEDS)("out twice at once lets exactly one waiting in (seed %i)", async (seed) => {
    const f = await friday();
    await f.inTurn(skaters.slice(0, 23).map((e) => [e, "in"]));
    w.db.interleave(seed);
    await f.atOnce([
      [skaters[0], "out"],
      [skaters[0], "out"],
    ]);
    w.db.interleave(null);
    const night = await f.seen();
    expect(night.going).toHaveLength(20);
    expect(night.waitlist).toEqual(skaters.slice(21, 23).map(f.id));
  });
});
