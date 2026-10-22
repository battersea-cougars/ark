// Notifications on members' devices (ADR 0108). The store app registers its phone after sign-in, and a browser its
// Web Push subscription (#24); a change that's news to someone (the night's teams, a place coming up, a session off,
// an announcement) says who to tell and what, and the API wrapper hands it to the outbox once the change is made, after
// the reply (waitUntil). A device belongs to a sign-in: signing out, or the session running out, stops its
// notifications. Each notification is a row in push_outbox, one per member, until it's sent to their devices: what's
// due goes at once, a batch small enough for the free plan, and the cron sends the rest. Quiet hours and the debounce
// decide when it's due (push.rules.ts has the numbers). A phone's goes through Firebase (fcm.ts), a browser's straight
// to its push service (webpush.ts); the outbox, its batches and retries are the same for both.
import { batch, run, statement } from "@cougars/shared/d1";
import { HttpError } from "../api/api.http";
import { sendAll, type Message, type Outcome, type Result } from "./fcm";
import { pushService, sendAll as sendWeb, validKeys, type Vapid } from "./webpush";
import { scribe } from "@cougars/shared/scribe";
import type { Topic } from "../../src/lib/notification-topics";
import {
  CLAIM_EXPIRES_MINUTES,
  DEBOUNCE_MINUTES,
  DRAIN_AT_ONCE,
  KEEP_DAYS,
  PRUNE_AT_ONCE,
  PUSH_TRIES,
  RETRY_AFTER_MINUTES,
  SEND_AT_ONCE,
  quietUntil,
} from "./push.rules";

export { DRAIN_AT_ONCE, PUSH_TRIES, SEND_AT_ONCE };

const log = scribe.logger("push");

/**
 * Something to tell members: who (or everyone with the app), what it's about (a member can turn a topic off), the
 * words, and where tapping it goes in the app.
 */
