// What people owe, with a year behind the club (ADR 0007, #222). Each tap on the register, and the hourly run, worked
// out every charge there's ever been: about 52,000 D1 rows a mark after a year, a night's register near half the free
// day. Now a change works out only what it touched (the night, the tournament, or the member) and the hourly run only
// what a new day can change (the nights and tournaments since it last ran, and the Quarterly Members). Each found by index,
// never by walking the club's history (the query plans), and the money as the whole club's working-out has it, to the
// penny. Driven through the real handlers, with a year of training nights seeded as `npm run load -- --weeks 52` does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";
import { seedHistory } from "../../../../scripts/lib/history.mjs";
import { chargesOf } from "./dues.testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Quinn Quarterly", position: "F", rating: 60, email: "quinn@example.com" },
  { name: "Mo Noshow", position: "D", rating: 55, email: "mo@example.com" },
  { name: "Wal Walkin", position: "F", rating: 55, email: "wal@example.com" },
  ...Array.from({ length: 10 }, (_, i) => ({
    name: `Skater ${i + 1}`,
    position: i % 3 ? "F" : "D",
    rating: 50,
    email: `s${i + 1}@example.com`,
  })),
];
// NOW is Tuesday 6 October 2026; the next Friday is the 9th
const NEXT_FRIDAY = "2026-10-09";
const FRIDAY_EVENING = new Date("2026-10-09T19:30:00Z");
/** The tables that grow with the club's history. */
const GROWING = ["attendance", "charges", "tournament_entries", "payment_allocations", "payments"];

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(() => vi.restoreAllMocks());

/** A year of training nights and their charges, and four Kumites, behind the club (scripts/lib/history.mjs). */
async function aYearBehind() {
  const raw = w.db.raw;
  await seedHistory(
    { rows: async (sql) => raw.prepare(sql).all() as Record<string, unknown>[], run: async (sql) => raw.exec(sql) },
    { today: "2026-10-05", weeks: 52, kumites: 4 },
  );
  const charges = (raw.prepare("SELECT COUNT(*) n FROM charges").get() as { n: number }).n;
  expect(charges).toBeGreaterThan(300);
}

/** Friday Training at £8 a night, everyone below in for the next Friday, Reg £20 in credit and Quinn Quarterly. */
async function fridayNight() {
  const dana = await w.signedIn("dana@example.com");
  const club = (await dana.club()).body as Json;
  const series = club.series[0];
  expect(
    (await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence: 800, from: "2026-01-01" }] }))
      .status,
  ).toBe(200);
  expect((await dana.call("POST", "/api/subscription-fees", { pence: 5000, from: "2026-01-01" })).status).toBe(200);
  const after = (await dana.club()).body as Json;
  const session = after.sessions.find((s: Json) => s.heldOn === NEXT_FRIDAY).id as number;
  const members = (await dana.call("GET", "/api/slices?names=members")).body.slices.members as Json[];
  const idOf = (name: string) => members.find((m) => m.name === name).id as number;
  for (const email of ["reg@example.com", "quinn@example.com", "mo@example.com"])
    expect(
      (await (await w.signedIn(email)).call("POST", `/api/sessions/${session}/answer`, { answer: "in" })).status,
    ).toBe(200);
  expect(
    (await dana.call("POST", `/api/members/${idOf("Reg Player")}/payments`, { via: "cash", pence: 2000 })).status,
  ).toBe(200);
  expect(
    (await dana.call("POST", `/api/members/${idOf("Quinn Quarterly")}/quarterly`, { quarterly: true })).status,
  ).toBe(200);
  return {
    dana,
    session,
    reg: idOf("Reg Player"),
    quinn: idOf("Quinn Quarterly"),
    mo: idOf("Mo Noshow"),
    wal: idOf("Wal Walkin"),
  };
}

/** Every statement the fake D1 prepares while `act` does, with the values it first ran with. */
async function statementsOf(act: () => Promise<unknown>) {
  const sent = new Map<string, unknown[]>();
  const raw = w.db.raw;
  const prepare = raw.prepare.bind(raw);
  const spy = vi.spyOn(raw, "prepare").mockImplementation(((sql: string) => {
    const st = prepare(sql);
    for (const m of ["all", "get", "run"] as const) {
      const f = st[m].bind(st) as (...p: unknown[]) => unknown;
      (st as unknown as Record<string, unknown>)[m] = (...params: unknown[]) => {
        if (!sent.has(sql)) sent.set(sql, params);
        return f(...params);
      };
    }
    return st;
  }) as typeof raw.prepare);
  await act();
  spy.mockRestore();
  return sent;
}

