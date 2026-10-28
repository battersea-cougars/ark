// Next quarter's plan, a few days before it starts (ADR 0007, #187), from the hourly Cron Trigger (index.ts
// `scheduled`): every member who'll be Quarterly next quarter (they chose it, or their subscription runs on into it) is
// told its fee is due, what it is and when it's charged, and that they can still switch to pay as you go on their Dues
// page. Not keepers (the Keeper plan is never charged), not anyone paying as they go. The lead time is the club's
// (Settings → Membership, five days unless set); from 10:00 to 20:00 London, from that day until the quarter starts,
// so a run missed is made up by the next.
//
// A notification for anyone with the app (topic dues, theirs to switch off); an email for anyone without. Once per
// member per quarter: claimed in plan_reminders before it's sent, in one statement, so two runs at once tell once. An
// email that fails is let go of, so the next hour tries again. This isn't the dues reminders (reminders.ts): those are
// about money owed, and an admin sends them.
import { all, batch, statement } from "@cougars/shared/d1";
import { sendMail, type Mail } from "@cougars/shared/email";
import { londonTime, londonToday } from "@cougars/shared/london";
import { scribe } from "@cougars/shared/scribe";
import { mailSetup } from "../auth/auth";
import type { Env } from "../api/api.route";
import { notify } from "../push/push";
import { PLAN_REMINDER_DAYS } from "../settings/settings";
import { feeOn, nextQuarter, quarterOf, quarterStart, type DatedFee } from "../../src/lib/dues";
import { planMail, planNotice, type PlanLetter } from "./plan-reminders.letter";

const log = scribe.logger("plan-reminders");

/** The numbers, in one place. */
export const PLAN_REMINDERS = {
  /** London's hours they go out in: not overnight, not late in the evening. */
  from: "10:00",
  until: "20:00",
  /** Emails per run (each is one of the run's 50 requests): the rest go on the next hour's. */
  emailsPerRun: 10,
} as const;

/** Someone who'll be Quarterly next quarter and hasn't been told. */
interface Due {
  memberId: number;
  name: string;
  webName: string | null;
  email: string | null;
  /** Signed in on a phone or browser that takes notifications. */
  app: number;
  /** They turned Dues notifications off. */
  off: number;
}

type Via = "push" | "email";

