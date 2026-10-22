// How long the club keeps sign-in records (#30, ADR 0029), forgotten by the hourly cron (index.ts `scheduled`). The
// privacy notice (apps/web/src/pages/privacy.astro) says the same; change them together.
import { run } from "@cougars/shared/d1";

const DAY = 86_400_000;
/** A sign-in code: long enough to look into a problem with signing in. */
export const KEEP_CODES_DAYS = 30;
/** A session, after it was signed out or ran out. */
export const KEEP_ENDED_SESSIONS_DAYS = 30;
/** A request to join nobody answered (#13): long enough for an admin to get to it, and the list never fills for good. */
export const KEEP_PENDING_DAYS = 30;
/** Who did what: two years, for questions about money and membership after a season or two. */
export const KEEP_AUDIT_DAYS = 730;

export async function forgetOld(db: D1Database, now: Date) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  await run(db, "DELETE FROM login_challenges WHERE created_at < ?", [ago(KEEP_CODES_DAYS)]);
  // A passkey's challenge is spent or gone within five minutes: kept a day, only to see what happened
  await run(db, "DELETE FROM passkey_challenges WHERE created_at < ?", [ago(1)]);
  await run(db, "DELETE FROM auth_sessions WHERE COALESCE(revoked_at, expires_at) < ?", [
    ago(KEEP_ENDED_SESSIONS_DAYS),
  ]);
  await run(db, "DELETE FROM members WHERE status = 'pending' AND created_at < ?", [ago(KEEP_PENDING_DAYS)]);
  await run(db, "DELETE FROM audit_log WHERE at < ?", [ago(KEEP_AUDIT_DAYS)]);
}
