// How near the club is to each free limit (ADR 0059, #148): each hourly check keeps, in usage_levels, every limit it
// read that's at 70% or more, and only those; the admins' Home asks for them and says the nearest in one row. Today's
// Cloudflare limits are the UTC day's, Sanity's the month's; a row from a day or month that's over isn't shown. Push
// and email at these levels are #157's.
import { all, batch, statement } from "@cougars/shared/d1";
import { nextMonth } from "@cougars/shared/sanity-requests";
import type { Usage } from "./usage";

/** From here a limit is worth saying (Home says 90% and over louder). */
const NEAR_AT = 70;

/** A limit at 70% or more, as Home says it. `period`: today's (UTC) or this month's; `resetsAt`: when it starts again. */
export interface Level {
  id: string;
  label: string;
  percent: number;
  period: "day" | "month";
  resetsAt: string;
}

/** What one check found: the limits it could read, and those of them at 70% or more. */
interface Found {
  read: string[];
  near: { id: string; period: string; label: string; percent: number }[];
}

const percentOf = (used: number, limit: number) => Math.floor((used / limit) * 100);

/** Each limit the check read, as a level: Cloudflare's only when it could be read, Sanity's (ours) always. */
function levelsOf(usage: Usage): Found {
  const cloudflare = usage.configured && !usage.unavailable;
  const day = cloudflare
    ? usage.metrics.map((m) => ({ id: m.id, period: usage.day, label: m.label, percent: percentOf(m.used, m.limit) }))
    : [];
  // A request stopped for its CPU time went past the free plan's 10 ms: that limit is spent (ADR 0059)
  const stopped = (usage.cpu?.workers ?? []).some((w) => w.stopped);
  const cpu = cloudflare
    ? [{ id: "cpu", period: usage.day, label: "Requests stopped for CPU time", percent: stopped ? 100 : 0 }]
    : [];
  const month = usage.sanity.quotas.map((q) => ({
    id: `sanity-${q.id}`,
    period: usage.sanity.month,
    label: `Sanity ${q.label}`,
    percent: percentOf(q.used, q.limit),
  }));
  const limits = [...day, ...cpu, ...month];
  return { read: limits.map((l) => l.id), near: limits.filter((l) => l.percent >= NEAR_AT) };
}

/** Replace what this check read with what it found, in one round trip: a limit back under 70% goes. */
export async function saveLevels(db: D1Database, usage: Usage) {
  const { read, near } = levelsOf(usage);
  await batch(db, [
    statement(db, "DELETE FROM usage_levels WHERE metric IN (SELECT value FROM json_each(?))", [JSON.stringify(read)]),
    statement(
      db,
      `INSERT INTO usage_levels (metric, period, label, percent)
       SELECT value ->> 'id', value ->> 'period', value ->> 'label', value ->> 'percent' FROM json_each(?)`,
      [JSON.stringify(near)],
    ),
  ]);
}

/** The limits at 70% or more now, nearest first: today's and this month's, not a day's that's over. */
export async function readLevels(db: D1Database, now: Date): Promise<Level[]> {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const rows = await all<{ id: string; period: string; label: string; percent: number }>(
    db,
    `SELECT metric id, period, label, percent FROM usage_levels WHERE period IN (?, ?)
     ORDER BY percent DESC, metric`,
    [day, month],
  );
  const tomorrow = new Date(Date.parse(day) + 86_400_000).toISOString();
  const monthAfter = new Date(nextMonth(now)).toISOString();
  return rows.map((row) => {
    const daily = row.period === day;
    return {
      id: row.id,
      label: row.label,
      percent: row.percent,
      period: daily ? "day" : "month",
      resetsAt: daily ? tomorrow : monthAfter,
    };
  });
}