const dayBefore = (day: string, days = 1) =>
  new Date(Date.parse(`${day}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** The hourly run's part: tell whoever's due, if it's the time for next quarter's reminder. */
export async function remindPlans(env: Env, now: Date) {
  const today = londonToday(now);
  const quarter = nextQuarter(quarterOf(today));
  const starts = quarterStart(quarter);
  const hour = londonTime(now.toISOString());
  // Nothing to read until the earliest the lead time could make it, and only in the day's hours
  if (today < dayBefore(starts, PLAN_REMINDER_DAYS.max)) return;
  if (hour < PLAN_REMINDERS.from || hour >= PLAN_REMINDERS.until) return;
  const { days, fees, due } = await readDue(env.DB, quarter, now);
  if (today < dayBefore(starts, days)) return;
  const pence = feeOn(fees, starts);
  // No rate in force on the day: nobody's charged, so there's nothing to tell
  if (!pence) return;
  const letter = (d: Due): PlanLetter => ({
    firstName: (d.webName?.trim() || d.name).split(/\s+/)[0],
    quarter,
    pence,
    chargedOn: starts,
    changeBy: dayBefore(starts),
  });
  const claimed = await claim(env.DB, quarter, whoHow(due), now);
  if (!claimed.length) return;
  const byId = new Map(due.map((d) => [d.memberId, d]));
  const emailed = claimed.filter((c) => c.via === "email").map((c) => byId.get(c.memberId)!);
  const failed = await sendEmails(
    env,
    emailed.map((d) => planMail(d.email!, letter(d))),
    emailed,
  );
  const pushed = claimed.filter((c) => c.via === "push").map((c) => c.memberId);
  // One notice for them all: the words are the same for everyone. Queued for the next push drain, a minute away; one
  // that can't be queued is reported, and the record is still written
  if (pushed.length)
    await notify(env, [{ ...planNotice(letter(byId.get(pushed[0])!)), to: pushed }], now, 0).catch((e) =>
      log.error("plan.push_failed", e, { quarter }),
    );
  await record(env.DB, quarter, claimed, failed, now);
}

/** The club's lead time, the quarterly rate's history, and who's due and not told: one round trip. */
async function readDue(db: D1Database, quarter: string, now: Date) {
  const starts = quarterStart(quarter);
  const at = now.toISOString();
  const [settings, fees, due] = (await batch(db, [
    statement(db, "SELECT plan_reminder_days days FROM club_settings WHERE id = 1"),
    statement(db, "SELECT amount_pence pence, effective_from 'from' FROM subscription_fees ORDER BY effective_from"),
    statement(
      db,
      `SELECT m.id memberId, m.name, m.web_name webName, m.email,
         EXISTS (SELECT 1 FROM push_devices d JOIN auth_sessions s ON s.id = d.session_id
           WHERE s.member_id = m.id AND s.revoked_at IS NULL AND s.expires_at > ?) app,
         EXISTS (SELECT 1 FROM notification_prefs p WHERE p.member_id = m.id AND p.topic = 'dues' AND p.enabled = 0) off
       FROM members m
       WHERE m.status = 'active' AND m.position <> 'G'
         AND EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.member_id = m.id AND sub.starts_on <= ?
           AND (sub.ends_on IS NULL OR sub.ends_on >= ?))
         AND NOT EXISTS (SELECT 1 FROM plan_reminders r WHERE r.member_id = m.id AND r.quarter = ?)
       ORDER BY m.id LIMIT 1000`,
      [at, starts, starts, quarter],
    ),
  ])) as [D1Result<{ days: number }>, D1Result<DatedFee>, D1Result<Due>];
  return {
    days: settings.results[0]?.days ?? PLAN_REMINDER_DAYS.default,
    fees: fees.results,
    due: due.results,
  };
}

/**
 * How each is told: a notification for anyone with the app (unless they turned Dues off: then nothing), an email for
 * anyone without, a few a run. Nobody to send it to (no app, no email): nothing.
 */
function whoHow(due: Due[]): { memberId: number; via: Via }[] {
  const push = due.filter((d) => d.app && !d.off).map((d) => ({ memberId: d.memberId, via: "push" as const }));
  const email = due
    .filter((d) => !d.app && d.email)
    .slice(0, PLAN_REMINDERS.emailsPerRun)
    .map((d) => ({ memberId: d.memberId, via: "email" as const }));
  return [...push, ...email];
}

/** Claim each member's reminder for the quarter in one statement: another run at once claims none of the same. */
async function claim(db: D1Database, quarter: string, told: { memberId: number; via: Via }[], now: Date) {
  if (!told.length) return [];
  return all<{ memberId: number; via: Via }>(
    db,
    `INSERT INTO plan_reminders (member_id, quarter, via, told_at)
     SELECT value ->> 'memberId', ?, value ->> 'via', ? FROM json_each(?) WHERE true
     ON CONFLICT DO NOTHING RETURNING member_id memberId, via`,
    [quarter, now.toISOString(), JSON.stringify(told)],
  );
}

/** The emails, one by one (each is one request to Gmail); returns whose failed. One failing doesn't stop the rest. */
async function sendEmails(env: Env, mails: Mail[], to: Due[]): Promise<number[]> {
  if (!mails.length) return [];
  const setup = await mailSetup(env);
  const failed: number[] = [];
  for (const [i, mail] of mails.entries()) {
    try {
      await sendMail(mail, setup);
    } catch (e) {
      log.error("plan.email_failed", e, { memberId: to[i].memberId });
      failed.push(to[i].memberId);
    }
  }
  return failed;
}

/** On the record (the audit log, by nobody: the app), and an email that failed let go of, in one round trip. */
async function record(
  db: D1Database,
  quarter: string,
  claimed: { memberId: number; via: Via }[],
  failed: number[],
  now: Date,
) {
  const told = claimed.filter((c) => !failed.includes(c.memberId));
  await batch(db, [
    statement(db, "DELETE FROM plan_reminders WHERE quarter = ? AND member_id IN (SELECT value FROM json_each(?))", [
      quarter,
      JSON.stringify(failed),
    ]),
    statement(
      db,
      `INSERT INTO audit_log (at, member_id, action, detail)
       SELECT ?, NULL, 'dues.plan_reminded',
         json_object('memberId', value ->> 'memberId', 'quarter', ?, 'via', value ->> 'via') FROM json_each(?)`,
      [now.toISOString(), quarter, JSON.stringify(told)],
    ),
  ]);
  const count = (via: Via) => told.filter((t) => t.via === via).length;
  log.info("plan.reminded", { quarter, push: count("push"), email: count("email") });
}