/** The table a plan's name stands for: itself, or the table it's an alias of in the statement. */
const tableOf = (sql: string, name: string) =>
  new RegExp(`\\b(${GROWING.join("|")})\\s+(?:AS\\s+)?${name}\\b`, "i").exec(sql)?.[1] ?? name;

/** The statements on charges whose plans walk a growing table (or all of an index of one), not search it by index. */
function walked(sent: Map<string, unknown[]>) {
  const out: string[] = [];
  for (const [sql, params] of sent) {
    // The club's own reads (WITH viewer ...) are what the app shows, not what works out charges
    if (/^\s*(EXPLAIN|PRAGMA|WITH viewer)/i.test(sql) || !/charges|payment_allocations/.test(sql)) continue;
    const plan = w.db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
    for (const { detail } of plan) {
      // A scan, or a search on a range only (`IS NOT NULL` is one), of a growing table; an index of only what's
      // outstanding (credit, what's owed) is fine
      const name = /^(?:SCAN (\w+)(?! VIRTUAL)|SEARCH (\w+) USING .*\(\w+[<>]\?\)$)/
        .exec(detail)
        ?.slice(1)
        .find(Boolean);
      if (process.env.PLANS) console.info(detail, sql.replace(/\s+/g, " ").slice(0, 100));
      if (name && GROWING.includes(tableOf(sql, name)) && !/INDEX (payments_spare|charges_owing)/.test(detail))
        out.push(`${detail}: ${sql.replace(/\s+/g, " ").slice(0, 160)}`);
    }
  }
  return out;
}

/** Every charge and what's paid on it, and every payment's spending: what the club's money is. */
const money = () => ({
  charges: w.db.raw
    .prepare(
      `SELECT member_id, session_id, tournament_id, quarter, reason, amount_pence, due_on, paid_pence FROM charges
       ORDER BY member_id, due_on, session_id, tournament_id, quarter`,
    )
    .all(),
  payments: w.db.raw.prepare("SELECT member_id, amount_pence, spent_pence FROM payments ORDER BY id").all(),
});

const mark = (dana: Browser, session: number, memberId: number, here: boolean) =>
  dana.call("POST", `/api/sessions/${session}/register`, { memberId, here }, { now: FRIDAY_EVENING });

describe("the register on a Friday, with a year of nights behind the club", () => {
  it("each mark works out that night's charges by index, not every charge there's been", async () => {
    await aYearBehind();
    const f = await fridayNight();
    // The day's first open, as on the night: what the day makes due is charged before the register
    await f.dana.call("GET", "/api/bootstrap", undefined, { now: FRIDAY_EVENING });
    const sent = await statementsOf(async () => expect((await mark(f.dana, f.session, f.reg, true)).status).toBe(200));
    expect([...sent.keys()].some((s) => /INSERT INTO charges/.test(s))).toBe(true);
    expect(walked(sent)).toEqual([]);
  });

  it("the hourly run works out only what a new day can change, by index", async () => {
    await aYearBehind();
    await fridayNight();
    const sent = await statementsOf(() => w.scheduled("7 * * * *", FRIDAY_EVENING));
    expect([...sent.keys()].some((s) => /INSERT INTO charges/.test(s))).toBe(true);
    expect(walked(sent)).toEqual([]);
  });

  it("what everyone owes comes out as the whole club's working-out has it, to the penny", async () => {
    await aYearBehind();
    const f = await fridayNight();
    await f.dana.call("GET", "/api/bootstrap", undefined, { now: FRIDAY_EVENING });
    for (const [who, here] of [
      [f.reg, true],
      [f.quinn, true],
      [f.mo, false],
      [f.wal, true],
    ] as const)
      expect((await mark(f.dana, f.session, who, here)).status).toBe(200);
    await w.scheduled("7 * * * *", FRIDAY_EVENING);
    // Reg's night paid from his credit; Quinn's quarter pays for hers; Mo didn't come; Wal walked in
    const tonight = async (who: number) =>
      (await chargesOf(f.dana, who, FRIDAY_EVENING))
        .filter((c) => c.refId === f.session)
        .map((c) => [c.pence, c.paidPence]);
    expect(await tonight(f.reg)).toEqual([[800, 800]]);
    expect(await tonight(f.quinn)).toEqual([]);
    expect(await tonight(f.mo)).toEqual([]);
    expect(await tonight(f.wal)).toEqual([[800, 0]]);
    // The whole club's working-out (Recalculate) changes nothing
    const scoped = money();
    expect(
      (await f.dana.call("POST", `/api/members/${f.reg}/recalculate`, undefined, { now: FRIDAY_EVENING })).status,
    ).toBe(200);
    expect(money()).toEqual(scoped);
  });
});
