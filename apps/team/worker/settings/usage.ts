// The club's free Cloudflare allowance (ADR 0059): one account runs the website, the team app and their database,
// and the free plan's daily limits reset at 00:00 UTC. Admins see today's use on the Usage page; an hourly check
// (index.ts `scheduled`) emails them once a day when anything passes 80%, before the app stops working. The free plan
// also stops any request that computes for more than 10 ms; the page shows each Worker's CPU time against that, and
// the check emails when a request was stopped (ADR 0059).
// Read with a read-only token (Account Analytics: Read), CLOUDFLARE_ANALYTICS_TOKEN, never the deploy token.
import { all, first } from "@cougars/shared/d1";
import { sendMail, type Mail } from "@cougars/shared/email";
import { mailSetup } from "../auth/auth";
import type { Env } from "../api/api";

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
const CPU_LIMIT_MS = 10;
/** When to warn: a fifth of the day still to spend. */
const WARN_AT = 0.8;

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
  const backup = await first<Backup>(
    env.DB,
    "SELECT taken_at takenAt, why, bytes FROM backups ORDER BY taken_at DESC LIMIT 1",
  );
  const none = { day, resetsAt, metrics: [], backup };
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
    return { configured: true, day, resetsAt, metrics, cpu: { limitMs: CPU_LIMIT_MS, workers }, backup };
  } catch (e) {
    console.warn(JSON.stringify({ event: "usage.unavailable", error: String(e) }));
    return { configured: true, unavailable: true, ...none };
  }
}

/** The hourly check: one email to the admins per metric per day, once it passes 80%. */
export async function checkUsage(
  env: Env,
  now: Date,
  {
    send = (m: Mail) =>
      mailSetup(env)
        .then((config) => sendMail(m, config))
        .then(() => {}),
  }: { send?: (m: Mail) => Promise<void> } = {},
) {
  const usage = await readUsage(env, now);
  const over = usage.metrics.filter((m) => m.used >= m.limit * WARN_AT);
  const stopped = (usage.cpu?.workers ?? []).filter((w) => w.stopped);
  if (!over.length && !stopped.length) return;
  const admins = await all<{ email: string }>(
    env.DB,
    `SELECT DISTINCT m.email FROM members m
     JOIN member_roles mr ON mr.member_id = m.id
     JOIN role_actions ra ON ra.role_id = mr.role_id
     WHERE ra.action IN ('manage:all', 'read:Usage') AND m.email IS NOT NULL AND m.status = 'active'
     ORDER BY m.email`,
  );
  if (!admins.length) return;
  // Claim today's warnings first, all in one statement: two checks at once still send one email each
  const claimed = new Set(
    (
      await all<{ metric: string }>(
        env.DB,
        `INSERT OR IGNORE INTO usage_warnings (day, metric) SELECT ?, value FROM json_each(?) WHERE true
         RETURNING metric`,
        [usage.day, JSON.stringify([...over.map((m) => m.id), ...(stopped.length ? ["cpu"] : [])])],
      )
    ).map((r) => r.metric),
  );
  for (const m of over) {
    if (!claimed.has(m.id)) continue;
    const pct = Math.floor((m.used / m.limit) * 100);
    await send({
      to: admins.map((a) => a.email),
      subject: `Cougars app: ${m.label} at ${pct}% of today's free allowance`,
      text:
        `${m.label}: ${m.used.toLocaleString("en-GB")} of ${m.limit.toLocaleString("en-GB")} today (UTC).\n\n` +
        `If it runs out, the team app stops working until it resets at midnight UTC (01:00 in summer). ` +
        `See Settings → Usage in the app. A runaway tab or a scraper is the likely cause.`,
    });
  }
  if (claimed.has("cpu")) {
    const total = stopped.reduce((n, w) => n + w.stopped, 0);
    await send({
      to: admins.map((a) => a.email),
      subject: `Cougars app: ${total} request${total === 1 ? "" : "s"} stopped today for using too much CPU`,
      text:
        `Cloudflare's free plan stops a request that computes for more than ${CPU_LIMIT_MS} ms, and it fails.\n\n` +
        stopped.map((w) => `${w.name}: ${w.stopped}`).join("\n") +
        `\n\nSee Settings → Usage for each Worker's CPU time, and the Worker's logs in Cloudflare for which request.`,
    });
  }
}
