// Telling the admins a free limit is getting close (ADR 0059, #157), from the hourly check (index.ts `scheduled`):
// at 70% and again at 90% of any limit it measures, an email to the admins and a notification on their phones (topic
// "usage", ADR 0108), once per limit and level: today's (UTC) for Cloudflare's, this month's for Sanity's. A request
// stopped for its CPU time is the 10 ms limit spent: told once a day. Sanity's quotas also email at 50%, and when
// the month's pace would run out before the 1st (emails only: early warnings, not news for a phone). Each is claimed
// in usage_warnings before it's sent, so two runs tell once; a limit back under 70% says nothing, and stays told.
import { all } from "@cougars/shared/d1";
import { sendMail, type Mail } from "@cougars/shared/email";
import { scribe } from "@cougars/shared/scribe";
import { mailSetup } from "../auth/auth";
import type { Env } from "../api/api";
import { notify, type Notice } from "../push/push";
import { quietUntil } from "../push/push.rules";
import { saveLevels } from "./usage.levels";
import { CPU_LIMIT_MS, readUsage, type Usage } from "./usage";
import { runsOutAt } from "./usage.sanity";

const log = scribe.logger("usage");

/** The levels a limit is told at, email and phone: 90% says it's nearly spent. */
const LEVELS = [70, 90];
const NEARLY_SPENT_AT = 90;
/** Sanity's month also gets an email at half: its quota is a hard stop until the 1st. */
const SANITY_LEVELS = [50, ...LEVELS];

/** One thing to tell the admins. */
interface Alert {
  /** What it claims in usage_warnings, [period, metric]: its own first, then the lower levels it stands for. */
  claims: [string, string][];
  mail: { subject: string; text: string };
  /** The line for their phones, at 70% and over; `resets`: after then it's old news. */
  phone?: { key: string; title: string; body: string; resets: string };
  /** A quota's pace gives way to its level's email, which says the pace too: one email at a time. */
  paceOf?: string;
  levelOf?: string;
}

const n = (x: number) => x.toLocaleString("en-GB");
const percentOf = (used: number, limit: number) => Math.floor((used / limit) * 100);
/** The highest of these levels a share has reached, if any. */
const reached = (levels: number[], percent: number) => levels.filter((l) => percent >= l).at(-1);
const titleOf = (label: string, percent: number) =>
  `${percent >= NEARLY_SPENT_AT ? "Nearly spent: " : ""}${label} at ${percent}%`;

/**
 * The hourly check: each limit's level for the admins' Home (usage.levels.ts), then whatever's newly worth telling,
 * by email (`send`, the club's mail by default) and to the admins' phones.
 */
export async function checkUsage(
  env: Env,
  now: Date,
  {
    send = (m: Mail) => mailSetup(env).then((config) => sendMail(m, config)),
  }: { send?: (m: Mail) => Promise<unknown> } = {},
) {
  const usage = await readUsage(env, now);
  await saveLevels(env.DB, usage);
  const alerts = [...dayAlerts(usage), ...cpuAlerts(usage), ...sanityAlerts(usage, now)];
  if (!alerts.length) return;
  const admins = await all<{ id: number; email: string }>(
    env.DB,
    `SELECT DISTINCT m.id, m.email FROM members m
     JOIN member_roles mr ON mr.member_id = m.id
     JOIN role_actions ra ON ra.role_id = mr.role_id
     WHERE ra.action IN ('manage:all', 'read:Usage') AND m.email IS NOT NULL AND m.status = 'active'
     ORDER BY m.email`,
  );
  if (!admins.length) return;
  const due = await claim(env.DB, alerts);
  const to = admins.map((a) => a.email);
  for (const alert of due) {
    // One email failing (reported, as an error line is) doesn't stop the rest, or the phones
    await send({ to, ...alert.mail }).catch((e) => log.error("usage.email_failed", e, { subject: alert.mail.subject }));
  }
  await notify(env, phoneNotices(due, admins, now), now, 0);
}

/**
 * Claim every alert's warnings in one statement, so two checks at once still tell once, and keep those whose own
 * warning this run claimed. A quota's pace that has its level's email too goes in that one.
 */
async function claim(db: D1Database, alerts: Alert[]): Promise<Alert[]> {
  const rows = await all<{ key: string }>(
    db,
    `INSERT OR IGNORE INTO usage_warnings (day, metric) SELECT value ->> 0, value ->> 1 FROM json_each(?) WHERE true
     RETURNING day || ' ' || metric key`,
    [JSON.stringify(alerts.flatMap((a) => a.claims))],
  );
  const claimed = new Set(rows.map((r) => r.key));
  const due = alerts.filter((a) => claimed.has(a.claims[0].join(" ")));
  return due.filter((a) => !a.paceOf || !due.some((b) => b.levelOf === a.paceOf));
}

/**
 * The phones' notifications, after the hourly run's emails, so queued for the next push drain (a minute away). In
 * quiet hours one waits for their end (ADR 0108), unless the limit resets first: by then there's nothing to tell.
 */
function phoneNotices(due: Alert[], admins: { id: number }[], now: Date): Notice[] {
  const quietEnds = quietUntil(now)?.toISOString();
  return due.flatMap(({ phone }) => {
    if (!phone || (quietEnds && quietEnds >= phone.resets)) return [];
    const { key, title, body } = phone;
    return [{ to: admins.map((a) => a.id), topic: "usage", key, title, body, path: "/settings/usage" }];
  });
}

