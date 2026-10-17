import { first, run } from "@cougars/shared/d1";

export const EXPERIENCE = {
  never: "Never played",
  some: "Skated / played a bit",
  regular: "Play regularly",
} as const;
export type Experience = keyof typeof EXPERIENCE;

export interface Enquiry {
  name: string;
  email: string;
  phone: string | null;
  experience: Experience | null;
  message: string | null;
  source: string | null;
}

export type ParseResult = { ok: true; enquiry: Enquiry } | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A phone number as people write one: digits with spaces, dashes, dots or brackets, maybe a leading +; 7–15 digits. */
export function isPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "").length;
  return /^\+?[\d\s().-]+$/.test(value) && digits >= 7 && digits <= 15;
}

function text(form: FormData, key: string, max: number): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseEnquiry(form: FormData): ParseResult {
  const name = text(form, "name", 100);
  const email = text(form, "email", 200).toLowerCase();
  const phone = text(form, "phone", 40);
  const experience = text(form, "experience", 20);
  const message = text(form, "message", 2000);
  const source = text(form, "source", 200);

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Please tell us your name.";
  if (!EMAIL_RE.test(email)) errors.email = "Please enter a valid email address.";
  if (phone && !isPhone(phone)) errors.phone = "Please enter a phone number, or leave it empty.";
  if (experience && !(experience in EXPERIENCE)) errors.experience = "Please pick an option.";
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    enquiry: {
      name,
      email,
      phone: phone || null,
      experience: (experience as Experience) || null,
      message: message || null,
      source: source || null,
    },
  };
}

/** Bots fill every field; humans never see the hidden `website` field. */
export function isSpam(form: FormData): boolean {
  return Boolean(text(form, "website", 200));
}

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
