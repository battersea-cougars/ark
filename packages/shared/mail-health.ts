// Whether the club's email works (ADR 0027): the last email Gmail took, and the first failure since, with why (a
// cancelled token, Gmail busy, anything else). One row in D1 (mail_health), written by both Workers as they send
// (MailConfig.onOutcome) and when an admin reconnects; read by the team app's Settings → Email and the admins' Home.
import { first, run } from "./d1";
import type { MailFailure, MailOutcome } from "./email";

/** A working send is written at most this often: most emails then write nothing. */
const QUIET_MS = 5 * 60_000;

export interface MailHealth {
  account: string | null;
  lastSentAt: string | null;
  failedAt: string | null;
  failure: MailFailure | null;
  reconnectedAt: string | null;
  reconnectedBy: number | null;
}

export async function readMailHealth(db: D1Database): Promise<MailHealth> {
  const row = await first<MailHealth>(
    db,
    `SELECT account, last_sent_at lastSentAt, failed_at failedAt, failure, reconnected_at reconnectedAt,
            reconnected_by reconnectedBy FROM mail_health WHERE id = 1`,
  );
  return (
    row ?? { account: null, lastSentAt: null, failedAt: null, failure: null, reconnectedAt: null, reconnectedBy: null }
  );
}

/**
 * How a send went. A failure is written when its reason changes (the first time is when it started); a working send
 * clears it. Says "cancelled" when this send is the one that found the token cancelled, so the admins are told once.
 */
export async function recordMail(db: D1Database, outcome: MailOutcome, now: Date): Promise<"cancelled" | null> {
  const at = now.toISOString();
  if (outcome.ok) {
    await run(
      db,
      `INSERT INTO mail_health (id, account, last_sent_at) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET account = excluded.account, last_sent_at = excluded.last_sent_at,
         failed_at = NULL, failure = NULL
       WHERE failure IS NOT NULL OR account IS NOT excluded.account OR last_sent_at IS NULL OR last_sent_at < ?`,
      [outcome.account, at, new Date(now.getTime() - QUIET_MS).toISOString()],
    );
    return null;
  }
  const changed = await first<{ failure: MailFailure }>(
    db,
    `INSERT INTO mail_health (id, failed_at, failure) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET failed_at = coalesce(failed_at, excluded.failed_at), failure = excluded.failure
     WHERE failure IS NOT excluded.failure
     RETURNING failure`,
    [at, outcome.failure],
  );
  return changed?.failure === "cancelled" ? "cancelled" : null;
}

/** An admin reconnected: the new token's account, and nothing failing until a send says otherwise. */
export async function recordReconnect(db: D1Database, account: string, memberId: number, now: string) {
  await run(
    db,
    `INSERT INTO mail_health (id, account, reconnected_at, reconnected_by) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET account = excluded.account, reconnected_at = excluded.reconnected_at,
       reconnected_by = excluded.reconnected_by, failed_at = NULL, failure = NULL`,
    [account, now, memberId],
  );
}
