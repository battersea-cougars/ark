// Reminders of what someone owes (ADR 0007). Whoever records payments sends them from Unpaid fees (or a member's card),
// after a preview; nothing sends them on a schedule yet (a configurable one is #143). It's at most one a week per
// member, so a double tap or two admins at once send one, and each goes through `tell` (an email, and their phone if
// they have the store app). How firm the letter is follows the age of their oldest charge (Unpaid fees' buckets).
//
// A reminder is claimed first (a queued row in dues_reminders, in one statement that checks the week), then sent a few
// at a time: a Worker run makes at most 50 requests, and each email is one. What's left queued goes on the next run
// (the five-minute cron), so a send to the whole club is done within minutes.
import { all, batch, statement } from "@cougars/shared/d1";
import { bucketOf } from "../../src/lib/dues";
import { londonToday } from "@cougars/shared/london";
import { HttpError } from "../api/api.http";
import type { Env } from "../api/api.route";
import { bankFrom, type Bank, type SettingsRow } from "../settings/settings";
import { tell, type Message } from "../tell/tell";
import { reminderMail, reminderNotice, type Letter, type Owed } from "./reminders.letter";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("reminders");

/** The limits, in one place (ADR 0007). */
export const REMINDERS = {
  /** Never more than one a week to anyone. */
  weekDays: 7,
  /** Emails per run, well under a Worker's 50 requests: the cron run that sends them also drains the push outbox
   * (DRAIN_AT_ONCE) and may ask for a website rebuild (docs/load-testing.md has the sums). */
  perRun: 10,
} as const;

const DAY = 86_400_000;
const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY).toISOString();

/** Someone who owes, as the preview lists them. */
export interface Ower {
  memberId: number;
  name: string;
  /** They have an email address: without one there's nobody to send it to. */
  email: boolean;
  pence: number;
  charges: number;
  /** Their oldest charge's bucket: 0 up to 30 days, 1 31 to 60, 2 61 to 90, 3 over 90. */
  stage: 0 | 1 | 2 | 3;
  oldest: string;
  /** When they were last reminded (claimed), or null. */
  lastAt: string | null;
  /** Reminded in the last week: nothing goes to them now. */
  held: boolean;
}

/** What's still to pay on each charge, oldest first. */
const LEFT = `SELECT c.id, c.member_id, c.due_on, c.quarter, COALESCE(ts.name, t.name, c.reason) what,
    c.amount_pence - COALESCE((SELECT SUM(pa.amount_pence) FROM payment_allocations pa WHERE pa.charge_id = c.id), 0) "left"
  FROM charges c LEFT JOIN training_sessions s ON s.id = c.session_id
    LEFT JOIN training_series ts ON ts.id = s.series_id LEFT JOIN tournaments t ON t.id = c.tournament_id`;

const BANK = "SELECT bank_name, bank_sort_code, bank_account FROM club_settings WHERE id = 1";

/** Everyone active who owes (or the ones asked for), and the bank details: one round trip. */
function owersStatements(db: D1Database, memberIds: number[] | null) {
  return [
    statement(
      db,
      `SELECT m.id memberId, m.name, m.email IS NOT NULL email, SUM(o."left") pence, COUNT(*) charges,
         MIN(o.due_on) oldest, (SELECT MAX(r.claimed_at) FROM dues_reminders r WHERE r.member_id = m.id) lastAt
       FROM (${LEFT}) o JOIN members m ON m.id = o.member_id
       WHERE o."left" > 0 AND m.status = 'active'
         AND (? IS NULL OR m.id IN (SELECT value FROM json_each(?)))
       GROUP BY m.id LIMIT 500`,
      [memberIds ? 1 : null, JSON.stringify(memberIds ?? [])],
    ),
    statement(db, BANK),
  ];
}

