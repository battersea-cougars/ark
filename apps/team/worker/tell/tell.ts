// Telling a member something that's theirs to know (what they owe, ADR 0007): one call, whatever the channel. Today
// that's an email, through the club's sender and its rules (packages/shared/email.ts, ADR 0027: outside production it
// reaches only the safe inbox, the admins and the Dev tools list), and a notification on their phone if they have the
// store app (push/push.ts, ADR 0108). A feature says what to tell whom; it never touches Gmail or Firebase itself, so a
// channel can be added (web push, #24) here without changing it.
import { sendMail, type Mail } from "@cougars/shared/email";
import { mailSetup } from "../auth/auth";
import { notify, type Notice, type PushEnv } from "../push/push";
import type { Env } from "../api/api.route";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("tell");

/** What one member is told: the email (always), and the line their phone shows. */
export interface Message {
  memberId: number;
  mail: Mail;
  notice: Omit<Notice, "to">;
}

/**
 * Tell each member theirs: the emails one by one (each is one request to Gmail), then every phone notification in one
 * `notify`. A member whose email failed isn't notified either, so they hear it once, when it's tried again. Returns
 * whose email went. The caller keeps the batch small: a Worker run makes at most 50 requests (ADR 0003), and the
 * emails have taken theirs, so the phones are only queued: the next push drain (the five-minute cron) sends them.
 */
export async function tell(env: Env & PushEnv, messages: Message[], now: Date): Promise<Set<number>> {
  if (!messages.length) return new Set();
  const setup = await mailSetup(env);
  const told = new Set<number>();
  for (const m of messages) {
    try {
      await sendMail(m.mail, setup);
      told.add(m.memberId);
    } catch (e) {
      log.error("tell.email_failed", e, { memberId: m.memberId });
    }
  }
  const notices = messages.filter((m) => told.has(m.memberId)).map((m) => ({ ...m.notice, to: [m.memberId] }));
  // A notification never stops the email it goes with
  await notify(env, notices, now, 0).catch((e) => log.error("push.failed", e));
  return told;
}
