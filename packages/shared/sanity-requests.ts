// Our own count of the requests we make to Sanity (ADR 0059). Sanity has no usage API, and its free plan stops a
// project for the rest of the month once a quota is spent: 250,000 requests to its API (`<project>.api.sanity.io`) and
// 1,000,000 to its API CDN (`<project>.apicdn.sanity.io`) a month, reset at 00:00 UTC on the 1st. Sanity counts only
// answers that aren't a 4xx or 5xx, and nothing the Studio does, so we count the same.
//
//   - Every read goes through `sanityFetch` (or calls `countSanity` with its answer): counted in memory, per UTC day,
//     project and quota.
//   - `flushSanityRequests` adds them to D1's sanity_requests in one round trip, after the request (the website's
//     middleware, the team Worker), and learns the month so far for `nearSanityLimit`.
//   - A build counts in memory too; astro.config's integration sends its count to the environment's D1 when it's done.
//
// The tally lives on globalThis so the build's integration sees what its prerendered pages counted (another copy of
// this module).
import { batch, statement } from "./d1";

export type SanityKind = "api" | "cdn";

/** Sanity's free plan, a month (sanity.io/pricing, checked 2026-10-20). */
export const SANITY_FREE: Record<SanityKind, number> = { api: 250_000, cdn: 1_000_000 };
export const SANITY_LABELS: Record<SanityKind, string> = { api: "API requests", cdn: "API CDN requests" };

export interface SanityCount {
  day: string;
  project: string;
  kind: SanityKind;
  count: number;
}

interface Tally {
  /** Counted and not yet in D1: `day|project|kind` → requests. */
  pending: Map<string, number>;
  /** The month so far as D1 had it at the last flush: `project|kind` → requests. */
  month: Map<string, { month: string; used: number }>;
}
const KEY = Symbol.for("cougars.sanity-requests");
const tally = ((globalThis as Record<symbol, Tally>)[KEY] ??= { pending: new Map(), month: new Map() });

/** Which project and quota a URL counts towards, or null if it isn't Sanity's API (its image CDN isn't). */
export function sanityTarget(url: URL | string): { project: string; kind: SanityKind } | null {
  const m = /^([a-z0-9]+)\.(api|apicdn)\.sanity\.io$/.exec(new URL(url).hostname);
  return m ? { project: m[1], kind: m[2] === "apicdn" ? "cdn" : "api" } : null;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);
const monthOf = (now: Date) => now.toISOString().slice(0, 7);

/** Count one answer from Sanity, if it's one Sanity counts (not a 4xx or 5xx). */
export function countSanity(url: URL | string, status: number, now = new Date()) {
  const target = sanityTarget(url);
  if (!target || status >= 400) return;
  const key = `${dayOf(now)}|${target.project}|${target.kind}`;
  tally.pending.set(key, (tally.pending.get(key) ?? 0) + 1);
}

/** `fetch`, counted. */
export async function sanityFetch(url: URL | string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  countSanity(url, res.status);
  return res;
}

export const hasPendingSanityRequests = () => tally.pending.size > 0;

/** What's been counted and not sent, and forget it. */
export function takeSanityRequests(): SanityCount[] {
  const rows = [...tally.pending].map(([key, count]) => {
    const [day, project, kind] = key.split("|");
    return { day, project, kind: kind as SanityKind, count };
  });
  tally.pending.clear();
  return rows;
}

/** Add the counts to the day's in sanity_requests: one statement, however many rows. */
export const ADD_SQL = `INSERT INTO sanity_requests (day, project, kind, count)
  SELECT value ->> '$.day', value ->> '$.project', value ->> '$.kind', value ->> '$.count' FROM json_each(?) WHERE true
  ON CONFLICT (day, project, kind) DO UPDATE SET count = count + excluded.count`;

/**
 * Send what's been counted to D1, with the month so far for those projects, in one round trip. Nothing counted costs
 * nothing. On failure the counts are kept for the next try.
 */
export async function flushSanityRequests(db: D1Database, now = new Date()) {
  const rows = takeSanityRequests();
  if (!rows.length) return;
  const month = monthOf(now);
  const projects = [...new Set(rows.map((r) => r.project))];
  try {
    const [, sums] = await batch<{ project: string; kind: SanityKind; used: number }>(db, [
      statement(db, ADD_SQL, [JSON.stringify(rows)]),
      statement(
        db,
        `SELECT project, kind, SUM(count) used FROM sanity_requests
         WHERE day >= ? AND day < ? AND project IN (SELECT value FROM json_each(?)) GROUP BY project, kind`,
        [`${month}-01`, `${month}-32`, JSON.stringify(projects)],
      ),
    ]);
    for (const s of sums.results) tally.month.set(`${s.project}|${s.kind}`, { month, used: s.used });
  } catch (error) {
    for (const r of rows) {
      const key = `${r.day}|${r.project}|${r.kind}`;
      tally.pending.set(key, (tally.pending.get(key) ?? 0) + r.count);
    }
    throw error;
  }
}

/** True once this month's requests to a project's quota have reached `share` of it, as of the last flush. */
export function nearSanityLimit(project: string, kind: SanityKind, share: number, now = new Date()) {
  const known = tally.month.get(`${project}|${kind}`);
  return known?.month === monthOf(now) && known.used >= SANITY_FREE[kind] * share;
}

/** 00:00 UTC on the 1st of next month, as epoch ms: when Sanity's quotas reset. */
export const nextMonth = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);

/** Forget everything counted and learnt (tests). */
export function resetSanityRequests() {
  tally.pending.clear();
  tally.month.clear();
}
