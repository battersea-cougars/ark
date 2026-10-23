// In-memory SQLite that quacks like the subset of D1Database we use, as a fresh database starts: db/schema.sql with
// the club's seed (db/seed/club.sql) until launch, then every migration in db/migrations/ in order (ADR 0050).
// For Vitest only.
import Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DB_DIR = join(import.meta.dirname, "../../../db");
const MIGRATIONS = join(DB_DIR, "migrations");

/** The files that make the database, in order. */
function sources(): string[] {
  const migrations = existsSync(MIGRATIONS) ? readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")) : [];
  if (migrations.length) return migrations.sort().map((f) => join(MIGRATIONS, f));
  return [join(DB_DIR, "schema.sql"), join(DB_DIR, "seed/club.sql")];
}

export interface TestD1 {
  raw: Database.Database;
  /** Round trips to D1 so far (a batch is one): each costs the Worker CPU time (ADR 0059). */
  roundTrips: number;
  /** Statements sent so far, each statement of a batch counted: what D1 reads and bills, however they travel. */
  statements: number;
  /**
   * Told of every round trip as it's sent, with the statements it carries: the fake world counts them against the
   * request (or cron run) that sent it, however many run at once (ADR 0003's per-request budget).
   */
  onRoundTrip: ((sql: string[]) => void) | null;
  /** Time spent inside SQLite so far, in ms: D1's own work, which isn't the Worker's CPU time. */
  sqlMs: number;
  /**
   * Requests at once, as D1 serves them (docs/load-testing.md): from here on each round trip lands at a moment
   * chosen by a seeded generator, a few turns of the event loop after it was sent, and its reply comes back a few
   * turns after that, so two requests' statements interleave at their awaits the way they can on D1. Each statement,
   * and each batch, is still atomic. `null` turns it off (the default: in order, at once).
   */
  interleave(seed: number | null): void;
}

/**
 * The seeds a concurrency test runs under: 1 to `n`, or as many as INTERLEAVE_SEEDS says, to look further for a race
 * (`INTERLEAVE_SEEDS=500 npx vitest run concurrency`), and any seed that once found one (`found`), kept as its proof.
 * A seed is one order of events, run after run (testing/crypto.ts), so a failing one can be run again to see it.
 */
export function seeds(n: number, ...found: number[]): number[] {
  const wanted = Number(process.env.INTERLEAVE_SEEDS) || n;
  return [...new Set([...Array.from({ length: wanted }, (_, i) => i + 1), ...found])];
}

/** A small seeded generator (mulberry32): the same seed, the same interleaving. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

export function createTestD1(): D1Database & TestD1 {
  const sqlite = new Database(":memory:");
  for (const file of sources()) sqlite.exec(readFileSync(file, "utf8"));
  const d1 = { roundTrips: 0, statements: 0, sqlMs: 0, onRoundTrip: null } as D1Database & TestD1;
  let luck: (() => number) | null = null;
  /**
   * On the way to D1, or back, when interleaving: a few turns of the event loop, mostly none to two but now and then
   * many (an exponential's tail, at most 24), as D1's own latency has a tail. Without the tail a request rarely fell
   * far enough behind another to find the races between three or four round trips (the goal and full time, ADR 0121).
   */
  const travel = async () => {
    for (let n = Math.min(24, Math.floor(-Math.log(1 - luck!()) * 2)); n > 0; n--)
      await new Promise((r) => setImmediate(r));
  };
  /** One round trip: there, the work done in one go (atomic), and back. */
  const roundTrip = async <T>(work: () => T, sql: string[]): Promise<T> => {
    d1.roundTrips++;
    d1.statements += sql.length;
    d1.onRoundTrip?.(sql);
    if (luck) await travel();
    const t = performance.now();
    let out: T;
    try {
      out = work();
    } finally {
      d1.sqlMs += performance.now() - t;
    }
    if (luck) await travel();
    return out;
  };

  const prepare = (sql: string) => {
    let params: unknown[] = [];
    // As one statement of a batch: a SELECT's rows, or what a change changed
    const runNow = () => {
      const prepared = sqlite.prepare(sql);
      if (prepared.reader) return { success: true, results: prepared.all(...params), meta: {} };
      const info = prepared.run(...params);
      return {
        success: true,
        results: [],
        meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes },
      };
    };
    const stmt = {
      bind(...p: unknown[]) {
        params = p;
        return stmt;
      },
      all() {
        return roundTrip(() => ({ results: sqlite.prepare(sql).all(...params), success: true, meta: {} }), [sql]);
      },
      first() {
        return roundTrip(() => sqlite.prepare(sql).get(...params) ?? null, [sql]);
      },
      run() {
        return roundTrip(runNow, [sql]);
      },
      runNow,
      sql,
    };
    return stmt;
  };
  // As D1's: in order, in one transaction, all or nothing
  const batch = (stmts: { runNow: () => unknown; sql: string }[]) =>
    roundTrip(
      () => sqlite.transaction(() => stmts.map((s) => s.runNow()))(),
      stmts.map((s) => s.sql),
    );
  const interleave = (seed: number | null) => void (luck = seed === null ? null : seeded(seed));

  return Object.assign(d1, { prepare, batch, interleave, raw: sqlite });
}
