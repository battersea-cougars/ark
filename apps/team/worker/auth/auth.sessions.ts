// Ending sign-ins (ADR 0023, #72): signing out this browser, every one of yours, or an admin signing a member out
// everywhere; and what does it on its own (a new sign-in email, being made inactive, deleting the account). An ended
// session's phones go with it (push_devices, so nothing more is sent to them) and its live streams close at the hub.
import { all, first, run } from "@cougars/shared/d1";
import { endLive, type LiveEnv } from "../live/live";

interface SessionsEnv extends LiveEnv {
  DB: D1Database;
}

/** How many sign-ins a member has that still work: what "signed out everywhere" changes, on the record. */
export async function liveSessions(db: D1Database, memberId: number, now: string) {
  const row = await first<{ n: number }>(
    db,
    "SELECT count(*) n FROM auth_sessions WHERE member_id = ? AND revoked_at IS NULL AND expires_at > ?",
    [memberId, now],
  );
  return { sessions: row?.n ?? 0 };
}

/**
 * End a member's sign-ins, every one (`memberId`), every one but the one they're using (`except`), or just this one
 * (`sessionId`): revoked now, their phones forgotten, their streams closed. How many it ended.
 */
export async function endSessions(
  env: SessionsEnv,
  now: string,
  which: { memberId: number; except?: number | null } | { sessionId: number },
): Promise<number> {
  const everyOne = "memberId" in which && which.except == null;
  const [where, keys]: [string, number[]] =
    "sessionId" in which
      ? ["id = ?", [which.sessionId]]
      : which.except == null
        ? ["member_id = ?", [which.memberId]]
        : ["member_id = ? AND id != ?", [which.memberId, which.except]];
  const ended = await all<{ id: number }>(
    env.DB,
    `UPDATE auth_sessions SET revoked_at = ? WHERE ${where} AND revoked_at IS NULL RETURNING id`,
    [now, ...keys],
  );
  if (!ended.length) return 0;
  const ids = JSON.stringify(ended.map((s) => s.id));
  // Its phones (store app and web push alike): a row each, gone with the sign-in it belonged to
  await run(env.DB, "DELETE FROM push_devices WHERE session_id IN (SELECT value FROM json_each(?))", [ids]);
  await endLive(
    env,
    everyOne && "memberId" in which ? { memberId: which.memberId } : { sessionIds: ended.map((s) => s.id) },
  );
  return ended.length;
}
