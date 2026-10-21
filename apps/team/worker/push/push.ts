// Notifications on members' devices (ADR 0108). The store app registers its phone after sign-in, and a browser its
// Web Push subscription (#24); a change that's news to someone (the night's teams, a place coming up, a session off,
// an announcement) says who to tell and what, and the API wrapper sends it once the change is made, after the reply
// (waitUntil). A device belongs to a sign-in: signing out, or the session running out, stops its notifications. Each
// notification is a row in push_outbox until it's sent: a send is a batch small enough for the free plan, and the
// cron sends the rest. A phone's goes through Firebase (fcm.ts), a browser's straight to its push service
// (webpush.ts); the outbox, its batches and retries are the same for both.
import { batch, run, statement } from "@cougars/shared/d1";
import { HttpError } from "../api/api.http";
import { sendAll, type Message, type Outcome, type Result } from "./fcm";
import { pushService, sendAll as sendWeb, validKeys, type Vapid } from "./webpush";
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

/** A notification as one device gets it. */
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
  /** The club's VAPID key pair for Web Push (base64url): the public key is a var (wrangler.jsonc), the private a
   * secret (README#web-push). Either unset: a browser's notification is logged, not sent. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

const PLATFORMS = ["ios", "android", "web"];
const MAX_TOKEN = 4096;

/**
 * This device, signed in as this session, wants notifications: a phone's `{ token, platform: "ios" | "android" }`, or
 * a browser's `{ platform: "web", subscription }` (PushSubscription.toJSON(): its endpoint and keys), the endpoint
 * on a browser's push service and nowhere else (webpush.ts). A device moves to whoever signs in on it next.
 */
export async function registerDevice(db: D1Database, sessionId: number, o: Record<string, unknown>, now: string) {
  if (typeof o.platform !== "string" || !PLATFORMS.includes(o.platform))
    throw new HttpError(400, "platform should be ios, android or web.");
  let token = typeof o.token === "string" ? o.token : "";
  let keys: string | null = null;
  if (o.platform === "web") {
    const sub = (o.subscription ?? {}) as { endpoint?: unknown; keys?: unknown };
    token = typeof sub.endpoint === "string" ? sub.endpoint : "";
    if (!token || token.length > MAX_TOKEN || !pushService(token))
      throw new HttpError(400, "subscription.endpoint should be a browser's push service.");
    if (!validKeys(sub.keys)) throw new HttpError(400, "subscription.keys should be the browser's p256dh and auth.");
    keys = JSON.stringify({ p256dh: sub.keys.p256dh, auth: sub.keys.auth });
  } else if (!token || token.length > MAX_TOKEN) throw new HttpError(400, "token should be the phone's push token.");
  await run(
    db,
    `INSERT INTO push_devices (token, session_id, platform, web_keys, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET session_id = excluded.session_id, platform = excluded.platform,
       web_keys = excluded.web_keys`,
    [token, sessionId, o.platform, keys, now],
  );
}

/** `{ token }`: this device, if it's this session's, wants no more notifications (a browser's switch turned off). */
export async function forgetDevice(db: D1Database, sessionId: number, o: Record<string, unknown>) {
  if (typeof o.token !== "string" || !o.token) throw new HttpError(400, "token should be the device's.");
  await run(db, "DELETE FROM push_devices WHERE token = ? AND session_id = ?", [o.token, sessionId]);
}

const vapidOf = (env: PushEnv): Vapid | null =>
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
    : null;
/** Whether anything is really sent (Firebase, Web Push or both); otherwise every row is caught or logged at once. */
const sends = (env: PushEnv) => !!env.FIREBASE_SERVICE_ACCOUNT || !!vapidOf(env);

// Workers Free allows 50 subrequests (fetches) an invocation, and FCM takes one request per phone, Web Push one per
// browser. A send is at most SEND_AT_ONCE devices: with Google's access token (one fetch, once an hour per Worker instance), the live hub and
// whatever else the request or cron run fetches (a Sentry report), that leaves about ten to spare. The rest wait in
// push_outbox for the next cron run (index.ts `scheduled`: every five minutes, and hourly).
export const SEND_AT_ONCE = 40;
/**
 * A cron run sends fewer: the same invocation also sends dues reminders (an email each, REMINDERS.perRun) and asks for
 * a website rebuild, and all of it shares the 50 (docs/load-testing.md has the sums).
 */
export const DRAIN_AT_ONCE = 25;
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

/** Up to `atOnce` rows to send now, claimed so no other send takes them, each with its device's platform and keys;
 * with nothing to send through (no Firebase, no VAPID key), all of them (nothing is fetched). */
