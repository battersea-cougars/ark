// The club's free Cloudflare allowance (ADR 0059): one account runs the website, the team app and their database,
// and the free plan's daily limits reset at 00:00 UTC. Admins see today's use on the Usage page; an hourly check
// (usage.alerts.ts) tells them at 70% and 90%, before the app stops working. The free plan also stops any request
// that computes for more than 10 ms; the page shows each Worker's CPU time against that.
// Read with a read-only token (Account Analytics: Read), CLOUDFLARE_ANALYTICS_TOKEN, never the deploy token.
// Sanity's monthly quotas are ours to count (usage.sanity.ts, ADR 0059): shown and checked with or without the token.
import { batch, statement } from "@cougars/shared/d1";
import type { Env } from "../api/api";
import { scribe } from "@cougars/shared/scribe";
import { sanityUsageQuery, type SanityUsage } from "./usage.sanity";

const log = scribe.logger("usage");

export interface Metric {
  id: "requests" | "rowsRead" | "rowsWritten" | "liveRequests" | "liveTime";
  label: string;
  used: number;
  limit: number;
}

/** One Worker's CPU time per request today, in ms; `stopped` were cut off for going over the limit. */
export interface WorkerCpu {
  name: string;
  p50Ms: number;
  p99Ms: number;
  stopped: number;
}

export interface Usage {
  /** False without the analytics token: the page says how to set it up. */
  configured: boolean;
  /** Cloudflare couldn't be read just now. */
  unavailable?: boolean;
  /** Today, in UTC (Cloudflare's day). */
  day: string;
  resetsAt: string;
  metrics: Metric[];
  cpu?: { limitMs: number; workers: WorkerCpu[] };
  /** The database's last backup (ADR 0106), or null before the first. Ours, so it's there without the token. */
  backup: Backup | null;
  /** This month's Sanity requests for this environment's project, as we counted them (ADR 0059). */
  sanity: SanityUsage;
}

export interface Backup {
  takenAt: string;
  why: string;
  bytes: number;
}

/** The Workers free plan's daily limits (ADR 0003); the live hub's (ADR 0072) are Durable Objects' */
const FREE = { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000, liveRequests: 100_000, liveTime: 13_000 };
const LABELS: Record<Metric["id"], string> = {
  requests: "Worker requests",
  rowsRead: "Database rows read",
  rowsWritten: "Database rows written",
  liveRequests: "Live hub requests",
  liveTime: "Live hub time (GB-s)",
};
/** A Durable Object is billed as 128 MB for every second it's active, in GB-seconds; Cloudflare gives microseconds. */
const gbSeconds = (activeUs: number) => Math.round((activeUs / 1_000_000) * 0.128);
/** CPU time a request may use on the free plan; waiting on the database or a fetch doesn't count. */
export const CPU_LIMIT_MS = 10;

const QUERY = `query ($account: String!, $day: Date!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 100, filter: { date: $day }) {
        sum { requests }
        quantiles { cpuTimeP50 cpuTimeP99 }
        dimensions { scriptName }
      }
      stopped: workersInvocationsAdaptive(limit: 100, filter: { date: $day, status: "exceededResources" }) {
        sum { requests }
        dimensions { scriptName }
      }
      d1AnalyticsAdaptiveGroups(limit: 100, filter: { date: $day }) { sum { rowsRead rowsWritten } }
      durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: { date: $day }) { sum { requests } }
      durableObjectsPeriodicGroups(limit: 100, filter: { date: $day }) { sum { activeTime } }
    }
  }
}`;

interface Answer {
  data?: {
    viewer?: {
      accounts?: {
        workersInvocationsAdaptive?: {
          sum: { requests: number };
          quantiles?: { cpuTimeP50: number; cpuTimeP99: number };
          dimensions: { scriptName: string };
        }[];
        stopped?: { sum: { requests: number }; dimensions: { scriptName: string } }[];
        d1AnalyticsAdaptiveGroups?: { sum: { rowsRead: number; rowsWritten: number } }[];
        durableObjectsInvocationsAdaptiveGroups?: { sum: { requests: number } }[];
        durableObjectsPeriodicGroups?: { sum: { activeTime: number } }[];
      }[];
    };
  };
}

export async function readUsage(env: Env, now: Date): Promise<Usage> {
  const day = now.toISOString().slice(0, 10);
  const resetsAt = new Date(Date.parse(day) + 86_400_000).toISOString();
  // Ours, so there without the token: the last backup and this month's Sanity count, in one round trip
  const sanityQuery = sanityUsageQuery(env.DB, env.SITE_ENV, now);
  const [backups, sanityRows] = await batch(env.DB, [
    statement(env.DB, "SELECT taken_at takenAt, why, bytes FROM backups ORDER BY taken_at DESC LIMIT 1"),
    sanityQuery.statement,
  ]);
  const backup = (backups.results[0] as Backup | undefined) ?? null;
  const sanity = sanityQuery.usage(sanityRows.results as Parameters<typeof sanityQuery.usage>[0]);
  const none = { day, resetsAt, metrics: [], backup, sanity };
  if (!env.CLOUDFLARE_ANALYTICS_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return { configured: false, ...none };
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { account: env.CLOUDFLARE_ACCOUNT_ID, day } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Cloudflare analytics: HTTP ${res.status}`);
    const account = ((await res.json()) as Answer).data?.viewer?.accounts?.[0];
    if (!account) throw new Error("Cloudflare analytics: no account in the answer");
    const sum = <T>(rows: T[] | undefined, pick: (r: T) => number) => (rows ?? []).reduce((n, r) => n + pick(r), 0);
    const used = {
      requests: sum(account.workersInvocationsAdaptive, (r) => r.sum.requests),
      rowsRead: sum(account.d1AnalyticsAdaptiveGroups, (r) => r.sum.rowsRead),
      rowsWritten: sum(account.d1AnalyticsAdaptiveGroups, (r) => r.sum.rowsWritten),
      liveRequests: sum(account.durableObjectsInvocationsAdaptiveGroups, (r) => r.sum.requests),
      liveTime: gbSeconds(sum(account.durableObjectsPeriodicGroups, (r) => r.sum.activeTime)),
    };
    const metrics = (Object.keys(FREE) as Metric["id"][]).map((id) => ({
      id,
      label: LABELS[id],
      used: used[id],
      limit: FREE[id],
    }));
    // Cloudflare gives CPU time in microseconds
    const ms = (us = 0) => Math.round(us / 100) / 10;
    const workers = (account.workersInvocationsAdaptive ?? []).map((r) => ({
      name: r.dimensions.scriptName,
      p50Ms: ms(r.quantiles?.cpuTimeP50),
      p99Ms: ms(r.quantiles?.cpuTimeP99),
      stopped: sum(
        account.stopped?.filter((s) => s.dimensions.scriptName === r.dimensions.scriptName),
        (s) => s.sum.requests,
      ),
    }));
    return { configured: true, day, resetsAt, metrics, cpu: { limitMs: CPU_LIMIT_MS, workers }, backup, sanity };
  } catch (e) {
    // An error, not a warning: the hourly check can't see the free allowance either, so nobody would be warned before
    // it runs out and the app stops for everyone (ADR 0059, 0110)
    log.error("usage.unavailable", e);
    return { configured: true, unavailable: true, ...none };
  }
}
