// The club's free Cloudflare allowance (ADR 0059): one account runs the website, the team app and their database,
// and the free plan's daily limits reset at 00:00 UTC. Admins see today's use on the Usage page; an hourly check
// (index.ts `scheduled`) emails them once a day when anything passes 80%, before the app stops working. The free plan
// also stops any request that computes for more than 10 ms; the page shows each Worker's CPU time against that, and
// the check emails when a request was stopped (ADR 0059).
// Read with a read-only token (Account Analytics: Read), CLOUDFLARE_ANALYTICS_TOKEN, never the deploy token.
// Sanity's monthly quotas are ours to count (usage.sanity.ts, ADR 0116): shown and checked with or without the token.
import { all, batch, statement } from "@cougars/shared/d1";
import { sendMail, type Mail } from "@cougars/shared/email";
import { mailSetup } from "../auth/auth";
import type { Env } from "../api/api";
import { scribe } from "@cougars/shared/scribe";
import { runsOutAt, sanityUsageQuery, type SanityUsage } from "./usage.sanity";

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
  /** This month's Sanity requests for this environment's project, as we counted them (ADR 0116). */
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
    // it runs out and the app stops for everyone (ADR 0059, 0111)
    log.error("usage.unavailable", e);
    return { configured: true, unavailable: true, ...none };
  }
}

/** Sanity's quotas are a month's: an email at each of these, once a month (ADR 0116). */
const SANITY_WARN_AT = [0.5, 0.8];

/**
 * The hourly check: one email to the admins per metric per day, once it passes 80%; for Sanity's monthly quotas, one
 * per month at 50% and at 80%, and one when the month's pace would run out before the 1st.
 */
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
  const { sanity } = usage;
  // The highest threshold each Sanity quota has passed (past 80% at once, the one email), and any on pace to run out
  const sanityOver = sanity.quotas.flatMap((q) => {
    const at = SANITY_WARN_AT.filter((t) => q.used >= q.limit * t).at(-1);
    return at ? [{ q, at }] : [];
  });
  const sanityPace = sanity.quotas.flatMap((q) => {
    const when = runsOutAt(q, sanity, now);
    return when ? [{ q, when }] : [];
  });
  if (!over.length && !stopped.length && !sanityOver.length && !sanityPace.length) return;
  const admins = await all<{ email: string }>(
    env.DB,
    `SELECT DISTINCT m.email FROM members m
     JOIN member_roles mr ON mr.member_id = m.id
     JOIN role_actions ra ON ra.role_id = mr.role_id
     WHERE ra.action IN ('manage:all', 'read:Usage') AND m.email IS NOT NULL AND m.status = 'active'
     ORDER BY m.email`,
  );
  if (!admins.length) return;
  // Claim the warnings first, all in one statement: two checks at once still send one email each. Cloudflare's are
  // today's; Sanity's this month's, each threshold claiming the ones below it too.
  const warnings = [
    ...over.map((m) => [usage.day, m.id]),
    ...(stopped.length ? [[usage.day, "cpu"]] : []),
    ...sanityOver.flatMap(({ q, at }) =>
      SANITY_WARN_AT.filter((t) => t <= at).map((t) => [sanity.month, `sanity-${q.id}-${t * 100}`]),
    ),
    ...sanityPace.map(({ q }) => [sanity.month, `sanity-${q.id}-pace`]),
  ];
  const claimed = new Set(
    (
      await all<{ key: string }>(
        env.DB,
        `INSERT OR IGNORE INTO usage_warnings (day, metric) SELECT value ->> 0, value ->> 1 FROM json_each(?) WHERE true
         RETURNING day || ' ' || metric key`,
        [JSON.stringify(warnings)],
      )
    ).map((r) => r.key),
  );
  const to = admins.map((a) => a.email);
  const n = (x: number) => x.toLocaleString("en-GB");
  for (const m of over) {
    if (!claimed.has(`${usage.day} ${m.id}`)) continue;
    const pct = Math.floor((m.used / m.limit) * 100);
    await send({
      to,
      subject: `Cougars app: ${m.label} at ${pct}% of today's free allowance`,
      text:
        `${m.label}: ${n(m.used)} of ${n(m.limit)} today (UTC).\n\n` +
        `If it runs out, the team app stops working until it resets at midnight UTC (01:00 in summer). ` +
        `See Settings → Usage in the app. A runaway tab or a scraper is the likely cause.`,
    });
  }
  if (claimed.has(`${usage.day} cpu`)) {
    const total = stopped.reduce((n, w) => n + w.stopped, 0);
    await send({
      to,
      subject: `Cougars app: ${total} request${total === 1 ? "" : "s"} stopped today for using too much CPU`,
      text:
        `Cloudflare's free plan stops a request that computes for more than ${CPU_LIMIT_MS} ms, and it fails.\n\n` +
        stopped.map((w) => `${w.name}: ${w.stopped}`).join("\n") +
        `\n\nSee Settings → Usage for each Worker's CPU time, and the Worker's logs in Cloudflare for which request.`,
    });
  }
  const resets = new Date(sanity.resetsAt);
  const date = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(d);
  const reset = date(resets, { day: "numeric", month: "long" });
  const ifSpent =
    `If it's spent, Sanity refuses those requests until ${reset} (00:00 UTC): the website's builds fail and its live ` +
    `pages fall back. At 90% of the CDN's, the website's live reads stop so the builds keep the rest (ADR 0116).\n\n` +
    `See Settings → Usage in the app; Sanity's own figures (and a log of the requests) are on sanity.io/manage → ` +
    `${sanity.name} → Usage.`;
  const runsOut = (when: Date) => `At this pace they run out around ${date(when, { day: "numeric", month: "long" })}`;
  // A threshold's email says the pace too, so a quota gets one email at a time
  const told = new Set<string>();
  for (const { q, at } of sanityOver) {
    if (!claimed.has(`${sanity.month} sanity-${q.id}-${at * 100}`)) continue;
    told.add(q.id);
    const when = sanityPace.find((p) => p.q.id === q.id)?.when;
    await send({
      to,
      subject: `Cougars app: Sanity ${q.label} at ${Math.floor((q.used / q.limit) * 100)}% of this month's free allowance (${sanity.name})`,
      text:
        `Sanity ${q.label} for ${sanity.name}: ${n(q.used)} of ${n(q.limit)} this month (UTC), on pace for ` +
        `${n(q.projected)} by ${reset}.${when ? ` ${runsOut(when)}.` : ""}\n\n${ifSpent}`,
    });
  }
  for (const { q, when } of sanityPace) {
    if (told.has(q.id) || !claimed.has(`${sanity.month} sanity-${q.id}-pace`)) continue;
    await send({
      to,
      subject: `Cougars app: Sanity ${q.label} on pace to run out before ${reset} (${sanity.name})`,
      text:
        `Sanity ${q.label} for ${sanity.name}: ${n(q.used)} of ${n(q.limit)} so far this month. ${runsOut(when)}, ` +
        `and ${n(q.projected)} would be needed by ${reset}.\n\n` +
        `Something may be calling Sanity more than it should: in astro dev, the log's sanity.read lines say which page ` +
        `and who asked.\n\n${ifSpent}`,
    });
  }
}
