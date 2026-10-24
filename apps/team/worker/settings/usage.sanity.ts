// The club's Sanity requests this month (ADR 0059). Sanity has no usage API, so the website and this app count their
// own (packages/shared/sanity-requests.ts) into sanity_requests: one row per UTC day, project and quota. The Usage
// page shows this environment's project against the free plan, with where the month's pace ends up; the hourly check
// (usage.ts) emails the admins at 50% and 80%, and when the pace would run out before the 1st.
import { statement } from "@cougars/shared/d1";
import { SANITY_FREE, SANITY_LABELS, nextMonth, type SanityKind } from "@cougars/shared/sanity-requests";
import { sanityProject } from "@cougars/shared/sanity";

export interface SanityQuota {
  id: SanityKind;
  label: string;
  used: number;
  limit: number;
  /** Where the month ends at this month's pace so far. */
  projected: number;
}

export interface SanityUsage {
  project: string;
  /** The project's name in Sanity: Cougars or Cougars Dev. */
  name: string;
  /** This month, in UTC (Sanity's): 2026-10. */
  month: string;
  resetsAt: string;
  quotas: SanityQuota[];
}

const DAY = 86_400_000;
/** Too early in the month to judge its pace: a first day says little. */
export const PACE_AFTER_DAYS = 3;

/**
 * This month's count for the environment's project: the statement, to send in the page's one round trip (ADR 0059),
 * and what to make of its rows.
 */
export function sanityUsageQuery(db: D1Database, siteEnv: string | undefined, now: Date) {
  const { projectId, name } = sanityProject(siteEnv);
  const month = now.toISOString().slice(0, 7);
  const start = Date.parse(`${month}-01T00:00:00Z`);
  const resets = nextMonth(now);
  const days = Math.max((now.getTime() - start) / DAY, 1 / 24);
  return {
    statement: statement(
      db,
      "SELECT kind, SUM(count) used FROM sanity_requests WHERE project = ? AND day >= ? AND day < ? GROUP BY kind",
      [projectId, `${month}-01`, `${month}-32`],
    ),
    usage: (rows: { kind: SanityKind; used: number }[]): SanityUsage => ({
      project: projectId,
      name,
      month,
      resetsAt: new Date(resets).toISOString(),
      quotas: (Object.keys(SANITY_FREE) as SanityKind[]).map((id) => {
        const used = rows.find((r) => r.kind === id)?.used ?? 0;
        return {
          id,
          label: SANITY_LABELS[id],
          used,
          limit: SANITY_FREE[id],
          projected: Math.round((used / days) * ((resets - start) / DAY)),
        };
      }),
    }),
  };
}

/** When the month's pace would spend the quota, if before the reset and late enough in the month to judge. */
export function runsOutAt(q: SanityQuota, usage: SanityUsage, now: Date): Date | null {
  const start = Date.parse(`${usage.month}-01T00:00:00Z`);
  const days = (now.getTime() - start) / DAY;
  if (days < PACE_AFTER_DAYS || !q.used || q.projected <= q.limit) return null;
  return new Date(start + (q.limit / q.used) * days * DAY);
}