export interface Notice {
  to: number[] | "everyone";
  topic: Topic;
  /**
   * The thing it's news about, for the debounce: one waiting per member and key, the newest in its place
   * ("places:session:12": a member's place that night; "teams:12"; "announcement:7", news on its own).
   */
  key: string;
  /** What it tells them about the key ("in", "waitlist", a team): one that waited and ends where the member was last
   * told isn't sent. Unset: its title and body. */
  says?: string;
  /** About something happening now (the draft on the night, the awards at the after-party): sent in quiet hours too. */
  live?: boolean;
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
/** Whether anything is really sent (Firebase, Web Push or both); otherwise every row is caught or logged at once, and
 * nothing waits (no quiet hours, no debounce: your machine has no cron to send it later). */
const sends = (env: PushEnv) => !!env.FIREBASE_SERVICE_ACCOUNT || !!vapidOf(env);

const MINUTE = 60_000;
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();
/** As many as there are: with nothing to send through, nothing is fetched. */
const ALL = 1_000_000_000;

/** The devices a row goes to (`o` is the outbox row): signed in as its member, active, and only those a retry failed
 * on. Takes one parameter, now. */
const devicesOf = (o: string) =>
  `push_devices d JOIN auth_sessions s ON s.id = d.session_id JOIN members m ON m.id = s.member_id
   WHERE s.member_id = ${o}.member_id AND s.revoked_at IS NULL AND s.expires_at > ? AND m.status = 'active'
     AND (${o}.tokens IS NULL OR d.token IN (SELECT value FROM json_each(${o}.tokens)))`;

/** Due to go now (`o` is the outbox row): waiting and past its send_after, or claimed by a send that died. Takes now,
 * then when a claim goes stale. */
const due = (o: string) =>
  `((${o}.state = 'queued' AND ${o}.send_after <= ?) OR (${o}.state = 'claimed' AND ${o}.claimed_at < ?))`;

/**
 * Due, and not to be sent: nobody's device to send it to any more (signed out, run out, made inactive), the topic
 * turned off since, or it waited, was replaced, and ends saying what the member was last told about it (in, bumped,
 * in again: nothing).
 */
function dropUnwanted(env: PushEnv, now: Date) {
  const at = now.toISOString();
  return statement(
    env.DB,
    `UPDATE push_outbox SET state = 'dropped', claim = NULL
     WHERE ${due("push_outbox")} AND (
       NOT EXISTS (SELECT 1 FROM ${devicesOf("push_outbox")})
       OR EXISTS (SELECT 1 FROM notification_prefs p
         WHERE p.member_id = push_outbox.member_id AND p.topic = push_outbox.topic AND p.enabled = 0)
       OR (replaced > 0 AND tokens IS NULL AND says =
         (SELECT t.says FROM push_told t WHERE t.member_id = push_outbox.member_id AND t.key = push_outbox.key)))`,
    [at, ago(now, CLAIM_EXPIRES_MINUTES * MINUTE), at],
  );
}

/**
 * Due rows to send now, oldest first, claimed so no other send takes them, as many as fit in `atOnce` devices (a
 * member's devices are counted when it goes), each with its devices' tokens, platforms and keys. With nothing to send
 * through (no Firebase, no VAPID key), all of them.
 */
function claim(env: PushEnv, now: Date, claimId: string, atOnce: number) {
  const at = now.toISOString();
  const real = sends(env);
  return statement(
    env.DB,
    `UPDATE push_outbox SET state = 'claimed', claim = ?, claimed_at = ?
     WHERE id IN (
       SELECT id FROM (
         SELECT id, devices, sum(devices) OVER (ORDER BY id) upto FROM (
           SELECT o.id, (SELECT count(*) FROM ${devicesOf("o")}) devices FROM push_outbox o
           WHERE ${due("o")}
           ORDER BY o.id LIMIT ?)
         WHERE devices > 0)
       -- The first always fits, so a member with more devices than a batch is still sent to, alone
       WHERE upto <= ? OR upto = devices)
     RETURNING id, member_id memberId, key, says, title, body, path, tries,
       (SELECT json_group_array(json_object('token', d.token, 'platform', d.platform, 'webKeys', d.web_keys))
        FROM ${devicesOf("push_outbox")}) devices`,
    [claimId, at, at, at, ago(now, CLAIM_EXPIRES_MINUTES * MINUTE), real ? atOnce : -1, real ? atOnce : ALL, at],
  );
}

/** A claimed row: one member's notification, and the devices it goes to (JSON). */
interface Claimed {
  id: number;
  memberId: number;
  key: string;
  says: string;
  title: string;
  body: string;
  path: string;
  tries: number;
  devices: string;
}
/** One device's send of a claimed row. */
type Delivery = Sent & { row: number; platform: string; webKeys: string | null };

/**
 * Tell them: a row in the outbox for every member with a device signed in who hasn't turned that topic off, written
 * in one statement, and in the same round trip the rows due now claimed (this one's and any others), and sent now
 * (after the reply). When a row is due: at once; in quiet hours (QUIET_HOURS, London), at their end, unless it's
 * `live`; and within DEBOUNCE_MINUTES of the member being told about the same key, at the end of that. One already
 * waiting for the member and key takes the new words (the latest wins). The cron sends what's left (drainPush).
 * `atOnce` is how many devices go now: fewer when the invocation has other requests to make (tell, whose emails come
 * first), none to leave them all for the cron.
 */
export async function notify(env: PushEnv, notices: Notice[], now: Date, atOnce = SEND_AT_ONCE) {
  const wanted = notices
    .filter((n) => n.to === "everyone" || n.to.length)
    .map((n) => ({ ...n, says: n.says ?? `${n.title}\n${n.body}` }));
  if (!wanted.length) return;
  const at = now.toISOString();
  const real = sends(env);
  const quietEnds = real ? (quietUntil(now)?.toISOString() ?? at) : at;
  const debounceSeconds = real ? DEBOUNCE_MINUTES * 60 : 0;
  const claimId = crypto.randomUUID();
  const [, , claimed] = await batch<Claimed>(env.DB, [
    statement(
      env.DB,
      `INSERT INTO push_outbox (member_id, key, topic, title, body, path, says, created_at, send_after)
       SELECT r.member_id, n.value ->> '$.key', n.value ->> '$.topic', n.value ->> '$.title', n.value ->> '$.body',
         n.value ->> '$.path', n.value ->> '$.says', ?,
         max(CASE WHEN n.value ->> '$.live' THEN ? ELSE ? END,
           COALESCE((SELECT strftime('%Y-%m-%dT%H:%M:%fZ', t.told_at, '+' || ? || ' seconds') FROM push_told t
             WHERE t.member_id = r.member_id AND t.key = n.value ->> '$.key'), ?))
       FROM json_each(?) n
       JOIN (SELECT DISTINCT s.member_id FROM push_devices d
         JOIN auth_sessions s ON s.id = d.session_id JOIN members m ON m.id = s.member_id
         WHERE s.revoked_at IS NULL AND s.expires_at > ? AND m.status = 'active') r
         ON n.value ->> '$.to' = 'everyone' OR r.member_id IN (SELECT value FROM json_each(n.value, '$.to'))
       WHERE NOT EXISTS (SELECT 1 FROM notification_prefs p
         WHERE p.member_id = r.member_id AND p.topic = n.value ->> '$.topic' AND p.enabled = 0)
       ORDER BY n.key, r.member_id
       ON CONFLICT (member_id, key) WHERE state = 'queued' DO UPDATE SET
         topic = excluded.topic, title = excluded.title, body = excluded.body, path = excluded.path,
         says = excluded.says, send_after = min(send_after, excluded.send_after), replaced = replaced + 1,
         tries = 0, tokens = NULL`,
      [at, at, quietEnds, debounceSeconds, at, JSON.stringify(wanted), at],
    ),
    dropUnwanted(env, now),
    claim(env, now, claimId, atOnce),
  ]);
  await send(env, claimed.results, claimId, now);
}

/** The cron's part: the next batch due, and a week's sent notifications pruned, in one round trip. */
export async function drainPush(env: PushEnv, now: Date, atOnce = DRAIN_AT_ONCE) {
  const claimId = crypto.randomUUID();
  const week = ago(now, KEEP_DAYS * 24 * 60 * MINUTE);
  const [, , , claimed] = await batch<Claimed>(env.DB, [
    statement(
      env.DB,
      `DELETE FROM push_outbox WHERE id IN (SELECT id FROM push_outbox WHERE created_at < ? ORDER BY id LIMIT ?)`,
      [week, PRUNE_AT_ONCE],
    ),
    statement(env.DB, "DELETE FROM push_told WHERE told_at < ?", [week]),
    dropUnwanted(env, now),
    claim(env, now, claimId, atOnce),
  ]);
  await send(env, claimed.results, claimId, now);
}

/**
 * Each device through its own way, phones through Firebase and browsers to their push services, at the same time;
 * what became of each, in the same order. A way that isn't set up (your machine, tests) catches its sends in the push
 * outbox or logs them, and they count as sent.
 */
async function deliver(env: PushEnv, all: Delivery[], now: Date): Promise<Result[]> {
  const web = all.flatMap((d, i) => (d.platform === "web" ? [i] : []));
  const phones = all.flatMap((d, i) => (d.platform !== "web" ? [i] : []));
  const vapid = vapidOf(env);
  const account = env.FIREBASE_SERVICE_ACCOUNT;
  const [webResults, phoneResults] = await Promise.all([
    through(
      web.map((i) => all[i]),
      vapid &&
        (() =>
          sendWeb(
            vapid,
            web.map((i) => ({ ...all[i], keys: JSON.parse(all[i].webKeys ?? "null") })),
            now.getTime(),
          )),
    ),
    through(
      phones.map((i) => all[i]),
      account
        ? () =>
            sendAll(
              account,
              phones.map((i) => all[i]),
              now.getTime(),
            )
        : null,
    ),
  ]);
  const results: Result[] = new Array(all.length);
  web.forEach((i, k) => (results[i] = webResults[k]));
  phones.forEach((i, k) => (results[i] = phoneResults[k]));
  return results;
}

async function through(sends: Delivery[], send: (() => Promise<Result[]>) | null): Promise<Result[]> {
  if (!sends.length) return [];
  if (!send) {
    for (const d of sends)
      pushOutbox.capture?.({ token: d.token, memberId: d.memberId, title: d.title, body: d.body, path: d.path });
    log.info("push.logged", { devices: sends.length, platform: sends[0].platform, title: sends[0].title });
    return sends.map(() => ({ outcome: "sent" }));
  }
  try {
    return await send();
  } catch (e) {
    // A notification never fails the change it's about: this batch is tried again later
    log.error("push.failed", e);
    return sends.map(() => ({ outcome: "failed" }));
  }
}

/**
 * Send what was claimed to each row's devices, then say what became of it in one round trip: sent (and what the member
 * was last told about its key, for the debounce); a device gone (forgotten); failed on a device (tried again later on
 * those it failed on, unless a newer one for the same thing is waiting, or given up after PUSH_TRIES); nobody's left
 * to send to (dropped).
 */
async function send(env: PushEnv, rows: Claimed[], claimId: string, now: Date) {
  if (!rows.length) return;
  const all: Delivery[] = rows.flatMap((r, row) =>
    (JSON.parse(r.devices) as { token: string; platform: string; webKeys: string | null }[]).map((d) => ({
      ...d,
      row,
      memberId: r.memberId,
      title: r.title,
      body: r.body,
      path: r.path,
    })),
  );
  const results = await deliver(env, all, now);
  const outcomes: Outcome[] = results.map((r) => r.outcome);
  const reasons = [...new Set(results.flatMap((r) => (r.reason ? [r.reason] : [])))];
  const of = (row: number, outcome: Outcome) =>
    all.flatMap((d, i) => (d.row === row && outcomes[i] === outcome ? [d.token] : []));
  const told: number[] = [];
  const sent: number[] = [];
  const dropped: number[] = [];
  const retry: { id: number; tokens: string[] }[] = [];
  let givenUp = 0;
  rows.forEach((r, row) => {
    const failedOn = of(row, "failed");
    if (of(row, "sent").length) told.push(r.id);
    if (!failedOn.length) (of(row, "sent").length ? sent : dropped).push(r.id);
    else if (r.tries + 1 >= PUSH_TRIES) {
      dropped.push(r.id);
      givenUp += failedOn.length;
    } else retry.push({ id: r.id, tokens: failedOn });
  });
  const gone = all.filter((_, i) => outcomes[i] === "gone").map((d) => d.token);
  const failed = outcomes.filter((o) => o === "failed").length;
  const ids = (list: number[]) => JSON.stringify(list);
  const mine = "AND claim = ?";
  const at = now.toISOString();
  await batch(env.DB, [
    // First, while every row is still this send's: what each member has now been told about the thing
    statement(
      env.DB,
      `INSERT INTO push_told (member_id, key, says, told_at)
       SELECT member_id, key, says, ? FROM push_outbox WHERE id IN (SELECT value FROM json_each(?)) ${mine}
       ON CONFLICT (member_id, key) DO UPDATE SET says = excluded.says, told_at = excluded.told_at`,
      [at, ids(told), claimId],
    ),
    statement(
      env.DB,
      `UPDATE push_outbox SET state = 'sent', sent_at = ? WHERE id IN (SELECT value FROM json_each(?)) ${mine}`,
      [at, ids(sent), claimId],
    ),
    statement(env.DB, `UPDATE push_outbox SET state = 'dropped' WHERE id IN (SELECT value FROM json_each(?)) ${mine}`, [
      ids(dropped),
      claimId,
    ]),
    // Again later, on the devices it failed on; a newer one about the same thing waiting already says it instead
    statement(
      env.DB,
      `UPDATE push_outbox SET tries = tries + 1, claim = NULL, claimed_at = NULL,
         state = CASE WHEN EXISTS (SELECT 1 FROM push_outbox q WHERE q.member_id = push_outbox.member_id
           AND q.key = push_outbox.key AND q.state = 'queued') THEN 'dropped' ELSE 'queued' END,
         tokens = (SELECT r.value ->> '$.tokens' FROM json_each(?) r WHERE r.value ->> '$.id' = push_outbox.id),
         send_after = strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+' || (? << tries) || ' minutes')
       WHERE id IN (SELECT value ->> '$.id' FROM json_each(?)) ${mine}`,
      [JSON.stringify(retry), at, RETRY_AFTER_MINUTES, JSON.stringify(retry), claimId],
    ),
    // Forgotten: what was waiting for the device goes nowhere (a row's devices are found when it's sent)
    statement(env.DB, "DELETE FROM push_devices WHERE token IN (SELECT value FROM json_each(?))", [
      JSON.stringify(gone),
    ]),
  ]);
  if (failed) log.error("push.failed", { failed, of: all.length, reasons });
  if (givenUp) log.error("push.gave_up", { devices: givenUp, tries: PUSH_TRIES });
}
