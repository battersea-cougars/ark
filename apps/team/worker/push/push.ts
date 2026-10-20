// Notifications on members' phones (ADR 0108). The store app registers its phone after sign-in; a change that's news
// to someone (the night's teams, a place coming up, a session off, an announcement) says who to tell and what, and
// the API wrapper sends it once the change is made, after the reply (waitUntil). A phone belongs to a sign-in:
// signing out, or the session running out, stops its notifications. Each notification is a row in push_outbox until
// it's sent: a send is a batch small enough for the free plan, and the cron sends the rest.
import { batch, run, statement } from "@cougars/shared/d1";
import { HttpError } from "../api/api.http";
import { sendAll, type Message, type Outcome } from "./fcm";
import { scribe } from "@cougars/shared/scribe";
import type { Topic } from "../../src/lib/notification-topics";

const log = scribe.logger("push");

/**
 * Something to tell members: who (or everyone with the app), what it's about (a member can turn a topic off), the
 * words, and where tapping it goes in the app.
 */
export interface Notice {
  to: number[] | "everyone";
  topic: Topic;
  title: string;
  body: string;
  path: string;
}

/** A notification as one phone gets it. */
export interface Sent extends Message {
  memberId: number;
}

/**
 * The fake world's push outbox (testing.ts), like email's: without Firebase each notification is caught here, one
 * per phone. Nothing sets it in a deployed Worker, where an unsent notification is only logged.
 */
export const pushOutbox: { capture?: (sent: Sent) => void } = {};

export interface PushEnv {
  DB: D1Database;
  /** The Google service account that sends through Firebase Cloud Messaging (JSON). Unset: logged, not sent. */
  FIREBASE_SERVICE_ACCOUNT?: string;
}

const PLATFORMS = ["ios", "android"];

/** { token, platform }: this phone, signed in as this session, wants notifications. A token moves with its phone. */
export async function registerDevice(db: D1Database, sessionId: number, o: Record<string, unknown>, now: string) {
  const token = typeof o.token === "string" ? o.token : "";
  if (!token || token.length > 4096) throw new HttpError(400, "token should be the phone's push token.");
  if (typeof o.platform !== "string" || !PLATFORMS.includes(o.platform))
    throw new HttpError(400, "platform should be ios or android.");
  await run(
    db,
    `INSERT INTO push_devices (token, session_id, platform, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET session_id = excluded.session_id, platform = excluded.platform`,
    [token, sessionId, o.platform, now],
  );
}

// Workers Free allows 50 subrequests (fetches) an invocation, and FCM takes one request per phone. A send is at most
// SEND_AT_ONCE phones: with Google's access token (one fetch, once an hour per Worker instance), the live hub and
// whatever else the request or cron run fetches (a Sentry report), that leaves about ten to spare. The rest wait in
// push_outbox for the next cron run (index.ts `scheduled`: every five minutes, and hourly).
export const SEND_AT_ONCE = 40;
/** Tries a notification gets before it's given up: again after 5, 10 and 20 minutes. */
export const PUSH_TRIES = 4;
const RETRY_AFTER_MINUTES = 5;
/** A claim this old was a send that died before it finished: its rows are taken again. */
const CLAIM_EXPIRES_MINUTES = 10;
/** Sent (or long stuck) notifications are kept this long, then pruned, a batch per cron run. */
const KEEP_DAYS = 7;
const PRUNE_AT_ONCE = 500;

const MINUTE = 60_000;
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

/** Rows to send now, claimed so no other send takes them; without Firebase, all of them (nothing is fetched). */
function claim(env: PushEnv, now: Date, claimId: string) {
  return statement(
    env.DB,
    `UPDATE push_outbox SET claim = ?, claimed_at = ?
     WHERE id IN (
       SELECT id FROM push_outbox
       WHERE sent_at IS NULL AND due_at <= ? AND (claimed_at IS NULL OR claimed_at < ?)
       ORDER BY id LIMIT ?)
     RETURNING id, token, member_id memberId, title, body, path, tries`,
    [
      claimId,
      now.toISOString(),
      now.toISOString(),
      ago(now, CLAIM_EXPIRES_MINUTES * MINUTE),
      env.FIREBASE_SERVICE_ACCOUNT ? SEND_AT_ONCE : -1,
    ],
  );
}

/** What's waiting for a phone no longer signed in as its member (signed out, run out, moved on) isn't sent. */
const dropUnwanted = (env: PushEnv, now: Date) =>
  statement(
    env.DB,
    `DELETE FROM push_outbox WHERE sent_at IS NULL AND NOT EXISTS (
       SELECT 1 FROM push_devices d JOIN auth_sessions s ON s.id = d.session_id JOIN members m ON m.id = s.member_id
       WHERE d.token = push_outbox.token AND s.member_id = push_outbox.member_id
         AND s.revoked_at IS NULL AND s.expires_at > ? AND m.status = 'active')`,
    [now.toISOString()],
  );

type Claimed = Sent & { id: number; tries: number };

/**
 * Tell them: a row in the outbox for every phone signed in as one of them who hasn't turned that topic off, written in
 * one statement with the first batch claimed in the same round trip, and that batch sent now (after the reply). A club-wide send bigger than a
 * batch is finished by the cron (drainPush).
 */