/** Today's Cloudflare limits (Worker requests, D1 rows, the live hub's) at 70% and at 90%. */
function dayAlerts(usage: Usage): Alert[] {
  return usage.metrics.flatMap((m) => {
    const percent = percentOf(m.used, m.limit);
    const level = reached(LEVELS, percent);
    if (!level) return [];
    const claims = LEVELS.filter((l) => l <= level)
      .reverse()
      .map((l): [string, string] => [usage.day, `${m.id}-${l}`]);
    return [
      {
        claims,
        mail: {
          subject: `Cougars app: ${m.label} at ${percent}% of today's free allowance`,
          text:
            `${m.label}: ${n(m.used)} of ${n(m.limit)} today (UTC).\n\n` +
            `If it runs out, the team app stops working until it resets at midnight UTC (01:00 in summer). ` +
            `See Settings → Usage in the app. A runaway tab or a scraper is the likely cause.`,
        },
        phone: {
          key: `usage:${m.id}:${level}:${usage.day}`,
          title: titleOf(m.label, percent),
          body: "Of today's free limit. If it runs out, the app stops until it resets.",
          resets: usage.resetsAt,
        },
      },
    ];
  });
}

/** A request stopped today for computing past the free plan's 10 ms: that limit's spent, told once a day. */
function cpuAlerts(usage: Usage): Alert[] {
  const stopped = (usage.cpu?.workers ?? []).filter((w) => w.stopped);
  if (!stopped.length) return [];
  const total = stopped.reduce((sum, w) => sum + w.stopped, 0);
  const requests = `${total} request${total === 1 ? "" : "s"}`;
  return [
    {
      claims: [[usage.day, "cpu"]],
      mail: {
        subject: `Cougars app: ${requests} stopped today for using too much CPU`,
        text:
          `Cloudflare's free plan stops a request that computes for more than ${CPU_LIMIT_MS} ms, and it fails.\n\n` +
          stopped.map((w) => `${w.name}: ${w.stopped}`).join("\n") +
          `\n\nSee Settings → Usage for each Worker's CPU time, and the Worker's logs in Cloudflare for which request.`,
      },
      phone: {
        key: `usage:cpu:${usage.day}`,
        title: `${requests} stopped for CPU time`,
        body: `${total === 1 ? "It" : "They"} went past the free plan's ${CPU_LIMIT_MS} ms and failed. See Usage for each Worker's.`,
        resets: usage.resetsAt,
      },
    },
  ];
}

/** This month's Sanity quotas: at 50% (email only), 70% and 90%, and when the month's pace would run out early. */
function sanityAlerts(usage: Usage, now: Date): Alert[] {
  const { sanity } = usage;
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long" }).format(d);
  const reset = date(new Date(sanity.resetsAt));
  const ifSpent =
    `If it's spent, Sanity refuses those requests until ${reset} (00:00 UTC): the website's builds fail and its live ` +
    `pages fall back. At 90% of the CDN's, the website's live reads stop so the builds keep the rest (ADR 0059).\n\n` +
    `See Settings → Usage in the app; Sanity's own figures (and a log of the requests) are on sanity.io/manage → ` +
    `${sanity.name} → Usage.`;
  const runsOut = (when: Date) => `At this pace they run out around ${date(when)}`;
  return sanity.quotas.flatMap((q) => {
    const id = `sanity-${q.id}`;
    const label = `Sanity ${q.label}`;
    const percent = percentOf(q.used, q.limit);
    const level = reached(SANITY_LEVELS, percent);
    const when = runsOutAt(q, sanity, now);
    const alerts: Alert[] = [];
    if (level) {
      alerts.push({
        claims: SANITY_LEVELS.filter((l) => l <= level)
          .reverse()
          .map((l): [string, string] => [sanity.month, `${id}-${l}`]),
        levelOf: id,
        mail: {
          subject: `Cougars app: ${label} at ${percent}% of this month's free allowance (${sanity.name})`,
          text:
            `${label} for ${sanity.name}: ${n(q.used)} of ${n(q.limit)} this month (UTC), on pace for ` +
            `${n(q.projected)} by ${reset}.${when ? ` ${runsOut(when)}.` : ""}\n\n${ifSpent}`,
        },
        phone:
          level >= LEVELS[0]
            ? {
                key: `usage:${id}:${level}:${sanity.month}`,
                title: titleOf(label, percent),
                body: "Of this month's free limit. If it runs out, the website's builds fail until the 1st.",
                resets: sanity.resetsAt,
              }
            : undefined,
      });
    }
    if (when) {
      alerts.push({
        claims: [[sanity.month, `${id}-pace`]],
        paceOf: id,
        mail: {
          subject: `Cougars app: ${label} on pace to run out before ${reset} (${sanity.name})`,
          text:
            `${label} for ${sanity.name}: ${n(q.used)} of ${n(q.limit)} so far this month. ${runsOut(when)}, ` +
            `and ${n(q.projected)} would be needed by ${reset}.\n\n` +
            `Something may be calling Sanity more than it should: in astro dev, the log's sanity.read lines say which ` +
            `page and who asked.\n\n${ifSpent}`,
        },
      });
    }
    return alerts;
  });
}