async function owers(db: D1Database, now: Date, memberIds: number[] | null = null) {
  const [rows, bank] = (await batch(db, owersStatements(db, memberIds))) as [
    D1Result<Omit<Ower, "stage" | "held" | "email"> & { email: number }>,
    D1Result<SettingsRow>,
  ];
  const today = londonToday(now);
  const week = ago(now, REMINDERS.weekDays);
  const people: Ower[] = rows.results
    .map((r) => ({
      ...r,
      email: Boolean(r.email),
      stage: bucketOf(r.oldest, today),
      held: r.lastAt !== null && r.lastAt > week,
    }))
    .sort((a, b) => b.stage - a.stage || b.pence - a.pence || a.name.localeCompare(b.name));
  return { people, bank: bankFrom(bank.results[0]) };
}

/**
 * Claim reminders: one queued row per member, unless they've had one in the last week. One statement, so two sends at
 * once (a double tap, two admins) claim each member once. Returns who was claimed.
 */
async function claim(db: D1Database, memberIds: number[], by: number, now: Date): Promise<number[]> {
  if (!memberIds.length) return [];
  const rows = await all<{ member_id: number }>(
    db,
    `INSERT INTO dues_reminders (member_id, stage, sent_by, claimed_at)
     SELECT j.value, 'by_hand', ?, ? FROM json_each(?) j
     WHERE NOT EXISTS (SELECT 1 FROM dues_reminders r WHERE r.member_id = j.value AND r.claimed_at > ?)
     RETURNING member_id`,
    [by, now.toISOString(), JSON.stringify(memberIds), ago(now, REMINDERS.weekDays)],
  );
  return rows.map((r) => r.member_id);
}

// ─── An admin's ───

/** The preview: who'd get one, and what one says (the member asked for, or the first). Without bank details, not ready. */
export async function previewReminders(db: D1Database, now: Date, memberId: number | null) {
  const { people, bank } = await owers(db, now);
  const who = memberId ?? people[0]?.memberId ?? null;
  // Shown even for someone with no email address, so the admin sees what it would say
  const letter = bank && who !== null ? (await letters(db, [who], bank, now, true)).get(who) : undefined;
  return {
    ready: bank !== null,
    bank,
    people,
    letter: letter ? { memberId: who, subject: letter.mail.subject, text: letter.mail.text } : null,
  };
}

/** { memberIds? }: queue a reminder for each who owes (everyone, if none are named) and hasn't had one this week. */
export async function sendReminders(env: Env, o: Record<string, unknown>, by: number, now: Date) {
  const asked = o.memberIds;
  if (
    asked !== undefined &&
    (!Array.isArray(asked) || asked.length > 500 || !asked.every((id) => Number.isInteger(id) && id > 0))
  )
    throw new HttpError(400, "memberIds should be a list of members.");
  const { people, bank } = await owers(env.DB, now, (asked as number[] | undefined) ?? null);
  if (!bank) throw new HttpError(409, "Fill in the club's bank details first: the email says where to pay.");
  const reachable = people.filter((p) => p.email);
  const memberIds = reachable.map((p) => p.memberId);
  const claimed = await claim(env.DB, memberIds, by, now);
  return {
    memberIds: claimed,
    queued: claimed.length,
    held: reachable.length - claimed.length,
    noEmail: people.length - reachable.length,
  };
}

// ─── Sending what's queued (the admin's send, then the five-minute cron) ───

interface Queued {
  id: number;
  memberId: number;
  name: string;
  webName: string | null;
  email: string | null;
  status: string;
  reference: string | null;
  charges: string;
}

/** Each member's letter, read in one statement: their unpaid charges, reference and name. */
async function letters(db: D1Database, memberIds: number[], bank: Bank, now: Date, preview = false) {
  const rows = await all<Omit<Queued, "id" | "memberId"> & { memberId: number }>(
    db,
    `SELECT m.id memberId, m.name, m.web_name webName, m.email, m.status, m.payment_reference reference,
       (SELECT json_group_array(json_object('what', o.what, 'quarter', o.quarter, 'dueOn', o.due_on, 'left', o."left"))
          FROM (${LEFT} WHERE c.member_id = m.id) o WHERE o."left" > 0) charges
     FROM members m WHERE m.id IN (SELECT value FROM json_each(?))`,
    [JSON.stringify(memberIds)],
  );
  return lettersFrom(rows, bank, now, preview);
}