export async function notify(env: PushEnv, notices: Notice[], now: Date) {
  const wanted = notices.filter((n) => n.to === "everyone" || n.to.length);
  if (!wanted.length) return;
  const claimId = crypto.randomUUID();
  const [, claimed] = await batch<Claimed>(env.DB, [
    statement(
      env.DB,
      `INSERT INTO push_outbox (token, member_id, title, body, path, created_at, due_at)
       SELECT d.token, s.member_id, n.value ->> '$.title', n.value ->> '$.body', n.value ->> '$.path', ?, ?
       FROM json_each(?) n, push_devices d
       JOIN auth_sessions s ON s.id = d.session_id JOIN members m ON m.id = s.member_id
       WHERE s.revoked_at IS NULL AND s.expires_at > ? AND m.status = 'active'
         AND (n.value ->> '$.to' = 'everyone' OR s.member_id IN (SELECT value FROM json_each(n.value, '$.to')))
         AND NOT EXISTS (SELECT 1 FROM notification_prefs p
           WHERE p.member_id = s.member_id AND p.topic = n.value ->> '$.topic' AND p.enabled = 0)
       ORDER BY n.key, s.member_id, d.token`,
      [now.toISOString(), now.toISOString(), JSON.stringify(wanted), now.toISOString()],
    ),
    claim(env, now, claimId),
  ]);
  await send(env, claimed.results, claimId, now);
}

/** The cron's part: the next batch waiting, and a week's sent notifications pruned, in one round trip. */
export async function drainPush(env: PushEnv, now: Date) {
  const claimId = crypto.randomUUID();
  const [, , claimed] = await batch<Claimed>(env.DB, [
    statement(
      env.DB,
      `DELETE FROM push_outbox WHERE id IN (SELECT id FROM push_outbox WHERE created_at < ? ORDER BY id LIMIT ?)`,
      [ago(now, KEEP_DAYS * 24 * 60 * MINUTE), PRUNE_AT_ONCE],
    ),
    dropUnwanted(env, now),
    claim(env, now, claimId),
  ]);
  await send(env, claimed.results, claimId, now);
}

/**
 * Send what was claimed, then say what became of it in one round trip: sent; gone (the phone is forgotten, and what
 * was waiting for it with it); failed (tried again later, or given up after PUSH_TRIES). Without Firebase each is
 * caught in the push outbox (tests) or logged, and counts as sent.
 */
async function send(env: PushEnv, rows: Claimed[], claimId: string, now: Date) {
  if (!rows.length) return;
  let outcomes: Outcome[];
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    for (const { id: _id, tries: _tries, ...m } of rows) pushOutbox.capture?.(m);
    log.info("push.logged", { phones: rows.length, title: rows[0].title });
    outcomes = rows.map(() => "sent");
  } else {
    try {
      outcomes = await sendAll(env.FIREBASE_SERVICE_ACCOUNT, rows, now.getTime());
    } catch (e) {
      // A notification never fails the change it's about: this batch is tried again later
      log.error("push.failed", e);
      outcomes = rows.map(() => "failed");
    }
  }
  const idsOf = (keep: (r: Claimed, outcome: Outcome) => boolean) =>
    JSON.stringify(rows.filter((r, i) => keep(r, outcomes[i])).map((r) => r.id));
  const lastTry = (r: Claimed) => r.tries + 1 >= PUSH_TRIES;
  const gone = rows.filter((_, i) => outcomes[i] === "gone").map((r) => r.token);
  const failed = outcomes.filter((o) => o === "failed").length;
  const givenUp = rows.filter((r, i) => outcomes[i] === "failed" && lastTry(r)).length;
  const mine = "AND claim = ?";
  await batch(env.DB, [
    statement(env.DB, `UPDATE push_outbox SET sent_at = ? WHERE id IN (SELECT value FROM json_each(?)) ${mine}`, [
      now.toISOString(),
      idsOf((_, o) => o === "sent"),
      claimId,
    ]),
    statement(
      env.DB,
      `UPDATE push_outbox SET tries = tries + 1, claim = NULL, claimed_at = NULL,
         due_at = strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+' || (? << tries) || ' minutes')
       WHERE id IN (SELECT value FROM json_each(?)) ${mine}`,
      [now.toISOString(), RETRY_AFTER_MINUTES, idsOf((r, o) => o === "failed" && !lastTry(r)), claimId],
    ),
    statement(env.DB, `DELETE FROM push_outbox WHERE id IN (SELECT value FROM json_each(?)) ${mine}`, [
      idsOf((r, o) => o === "failed" && lastTry(r)),
      claimId,
    ]),
    // Forgetting a phone takes what was waiting for it too (push_outbox.token cascades)
    statement(env.DB, "DELETE FROM push_devices WHERE token IN (SELECT value FROM json_each(?))", [
      JSON.stringify(gone),
    ]),
  ]);
  if (failed) log.error("push.failed", { failed, of: rows.length });
  if (givenUp) log.error("push.gave_up", { phones: givenUp, tries: PUSH_TRIES });
}
