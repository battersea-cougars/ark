// A daily cap, across every address, on the browsers' error reports passed to Sentry (ADR 0110): a script can set
// `Origin` and post made-up reports from many addresses, each under its own per-address limit, and they share
// Sentry's free 5k a month with the servers' errors. Covers the team app's /api/errors and the website's
// /api/client-error and /api/csp-report.
import { first } from "./d1";
import { londonToday } from "./london";

/** Browser reports passed on to Sentry in a London day, across the club: well under 5k a month with room for the servers'. */
export const ERROR_REPORTS_PER_DAY = 100;

/**
 * Counts one report against today's cap and says whether it may go to Sentry, in one statement, so reports arriving
 * together can't pass it. Over the cap, nothing is counted or sent until the day is over.
 */
export async function errorReportAllowed(db: D1Database, now = new Date(), cap = ERROR_REPORTS_PER_DAY) {
  const counted = await first<{ n: number }>(
    db,
    `INSERT INTO error_report_days (day, n) VALUES (?, 1)
     ON CONFLICT (day) DO UPDATE SET n = n + 1 WHERE n < ?
     RETURNING n`,
    [londonToday(now), cap],
  );
  return !!counted;
}
