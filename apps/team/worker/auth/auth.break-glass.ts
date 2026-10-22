// Break glass (ADR 0023): the way back in when Gmail is down, every admin has lost their passkeys and none is signed
// in. There's no route that makes one: someone with the club's Bitwarden and Cloudflare runs
// `npm run admin:break-glass -- <admin's email>` at a terminal (scripts/admin-break-glass.mjs), which writes one
// sign-in code for that admin into D1, hashed like any code, for 15 minutes, and prints it there. No browser asked for
// it, so it has no nonce yet ('break-glass'): the first browser to ask for that admin's code on the usual sign-in page
// claims it, in one statement, and isn't emailed anything. From then on it's a code like any other, bound to that
// browser, with the same five tries and the browser's daily limit; using it is a session of method `break_glass`.
// Every step is on the record (`auth.break_glass`: issued, signed in, ended), every admin is told on their phone and
// by email (if email's working), and each admin's Home lists the week's, with a way to sign the session out or call
// off a code nobody's used.
import { all, first, run } from "@cougars/shared/d1";
import { sendMail } from "@cougars/shared/email";
import type { Route } from "../api/api.route";
import { ok } from "../api/api.route";
import { HttpError } from "../api/api.http";
import { mayChange } from "../members/members";
import { notify } from "../push/push";
import { audit } from "../settings/audit";
import { mailSetup, type AuthEnv, type Waiter } from "./auth";
import { endSessions } from "./auth.sessions";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("auth");

/** What a break-glass code's nonce is until a browser claims it: never a nonce's hash (those are hex). */
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
    [{ to: everyone.map((a) => a.id), topic: "security", title: "Break-glass sign-in", body, path: "/" }],
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

type Kind = "code" | "session";

/** The week's break-glass codes not used, and its break-glass sessions, newest first: each admin's Home lists them. */
async function breakGlassShown(db: D1Database, now: string) {
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
async function stillLive(db: D1Database, kind: Kind, id: number, now: string) {
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

/** Calling off a code nobody's used, or signing a break-glass session out: nobody meant to. */
const endRoute = (kind: Kind, plural: string): Route => ({
  method: "POST",
  path: new RegExp(`^\\/api\\/break-glass\\/${plural}\\/(\\d+)\\/end$`),
  audit: {
    event: "auth.break_glass",
    subject: async (c) => {
      const row = await stillLive(c.env.DB, kind, Number(c.params[0]), c.now);
      return row && { live: row.live };
    },
    about: (c) => ({ step: "ended", kind, id: Number(c.params[0]) }),
  },
  action: "manage:Member",
  changes: ["members"],
  // The session is signed out (its phones and live pages with it), or the code can't be used
  handle: async (c) => {
    const id = Number(c.params[0]);
    const row = await stillLive(c.env.DB, kind, id, c.now);
    if (!row) throw new HttpError(404, "There's no break-glass sign-in like that.");
    await mayChange(c.env.DB, c.actions, row.memberId);
    if (kind === "session") await endSessions(c.env, c.now, { sessionId: id });
    else
      await run(c.env.DB, "UPDATE login_challenges SET expires_at = ? WHERE id = ? AND used_at IS NULL", [c.now, id]);
    return ok();
  },
});

export const BREAK_GLASS_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/break-glass$/,
    action: "manage:Member",
    // Home's line for admins: who got in that way this week, and whether it's still a way in
    handle: async (c) => Response.json({ breakGlass: await breakGlassShown(c.env.DB, c.now) }),
  },
  endRoute("code", "codes"),
  endRoute("session", "sessions"),
];
