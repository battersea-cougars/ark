// A training night's sign-up opening (ADR 0030, 0108): a training may say its nights open a number of days before, at
// midnight London (lib/signup.ts; Friday Training, the Monday). The cron tells members once it has, one notification
// a night, under Your place (topic `places`), so a member who turned that off isn't told.
import { all } from "@cougars/shared/d1";
import { londonToday } from "../../src/lib/dates";
import { notify, type PushEnv } from "../push/push";

const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

/**
 * Every run of the cron: the nights whose sign-up opens today (London) and nobody's been told, not called off, each
 * taken by this run in the statement that marks it told (`signup_told_at`), so a rerun, or two runs at once, tell
 * members once (ADR 0121). Their notifications are queued, not sent here: the run's push drain, straight after, sends
 * them within the invocation's budget, and the next runs the rest (ADR 0108). Only on its day: a night already open
 * when its training was given an opening day (or made) isn't news, and isn't sent.
 */
export async function announceOpenSignups(env: PushEnv, now: Date) {
  const today = londonToday(now);
  const opened = await all<{ heldOn: string; name: string; slug: string }>(
    env.DB,
    `UPDATE training_sessions SET signup_told_at = ?
     WHERE signup_told_at IS NULL AND cancelled_at IS NULL AND held_on >= ?
       AND series_id IN (SELECT id FROM training_series WHERE active = 1 AND signup_opens_days IS NOT NULL)
       AND date(held_on, '-' || (SELECT signup_opens_days FROM training_series ts WHERE ts.id = series_id) || ' days') = ?
     RETURNING held_on heldOn,
       (SELECT name FROM training_series ts WHERE ts.id = series_id) name,
       (SELECT slug FROM training_series ts WHERE ts.id = series_id) slug`,
    [now.toISOString(), today, today],
  );
  await notify(
    env,
    opened.map((n) => ({
      to: "everyone" as const,
      topic: "places" as const,
      title: `${n.name}: sign-up's open`,
      body: `Say you're in for ${longDay(n.heldOn)}.`,
      path: `/training/${n.slug}`,
    })),
    now,
    0,
  );
}