function claim(env: PushEnv, now: Date, claimId: string, atOnce: number) {
  return statement(
    env.DB,
    `UPDATE push_outbox SET claim = ?, claimed_at = ?
     WHERE id IN (
       SELECT id FROM push_outbox
       WHERE sent_at IS NULL AND due_at <= ? AND (claimed_at IS NULL OR claimed_at < ?)
       ORDER BY id LIMIT ?)
     RETURNING id, token, member_id memberId, title, body, path, tries,
       (SELECT platform FROM push_devices d WHERE d.token = push_outbox.token) platform,
       (SELECT web_keys FROM push_devices d WHERE d.token = push_outbox.token) webKeys`,
    [claimId, now.toISOString(), now.toISOString(), ago(now, CLAIM_EXPIRES_MINUTES * MINUTE), sends(env) ? atOnce : -1],
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

type Claimed = Sent & { id: number; tries: number; platform: string; webKeys: string | null };

/**
 * Tell them: a row in the outbox for every phone signed in as one of them who hasn't turned that topic off, written in
 * one statement with the first batch claimed in the same round trip, and that batch sent now (after the reply). A club-wide send bigger than a
 * batch is finished by the cron (drainPush). `atOnce` is how many go now: fewer when the invocation has other
 * requests to make (tell, whose emails come first), none to leave them all for the cron.
 */
export async function notify(env: PushEnv, notices: Notice[], now: Date, atOnce = SEND_AT_ONCE) {
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
    claim(env, now, claimId, atOnce),
  ]);
  await send(env, claimed.results, claimId, now);
}

/** The cron's part: the next batch waiting, and a week's sent notifications pruned, in one round trip. */
export async function drainPush(env: PushEnv, now: Date, atOnce = DRAIN_AT_ONCE) {
  const claimId = crypto.randomUUID();
  const [, , claimed] = await batch<Claimed>(env.DB, [
    statement(
      env.DB,
      `DELETE FROM push_outbox WHERE id IN (SELECT id FROM push_outbox WHERE created_at < ? ORDER BY id LIMIT ?)`,
      [ago(now, KEEP_DAYS * 24 * 60 * MINUTE), PRUNE_AT_ONCE],
    ),
    dropUnwanted(env, now),
    claim(env, now, claimId, atOnce),
  ]);
  await send(env, claimed.results, claimId, now);
}

/**
 * Each row through its own way, phones through Firebase and browsers to their push services, at the same time; what
 * became of each, in the rows' order. A way that isn't set up (your machine, tests) catches its rows in the push
 * outbox or logs them, and they count as sent.
 */
async function deliver(env: PushEnv, rows: Claimed[], now: Date): Promise<Result[]> {
  const web = rows.filter((r) => r.platform === "web");
  const phones = rows.filter((r) => r.platform !== "web");
  const vapid = vapidOf(env);
  const account = env.FIREBASE_SERVICE_ACCOUNT;
  const [webResults, phoneResults] = await Promise.all([
    through(
      web,
      vapid &&
        (() =>
          sendWeb(
            vapid,
            web.map((r) => ({ ...r, keys: JSON.parse(r.webKeys ?? "null") })),
            now.getTime(),
          )),
    ),
    through(phones, account ? () => sendAll(account, phones, now.getTime()) : null),
  ]);
  const byId = new Map([
    ...web.map((r, i) => [r.id, webResults[i]] as const),
    ...phones.map((r, i) => [r.id, phoneResults[i]] as const),
  ]);
  return rows.map((r) => byId.get(r.id)!);
}

async function through(rows: Claimed[], send: (() => Promise<Result[]>) | null): Promise<Result[]> {
  if (!rows.length) return [];
  if (!send) {
    for (const r of rows)
      pushOutbox.capture?.({ token: r.token, memberId: r.memberId, title: r.title, body: r.body, path: r.path });
    log.info("push.logged", { devices: rows.length, platform: rows[0].platform, title: rows[0].title });
    return rows.map(() => ({ outcome: "sent" }));
  }
  try {
    return await send();
  } catch (e) {
    // A notification never fails the change it's about: this batch is tried again later
    log.error("push.failed", e);
    return rows.map(() => ({ outcome: "failed" }));
  }
}

/**
 * Send what was claimed, then say what became of it in one round trip: sent; gone (the device is forgotten, and what
 * was waiting for it with it); failed (tried again later, or given up after PUSH_TRIES).
 */
async function send(env: PushEnv, rows: Claimed[], claimId: string, now: Date) {
  if (!rows.length) return;
  const results = await deliver(env, rows, now);
  const outcomes: Outcome[] = results.map((r) => r.outcome);
  const reasons = [...new Set(results.flatMap((r) => (r.reason ? [r.reason] : [])))];
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
    // Forgetting a device takes what was waiting for it too (push_outbox.token cascades)
    statement(env.DB, "DELETE FROM push_devices WHERE token IN (SELECT value FROM json_each(?))", [
      JSON.stringify(gone),
    ]),
  ]);
  if (failed) log.error("push.failed", { failed, of: rows.length, reasons });
  if (givenUp) log.error("push.gave_up", { devices: givenUp, tries: PUSH_TRIES });
}