function lettersFrom(rows: Omit<Queued, "id">[], bank: Bank, now: Date, preview = false) {
  const today = londonToday(now);
  const out = new Map<number, Message & { pence: number }>();
  for (const r of rows) {
    const charges = (JSON.parse(r.charges) as Owed[]).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    if (!charges.length || (!r.email && !preview) || r.status !== "active") continue;
    const letter: Letter = {
      firstName: (r.webName?.trim() || r.name).split(/\s+/)[0],
      reference: r.reference ?? "COUGARS",
      charges,
      bank,
      stage: bucketOf(charges[0].dueOn, today),
    };
    out.set(r.memberId, {
      memberId: r.memberId,
      mail: reminderMail(r.email ?? "", letter),
      notice: reminderNotice(letter),
      pence: charges.reduce((s, c) => s + c.left, 0),
    });
  }
  return out;
}

/** A run that took reminders to send and hasn't said what became of them after this long died: they're taken again. */
const SENDING_EXPIRES_MS = 10 * 60_000;

/**
 * Send what's queued, oldest first, a few at a time (REMINDERS.perRun): the email and the phone, through `tell`. One
 * round trip takes them (so another run at once, an admin's Send beside the cron, takes others or none) and reads
 * each letter; then one batch marks them: sent, or gone (they've paid since, have no email, or the send failed, so
 * it's tried again another time). Without bank details nothing goes, and it waits.
 */
export async function sendQueued(env: Env, now: Date, limit: number = REMINDERS.perRun) {
  const run = crypto.randomUUID();
  const [, queued, bankRows] = (await batch(env.DB, [
    statement(
      env.DB,
      `UPDATE dues_reminders SET sending = ?, sending_at = ?
       WHERE id IN (SELECT id FROM dues_reminders WHERE status = 'queued' AND (sending_at IS NULL OR sending_at < ?)
                    ORDER BY id LIMIT ?)`,
      [run, now.toISOString(), new Date(now.getTime() - SENDING_EXPIRES_MS).toISOString(), limit],
    ),
    statement(
      env.DB,
      `SELECT r.id, m.id memberId, m.name, m.web_name webName, m.email, m.status, m.payment_reference reference,
         (SELECT json_group_array(json_object('what', o.what, 'quarter', o.quarter, 'dueOn', o.due_on, 'left', o."left"))
            FROM (${LEFT} WHERE c.member_id = m.id) o WHERE o."left" > 0) charges
       FROM (SELECT id, member_id FROM dues_reminders WHERE sending = ? AND status = 'queued' ORDER BY id) r
         JOIN members m ON m.id = r.member_id`,
      [run],
    ),
    statement(env.DB, BANK),
  ])) as [D1Result, D1Result<Queued>, D1Result<SettingsRow>];
  if (!queued.results.length) return 0;
  const bank = bankFrom(bankRows.results[0]);
  if (!bank) return 0;
  const letters = lettersFrom(queued.results, bank, now);
  const told = await tell(env, [...letters.values()], now);
  const sent = queued.results
    .filter((r) => told.has(r.memberId))
    .map((r) => ({ id: r.id, pence: letters.get(r.memberId)!.pence }));
  const dropped = queued.results.filter((r) => !told.has(r.memberId)).map((r) => r.id);
  await batch(env.DB, [
    statement(
      env.DB,
      `UPDATE dues_reminders AS r SET status = 'sent', sent_at = ?, pence = j.value ->> 'pence'
       FROM json_each(?) j WHERE r.id = j.value ->> 'id' AND r.sending = ?`,
      [now.toISOString(), JSON.stringify(sent), run],
    ),
    statement(env.DB, "DELETE FROM dues_reminders WHERE id IN (SELECT value FROM json_each(?)) AND sending = ?", [
      JSON.stringify(dropped),
      run,
    ]),
  ]);
  if (dropped.length) log.info("reminders.dropped", { count: dropped.length });
  return sent.length;
}
