// Break glass (ADR 0023): the way back in when Gmail is down and no admin can sign in. A code made only at a terminal
// (scripts/admin-break-glass.mjs) is claimed by the first browser to ask for that admin's code, put on the record, and
// told to every admin.
import { all, first, run } from "@cougars/shared/d1";
import { sendMail } from "@cougars/shared/email";
import { notify } from "../push/push";
import { audit } from "../settings/audit";
import { mailSetup, type AuthEnv, type Waiter } from "./auth";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("auth");

/**
 * What a break-glass code's nonce is until a browser claims it: never a nonce's hash (those are hex). The code is
 * written at a terminal (scripts/admin-break-glass.mjs), hashed like any code, for 15 minutes; once claimed it's a
 * code like any other, with the same tries and limits, and its session's method is `break_glass`.
 */
export const UNCLAIMED = "break-glass";
/** How far back each admin's Home shows them. */
const SHOWN_DAYS = 7;

/**
 * A browser asks for this member's code: if a break-glass code is waiting for them, it's this browser's now, and the
 * caller sends nothing. True when it claimed one. Only one browser can: the statement takes it only while unclaimed.
 */
export async function claimBreakGlass(db: D1Database, now: Date, memberId: number, nonceHash: string) {
  const claimed = await run(
    db,
    `UPDATE login_challenges SET nonce_hash = ?
     WHERE member_id = ? AND kind = 'break_glass' AND nonce_hash = ? AND used_at IS NULL AND expires_at > ?`,
    [nonceHash, memberId, UNCLAIMED, now.toISOString()],
  );
  return claimed.meta.changes > 0;
}

/** The active members who can do everything: who's told, and who a break-glass code can be for. */
const admins = (db: D1Database) =>
  all<{ id: number; name: string; email: string | null }>(
    db,
    `SELECT DISTINCT m.id, m.name, m.email FROM members m
       JOIN member_roles mr ON mr.member_id = m.id JOIN role_actions ra ON ra.role_id = mr.role_id
     WHERE ra.action = 'manage:all' AND m.status = 'active' ORDER BY m.id`,
  );

/**
 * Someone just signed in with a break-glass code: on the record, and every admin hears of it, on their phone and by
 * email. Email may well be what's down, so neither waits on the other and a failure is only logged.
 */
export async function brokeGlass(env: AuthEnv, now: Date, memberId: number, sessionId: number, waitUntil?: Waiter) {
  await audit(env.DB, now, memberId, "auth.break_glass", { step: "signed_in", sessionId });
  const everyone = await admins(env.DB);
  const who = everyone.find((a) => a.id === memberId)?.name ?? "An admin";
  const body = `${who} signed in with a break-glass code. Not them? Sign it out on Home.`;
  const pushed = notify(
    env,
    [
      {
        to: everyone.map((a) => a.id),
        topic: "security",
        // Each break-glass sign-in is news of its own, and can't wait for the morning
        key: `break-glass:${sessionId}`,
        live: true,
        title: "Break-glass sign-in",
        body,
        path: "/",
      },
    ],
    now,
  ).catch((e) => log.error("push.failed", e));
  const to = everyone.map((a) => a.email).filter((e): e is string => !!e);
  const emailed = (async () => {
    if (!to.length) return;
    await sendMail(
      {
        to,
        subject: "Cougars: a break-glass sign-in",
        text: [
          body,
          "",
          "A break-glass code is made at a terminal, by someone with the club's Bitwarden and Cloudflare, for when",
          "nobody can sign in any other way. If nobody meant to, sign that session out from Home in the team app,",
          "and look at the Activity page.",
          "",
          "Battersea Cougars Inline Hockey Club",
        ].join("\n"),
      },
      await mailSetup(env),
    );
  })().catch((e) => log.error("break_glass.email_failed", e));
  const told = Promise.all([pushed, emailed]);
  if (waitUntil) waitUntil(told);
  else await told;
}

export type Kind = "code" | "session";

/** The week's break-glass codes not used, and its break-glass sessions, newest first: each admin's Home lists them. */
export async function breakGlassShown(db: D1Database, now: string) {
  const since = new Date(Date.parse(now) - SHOWN_DAYS * 86_400_000).toISOString();
  const rows = await all<{ kind: Kind; id: number; memberId: number; at: string; live: number }>(
    db,
    `SELECT 'code' kind, id, member_id memberId, created_at at, (used_at IS NULL AND expires_at > ?) live
       FROM login_challenges WHERE kind = 'break_glass' AND used_at IS NULL AND created_at > ?
     UNION ALL
     SELECT 'session', id, member_id, created_at, (revoked_at IS NULL AND expires_at > ?)
       FROM auth_sessions WHERE method = 'break_glass' AND created_at > ?
     ORDER BY at DESC`,
    [now, since, now, since],
  );
  return rows.map((r) => ({ ...r, live: !!r.live }));
}

/** Whether a break-glass code or session is still a way in: what ending it changes, on the record. */
export async function stillLive(db: D1Database, kind: Kind, id: number, now: string) {
  const row =
    kind === "code"
      ? await first<{ memberId: number; live: number }>(
          db,
          `SELECT member_id memberId, (used_at IS NULL AND expires_at > ?) live FROM login_challenges
           WHERE id = ? AND kind = 'break_glass'`,
          [now, id],
        )
      : await first<{ memberId: number; live: number }>(
          db,
          `SELECT member_id memberId, (revoked_at IS NULL AND expires_at > ?) live FROM auth_sessions
           WHERE id = ? AND method = 'break_glass'`,
          [now, id],
        );
  return row && { memberId: row.memberId, live: !!row.live };
}
