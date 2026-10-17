import { first, run } from "@cougars/shared/d1";

// The form's rules live in lib/enquiry-form.ts, shared with the page
export * from "../enquiry-form";
import type { Enquiry } from "../enquiry-form";

/** Save an enquiry. `verified`: Cloudflare Turnstile said a person sent it (lib/server/turnstile.ts). */
export async function saveEnquiry(db: D1Database, e: Enquiry, { verified = false } = {}): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO enquiries (name, email, phone, experience, message, source, verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [e.name, e.email, e.phone, e.experience, e.message, e.source, verified ? 1 : 0],
  );
  return Number(result.meta.last_row_id);
}

// The auto-reply goes to whatever address was typed in, so it's capped whatever gets past Turnstile
// (docs/adr/0028-turnstile-and-auto-reply.md): a spammer can make the club email strangers a few times a day at most.
/** Takes back an enquiry that was never a person's: the deploy's smoke test, once it has run (lib/server/smoke.ts). */
export async function deleteEnquiry(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM enquiries WHERE id = ?").bind(id).run();
}

export const AUTO_REPLY_CAPS = { perDay: 20, perAddressDays: 7 };

/** Whether this address may get an auto-reply now: under the daily cap, and none to it in the last week. */
export async function autoReplyAllowed(db: D1Database, email: string, now = new Date()): Promise<boolean> {
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const row = await first<{ today: number; toAddress: number }>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM enquiries WHERE auto_replied_at >= ?) AS today,
       (SELECT COUNT(*) FROM enquiries WHERE email = ? AND auto_replied_at >= ?) AS toAddress`,
    [since(1), email, since(AUTO_REPLY_CAPS.perAddressDays)],
  );
  return !!row && row.today < AUTO_REPLY_CAPS.perDay && row.toAddress === 0;
}

export async function markAutoReplied(db: D1Database, id: number, now = new Date()): Promise<void> {
  await run(db, "UPDATE enquiries SET auto_replied_at = ? WHERE id = ?", [now.toISOString(), id]);
}

/** Months an enquiry is kept, unless the person joined: the privacy page promises it (pages/privacy.astro, ADR 0029). */
export const KEEP_ENQUIRIES_MONTHS = 12;

/** Delete enquiries sent more than 12 months ago, unless the person joined. Run daily by the cron (src/worker.ts). */
export async function expireEnquiries(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - KEEP_ENQUIRIES_MONTHS);
  const result = await run(db, "DELETE FROM enquiries WHERE status <> 'joined' AND created_at < ?", [
    cutoff.toISOString(),
  ]);
  return result.meta.changes;
}
