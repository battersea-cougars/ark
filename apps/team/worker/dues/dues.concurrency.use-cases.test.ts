// What people owe, worked out at once (docs/load-testing.md): every change that touches who came works the charges
// out again (api.ts `recharge`), and so does the hourly cron, so on a Friday a dozen of them can run together. A real
// D1 runs each statement atomically but interleaves two requests' statements between their awaits; the fake D1 does
// the same (`interleave`, a seed each run). Driven through the real handlers in the fake world (ADR 0031), the cron
// as Cloudflare runs it (`scheduled`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { chargeDue } from "./dues";

const PLAYERS = 12;
const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: PLAYERS }, (_, i) => ({
    name: `Player ${i + 1}`,
    position: "F",
    rating: 50,
    email: `p${i + 1}@example.com`,
  })),
];
const SEEDS = seeds(10);
// NOW is Tuesday 6 October 2026: the next Friday is the 9th
const FRIDAY = new Date("2026-10-09T17:00:00Z");

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** Friday's fee is £8; every player's in, and each has paid £20 ahead (credit, until Friday's charge comes due). */
async function paidAhead() {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.club()).body;
  const series = boot.series[0];
  expect(
    (await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence: 800, from: "2026-01-01" }] }))
      .status,
  ).toBe(200);
  const friday = boot.sessions.find((s: { heldOn: string }) => s.heldOn === "2026-10-09").id as number;
  const phones = [];
  for (let i = 1; i <= PLAYERS; i++) {
    const p = await w.signedIn(`p${i}@example.com`);
    expect((await p.call("POST", `/api/sessions/${friday}/answer`, { answer: "in" })).status).toBe(200);
    const id = boot.members.find((m: { name: string }) => m.name === `Player ${i}`).id;
    expect((await dana.call("POST", `/api/members/${id}/payments`, { via: "transfer", pence: 2000 })).status).toBe(200);
    phones.push(p);
  }
  expect(w.db.raw.prepare("SELECT COUNT(*) n FROM charges").get()).toEqual({ n: 0 });
  return { dana, friday, phones };
}

/** Money and charges as they must always be: nobody's charged twice, no payment spent past what came in, no charge
 * paid past what it costs. */
function holds() {
  expect(
    w.db.raw
      .prepare("SELECT session_id, member_id, COUNT(*) n FROM charges GROUP BY session_id, member_id HAVING n > 1")
      .all(),
  ).toEqual([]);
  expect(
    w.db.raw
      .prepare(
        `SELECT p.id FROM payments p WHERE p.amount_pence <
           (SELECT COALESCE(SUM(amount_pence), 0) FROM payment_allocations WHERE payment_id = p.id)`,
      )
      .all(),
  ).toEqual([]);
  expect(
    w.db.raw
      .prepare(
        `SELECT c.id FROM charges c WHERE c.amount_pence <
           (SELECT COALESCE(SUM(amount_pence), 0) FROM payment_allocations WHERE charge_id = c.id)`,
      )
      .all(),
  ).toEqual([]);
}

describe("charges worked out at once", () => {
  it.each(SEEDS)(
    "Friday comes due while players say they're in and the cron runs twice: each charged once, paid once from their credit (seed %i)",
    async (seed) => {
      const { friday } = await paidAhead();
      // Friday: the first hourly run and some late taps, at once; each works every charge out again
      const late = await w.signedIn("dana@example.com");
      w.db.interleave(seed);
      await Promise.all([
        chargeDue(w.env, FRIDAY),
        chargeDue(w.env, FRIDAY),
        w.scheduled("7 * * * *", FRIDAY),
        late.call("POST", `/api/sessions/${friday}/answer`, { answer: "in" }, { now: FRIDAY }),
        chargeDue(w.env, FRIDAY),
      ]);
      w.db.interleave(null);
      holds();
      // The players, and Dana, in on the night with nothing paid ahead
      expect(w.db.raw.prepare("SELECT COUNT(*) n FROM charges").get()).toEqual({ n: PLAYERS + 1 });
      // Each £8 night paid from the £20: £12 credit left each
      const spare = w.db.raw
        .prepare(
          `SELECT p.amount_pence - COALESCE((SELECT SUM(amount_pence) FROM payment_allocations WHERE payment_id = p.id), 0) n
         FROM payments p`,
        )
        .all() as { n: number }[];
      expect(spare.map((s) => s.n)).toEqual(Array.from({ length: PLAYERS }, () => 1200));
    },
  );

  it.each(SEEDS)(
    "two runs working the charges out at once, and nothing after: no credit spent twice (seed %i)",
    async (seed) => {
      await paidAhead();
      w.db.interleave(seed);
      await Promise.all([chargeDue(w.env, FRIDAY), chargeDue(w.env, FRIDAY)]);
      w.db.interleave(null);
      holds();
    },
  );
});
