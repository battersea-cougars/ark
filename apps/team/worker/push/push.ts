// Notifications on members' phones (ADR 0108). The store app registers its phone after sign-in; a change that's news
// to someone (the night's teams, a place coming up, a session off, an announcement) says who to tell and what, and
// the API wrapper sends it once the change is made, after the reply (waitUntil). A phone belongs to a sign-in:
// signing out, or the session running out, stops its notifications.
import { all, run } from "@cougars/shared/d1";
import { HttpError } from "../api/api.http";
import { sendAll, type Message } from "./fcm";

/** Something to tell members: who (or everyone with the app), the words, and where tapping it goes in the app. */
export interface Notice {
  to: number[] | "everyone";
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

/** Tell them: every phone signed in as one of them, in one read; phones Firebase says are gone are forgotten. */
export async function notify(env: PushEnv, notices: Notice[], now: Date) {
  const wanted = notices.filter((n) => n.to === "everyone" || n.to.length);
  if (!wanted.length) return;
  const phones = await all<{ token: string; memberId: number }>(
    env.DB,
    `SELECT d.token, s.member_id memberId FROM push_devices d
     JOIN auth_sessions s ON s.id = d.session_id JOIN members m ON m.id = s.member_id
     WHERE s.revoked_at IS NULL AND s.expires_at > ? AND m.status = 'active'`,
    [now.toISOString()],
  );
  const messages: Sent[] = wanted.flatMap((n) =>
    phones
      .filter((p) => n.to === "everyone" || n.to.includes(p.memberId))
      .map((p) => ({ token: p.token, memberId: p.memberId, title: n.title, body: n.body, path: n.path })),
  );
  if (!messages.length) return;
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    for (const m of messages) pushOutbox.capture?.(m);
    console.log(JSON.stringify({ event: "push.logged", phones: messages.length, title: messages[0].title }));
    return;
  }
  try {
    const outcomes = await sendAll(env.FIREBASE_SERVICE_ACCOUNT, messages, now.getTime());
    const gone = messages.filter((_, i) => outcomes[i] === "gone").map((m) => m.token);
    if (gone.length)
      await run(env.DB, "DELETE FROM push_devices WHERE token IN (SELECT value FROM json_each(?))", [
        JSON.stringify(gone),
      ]);
    const failed = outcomes.filter((o) => o === "failed").length;
    if (failed) console.error(JSON.stringify({ event: "push.failed", failed, of: messages.length }));
  } catch (e) {
    // A notification never fails the change it's about
    console.error(JSON.stringify({ event: "push.failed", error: String(e) }));
  }
}
