// The hourly run, caught up when it's missed or fails (ADR 0110): Cloudflare's Cron Triggers don't retry, so each UTC
// hour's tries are kept in one D1 row (`hourly_run`) and the run every minute tries the hour again until it's done.
// Every hourly job is safe to run twice, so a try that ran a job before failing on another just runs it again.
import { first, run } from "@cougars/shared/d1";
import { scribe } from "@cougars/shared/scribe";
import { checkIn } from "../sentry/sentry";

const log = scribe.logger("cron");

/** The hourly run's Sentry cron monitor, made by scripts/sentry-setup.mjs (the free plan has one). */
export const HOURLY_MONITOR = "team-hourly";

/**
 * The minutes past the hour each try may start from: the hour's own run at :07 (Cloudflare's trigger), then the
 * catch-ups. The last one failing marks the hour failed; scripts/sentry-setup.mjs's margin waits for it.
 */
export const HOURLY_TRIES = [7, 12, 17, 27, 37, 47] as const;
const LAST = HOURLY_TRIES.length - 1;

/** Which try a moment is in: the last whose minute has come (the hour's own run before :07 is still try 0). */
const tryAt = (now: Date) => {
  const minute = now.getUTCMinutes();
  return Math.max(
    0,
    HOURLY_TRIES.findLastIndex((m) => minute >= m),
  );
};

/** The UTC hour a moment is in, as the row keeps it (YYYY-MM-DDTHH): London's clock changes don't touch it. */
const hourOf = (now: Date) => now.toISOString().slice(0, 13);

/** A try at the hour, claimed. */
export interface HourTry {
  hour: string;
  attempt: number;
  started: number;
}

/**
 * Claim this moment's try at the hour, or null if it isn't for this run: the hour is done or failed, or this try was
 * already taken (by another run at once, or one that died). `trigger`: the hour's own run takes its try whatever the
 * minute; the run every minute only from the first catch-up's. Another hour takes the row whichever way the clock
 * went (the dev clock put back, ADR 0010).
 */
export async function claimHour(db: D1Database, now: Date, trigger: "hourly" | "catch-up"): Promise<HourTry | null> {
  const attempt = tryAt(now);
  if (trigger === "catch-up" && attempt === 0) return null;
  const hour = hourOf(now);
  const claimed = await first<{ attempt: number }>(
    db,
    `INSERT INTO hourly_run (id, hour, attempt, tried_at) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET hour = excluded.hour, attempt = excluded.attempt, tried_at = excluded.tried_at,
       outcome = NULL, finished_at = NULL
     WHERE hourly_run.hour <> excluded.hour
       OR (hourly_run.hour = excluded.hour AND hourly_run.outcome IS NULL AND hourly_run.attempt < excluded.attempt)
     RETURNING attempt`,
    [hour, attempt, now.toISOString()],
  );
  return claimed ? { hour, attempt, started: Date.now() } : null;
}

/**
 * The try's outcome: every job done (`failed` empty) makes the hour done and checks in `ok`; the last try failing marks
 * it failed and checks in `error`; an earlier try failing leaves it for the next. Only the first to finish the hour
 * checks in, so two tries that overlapped check in once.
 */
export async function finishHour(db: D1Database, tried: HourTry, failed: string[], now: Date) {
  const fields = { hour: tried.hour, attempt: tried.attempt, failed };
  if (failed.length && tried.attempt < LAST) {
    // Not reported: each job's failure was, by its own cron.failed line; the next try may yet make the hour
    log.warn("hourly.retry", { ...fields, next: HOURLY_TRIES[tried.attempt + 1] });
    return;
  }
  const outcome = failed.length ? "failed" : "done";
  const set = await run(
    db,
    "UPDATE hourly_run SET outcome = ?, finished_at = ? WHERE id = 1 AND hour = ? AND outcome IS NULL",
    [outcome, now.toISOString(), tried.hour],
  );
  if (!set.meta.changes) return;
  const duration = (Date.now() - tried.started) / 1000;
  checkIn(HOURLY_MONITOR, failed.length ? "error" : "ok", duration);
  // A failed hour isn't reported here: its jobs' lines were, and the monitor's error check-in is what alerts
  if (failed.length) log.warn("hourly.failed", fields);
  else log.info("hourly.done", fields);
}
