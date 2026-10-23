// Dues (ADR 0007): fees, charges and payments. A charge is one person for one session, tournament or quarter. Session
// and tournament charges follow who came, so they're worked out again after anything that changes it (a tick on the
// register, a sign-up, a cancellation) and each hour, when a new day makes another session due: whoever came and isn't
// charged is, and an unpaid charge for someone who no longer counts goes. A paid one always stays. Quarterly Members
// are charged the quarterly rate for each quarter a subscription covers; an admin can charge a quarter by hand.
import { all, batch, changesOf, first, run, statement, type Param } from "@cougars/shared/d1";
import { can, type Action } from "../../src/access/actions";
import { QUARTER, feeOn, nextQuarter, quarterOf, quarterStart, type DatedFee } from "../../src/lib/dues";
import { londonToday } from "../../src/lib/dates";
import { HttpError, isDay } from "../api/api.http";
import { bumpDataVersion } from "../api/api.version";

// ─── Quarters ───

export { QUARTER, nextQuarter, quarterOf, quarterStart } from "../../src/lib/dues";

// ─── Who owes what ───

/** Whether a member's subscription covers a day (`day` is SQL for it): they're a Quarterly Member then. */
const subscribed = (member: string, day: string) =>
  `EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.member_id = ${member} AND sub.starts_on <= ${day}
     AND (sub.ends_on IS NULL OR sub.ends_on >= ${day}))`;
/**
 * Whether a member is charged for the quarter a day is in (by their membership or by hand): that pays for every
 * training night in it, before they joined too, so those nights cost nothing.
 */
const quarterCharged = (member: string, day: string) =>
  `EXISTS (SELECT 1 FROM charges q WHERE q.member_id = ${member}
     AND q.quarter = substr(${day}, 1, 4) || '-Q' || ((CAST(substr(${day}, 6, 2) AS INTEGER) + 2) / 3))`;
const unpaid = "NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.charge_id = c.id)";
/** Not paid in full: a charge that no longer counts can go, and what part of it was paid is credit again. */
const notPaidUp =
  "c.amount_pence > COALESCE((SELECT SUM(pa.amount_pence) FROM payment_allocations pa WHERE pa.charge_id = c.id), 0)";

/** Keepers play training free (the Keeper plan, ADR 0007): no session or quarter charges */
export const KEEPER = (member: string) => `(SELECT position FROM members WHERE id = ${member}) = 'G'`;

/**
 * Who should be charged for a session: everyone in who wasn't a no-show (walk-ins too), but keepers, Quarterly
 * Members and anyone charged for that quarter.
 */
const SESSIONS_DUE = `
  SELECT a.member_id, s.id event_id, s.fee_pence amount, s.held_on due_on
  FROM attendance a JOIN training_sessions s ON s.id = a.session_id
  WHERE s.held_on <= ? AND s.cancelled_at IS NULL AND s.fee_pence > 0
    AND a.signup = 'in' AND COALESCE(a.attended, 1) = 1 AND NOT ${KEEPER("a.member_id")}
    AND NOT ${subscribed("a.member_id", "s.held_on")}
    AND NOT ${quarterCharged("a.member_id", "s.held_on")}`;
/** Who should be charged for a tournament: everyone in, Quarterly Members too. */
const TOURNAMENTS_DUE = `
  SELECT e.member_id, t.id event_id, t.fee_pence amount, t.held_on due_on
  FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id
  WHERE t.held_on <= ? AND t.fee_pence > 0 AND e.signup = 'in'`;

/** A training's fee on a session's day. */
const SERIES_FEE = `(SELECT f.amount_pence FROM series_fees f WHERE f.series_id = s.series_id
  AND f.effective_from <= s.held_on ORDER BY f.effective_from DESC LIMIT 1)`;

/**
 * Statements that bring session and tournament charges in line with who came and what each costs, as of today. A
 * session costs its training's fee on its day: change a fee from an earlier date and every night it covers is
 * recalculated, paid or not (a night paid then owes the difference, or its overpayment is credit).
 */
function attendanceCharges(db: D1Database, today: string, now: string): D1PreparedStatement[] {
  const statements = [
    statement(
      db,
      `UPDATE training_sessions AS s SET fee_pence = COALESCE(${SERIES_FEE}, 0)
       WHERE s.held_on <= ? AND s.fee_pence IS NOT COALESCE(${SERIES_FEE}, 0)`,
      [today],
    ),
  ];
  for (const [column, due] of [
    ["session_id", SESSIONS_DUE],
    ["tournament_id", TOURNAMENTS_DUE],
  ])
    statements.push(
      statement(
        db,
        `INSERT INTO charges (member_id, ${column}, amount_pence, due_on, created_at)
         SELECT member_id, event_id, amount, due_on, ? FROM (${due}) WHERE true ON CONFLICT DO NOTHING`,
        [now, today],
      ),
      statement(
        db,
        `DELETE FROM charges AS c WHERE c.${column} IS NOT NULL AND ${notPaidUp}
           AND (c.member_id, c.${column}) NOT IN (SELECT member_id, event_id FROM (${due}))`,
        [today],
      ),
    );
  // What each costs now: a night their quarter pays for, nothing (so what they'd paid for it is credit)
  for (const [column, fee] of [
    [
      "session_id",
      `SELECT CASE WHEN ${quarterCharged("c.member_id", "s.held_on")} THEN 0 ELSE s.fee_pence END
       FROM training_sessions s WHERE s.id = c.session_id`,
    ],
    ["tournament_id", "SELECT fee_pence FROM tournaments WHERE id = c.tournament_id"],
  ])
    statements.push(
      statement(
        db,
        `UPDATE charges AS c SET amount_pence = COALESCE((${fee}), 0)
         WHERE c.${column} IS NOT NULL AND c.amount_pence IS NOT COALESCE((${fee}), 0)`,
      ),
    );
  return statements;
}

/** Session and tournament charges in line with who came (attendanceCharges). Returns how many changed. */
export async function chargeAttendance(db: D1Database, today: string, now: string): Promise<number> {
  return settleAfter(db, attendanceCharges(db, today, now));
}

/**
 * Statements that charge Quarterly Members (not keepers: they play free) the quarterly rate for every quarter, up to
 * this one, that a subscription covers: due on the quarter's first day, or the day they joined. Only where the rate in
 * force then isn't nothing, so setting the first rate decides how far back it goes. A quarter charged by mistake (the
 * subscription taken back) goes, unpaid. The quarters go as one list (JSON), so it's three statements however many
 * members and quarters there are.
 */
async function quarterCharges(db: D1Database, today: string, now: string): Promise<D1PreparedStatement[]> {
  const [fees, subs] = (await batch(db, [
    statement(db, "SELECT amount_pence pence, effective_from 'from' FROM subscription_fees ORDER BY effective_from"),
    statement(
      db,
      `SELECT sub.member_id, sub.starts_on, sub.ends_on FROM subscriptions sub
       WHERE sub.starts_on <= ? AND NOT ${KEEPER("sub.member_id")}`,
      [today],
    ),
  ])) as [D1Result<DatedFee>, D1Result<{ member_id: number; starts_on: string; ends_on: string | null }>];
  const due = new Map<string, { member: number; quarter: string; dueOn: string; pence: number }>();
  for (const s of subs.results) {
    const last = s.ends_on && s.ends_on < today ? s.ends_on : today;
    for (let q = quarterOf(s.starts_on); quarterStart(q) <= last; q = nextQuarter(q)) {
      const dueOn = s.starts_on > quarterStart(q) ? s.starts_on : quarterStart(q);
      const key = `${s.member_id} ${q}`;
      const pence = feeOn(fees.results, dueOn);
      const was = due.get(key);
      if (pence > 0 && (!was || dueOn < was.dueOn)) due.set(key, { member: s.member_id, quarter: q, dueOn, pence });
    }
  }
  const list = JSON.stringify([...due.values()]);
  const listed =
    "SELECT value ->> 'member' member, value ->> 'quarter' quarter, value ->> 'pence' pence FROM json_each(?)";
  return [
    statement(
      db,
      `INSERT INTO charges (member_id, quarter, amount_pence, due_on, created_at)
       SELECT value ->> 'member', value ->> 'quarter', value ->> 'pence', value ->> 'dueOn', ? FROM json_each(?)
       WHERE true ON CONFLICT DO NOTHING`,
      [now, list],
    ),
    statement(
      db,
      `DELETE FROM charges AS c WHERE c.quarter IS NOT NULL AND c.created_by IS NULL AND ${unpaid}
         AND (c.member_id, c.quarter) NOT IN (SELECT member, quarter FROM (${listed}))`,
      [list],
    ),
    // The rate for each, as it is now: a rate changed from an earlier date recalculates the quarters it covers. One
    // charged by hand keeps what the admin said.
    statement(
      db,
      `UPDATE charges AS c SET amount_pence = d.pence FROM (${listed}) d
       WHERE c.member_id = d.member AND c.quarter = d.quarter AND c.created_by IS NULL AND c.amount_pence <> d.pence`,
      [list],
    ),
  ];
}

/**
 * Every charge in line, as after anything that changes who owes what: quarters first, since a quarter pays for its
 * training nights. A few round trips, however many members, quarters and nights (ADR 0059). Returns how many changed.
 */
export async function recharge(db: D1Database, today: string, now: string): Promise<number> {
  return settleAfter(db, [...(await quarterCharges(db, today, now)), ...attendanceCharges(db, today, now)]);
}

/** Each part of a payment on a charge that's paid more than it now costs, newest payment first. */
const OVERPAID = `
  SELECT pa.charge_id chargeId, pa.payment_id paymentId, pa.amount_pence pence, o.over
  FROM payment_allocations pa
  JOIN (SELECT c.id, (SELECT SUM(a.amount_pence) FROM payment_allocations a WHERE a.charge_id = c.id) - c.amount_pence
          over FROM charges c WHERE over > 0) o ON o.id = pa.charge_id
  ORDER BY pa.charge_id, pa.payment_id DESC`;

/**
 * Changes to charges, then: a charge paid more than it now costs gives the difference back (the newest payment's part
 * first), so it's credit; a charge that now costs nothing goes; then credit pays what's owed. Three round trips.
 * Returns how many rows changed.
 */
async function settleAfter(db: D1Database, changes: D1PreparedStatement[]): Promise<number> {
  const done = await batch<{ chargeId: number; paymentId: number; pence: number; over: number }>(db, [
    ...changes,
    statement(db, OVERPAID),
  ]);
  const backs: { charge: number; payment: number; back: number }[] = [];
  const left = new Map<number, number>();
  for (const a of done.at(-1)!.results) {
    const over = left.get(a.chargeId) ?? a.over;
    const back = Math.min(over, a.pence);
    left.set(a.chargeId, over - back);
    if (back) backs.push({ charge: a.chargeId, payment: a.paymentId, back });
  }
  const [taken, emptied, gone, ...reads] = await batch(db, [
    statement(
      db,
      `UPDATE payment_allocations AS pa SET amount_pence = pa.amount_pence - b.back
       FROM (SELECT value ->> 'charge' charge, value ->> 'payment' payment, value ->> 'back' back FROM json_each(?)) b
       WHERE pa.charge_id = b.charge AND pa.payment_id = b.payment`,
      [JSON.stringify(backs)],
    ),
    statement(db, "DELETE FROM payment_allocations WHERE amount_pence <= 0"),
    statement(
      db,
      "DELETE FROM charges WHERE amount_pence <= 0 AND id NOT IN (SELECT charge_id FROM payment_allocations)",
    ),
    ...credit(db),
  ]);
  return (
    changesOf(done.slice(0, -1)) +
    changesOf([taken, emptied, gone]) +
    (await spend(db, reads as [D1Result<Spare>, D1Result<Owed>]))
  );
}

/** The hourly check (and the day's first open of the app): whatever a new day makes due. */
export async function chargeDue(env: { DB: D1Database }, now: Date) {
  const today = londonToday(now);
  const changed = await recharge(env.DB, today, now.toISOString());
  // Someone's dues changed: every member's bootstrap is out of date (ADR 0053)
  if (changed) await bumpDataVersion(env.DB);
}

// ─── Fees ───

function datedFees(v: unknown): DatedFee[] {
  if (!Array.isArray(v) || v.length > 100) throw new HttpError(400, "fees should be a list.");
  const fees = v.map((f: { pence?: unknown; from?: unknown }) => {
    if (!Number.isInteger(f?.pence) || (f.pence as number) < 0 || (f.pence as number) > 100_000)
      throw new HttpError(400, "A fee should be a whole number of pence.");
    if (!isDay(f.from)) throw new HttpError(400, "A fee needs a date it's from.");
    return { pence: f.pence as number, from: f.from };
  });
  if (new Set(fees.map((f) => f.from)).size !== fees.length) throw new HttpError(400, "One fee per date.");
  return fees.sort((a, b) => a.from.localeCompare(b.from));
}

/** A training's fees, oldest first. */
export const seriesFees = (db: D1Database, id: number) =>
  all<DatedFee>(
    db,
    "SELECT amount_pence pence, effective_from 'from' FROM series_fees WHERE series_id = ? ORDER BY effective_from",
    [id],
  );

/** A training in SQL: `?` and its id, or a subquery for one not made yet (by its slug), so its fees can go in the batch
 * that makes it. Null when the batch's write of it was refused (ADR 0122): its fees go nowhere. */
export interface SeriesRef {
  sql: string;
  params: Param[];
}

/**
 * A training's fees, as its editor sends them: the whole list, each from a date. Only for whoever sets fees; anyone
 * else's save of the training leaves them as they are, and may not change them. Checked now, written later: the
 * statements that write them (none if they're left out or as they were) go in the batch that saves the training, so a
 * save refused for any field changes no fee, and a fee refused makes no training (#131). `id` null: a new training.
 */
export async function seriesFeeChange(
  db: D1Database,
  id: number | null,
  given: unknown,
  actions: ReadonlySet<Action>,
): Promise<(series: SeriesRef) => D1PreparedStatement[]> {
  const none = () => [];
  if (given === undefined) return none;
  const fees = datedFees(given);
  if (JSON.stringify(fees) === JSON.stringify(id === null ? [] : await seriesFees(db, id))) return none;
  if (!can(actions, "manage:Fees")) throw new HttpError(403, "Your role can't set fees.");
  return (series) => [
    statement(db, `DELETE FROM series_fees WHERE series_id = ${series.sql}`, series.params),
    statement(
      db,
      `INSERT INTO series_fees (series_id, effective_from, amount_pence)
       SELECT ${series.sql}, value ->> 'from', value ->> 'pence' FROM json_each(?) WHERE ${series.sql} IS NOT NULL`,
      [...series.params, JSON.stringify(fees), ...series.params],
    ),
  ];
}

/** The quarterly rate's history, oldest first. */
export const subscriptionFees = (db: D1Database) =>
  all<DatedFee>(db, "SELECT amount_pence pence, effective_from 'from' FROM subscription_fees ORDER BY effective_from");

/** A new quarterly rate from a date (one already from that date is replaced). */
export async function setSubscriptionFee(db: D1Database, o: Record<string, unknown>) {
  const [fee] = datedFees([o]);
  await run(
    db,
    `INSERT INTO subscription_fees (effective_from, amount_pence) VALUES (?, ?)
     ON CONFLICT (effective_from) DO UPDATE SET amount_pence = excluded.amount_pence`,
    [fee.from, fee.pence],
  );
}

// ─── Charges by hand, and payments ───

export async function memberExists(db: D1Database, id: number) {
  if (!(await first(db, "SELECT 1 FROM members WHERE id = ?", [id]))) throw new HttpError(404, "No such member.");
}

/** { quarter: "2026-Q3", pence? }: a member owes for a quarter, at the rate on its first day unless told. */
export async function addQuarterCharge(
  db: D1Database,
  memberId: number,
  o: Record<string, unknown>,
  by: number,
  now: string,
) {
  await memberExists(db, memberId);
  if (typeof o.quarter !== "string" || !QUARTER.test(o.quarter))
    throw new HttpError(400, "quarter should be like 2026-Q3.");
  const dueOn = quarterStart(o.quarter);
  const pence = o.pence == null ? feeOn(await subscriptionFees(db), dueOn) : o.pence;
  if (!Number.isInteger(pence) || (pence as number) <= 0 || (pence as number) > 100_000)
    throw new HttpError(400, "How much? There's no quarterly membership price set for then.");
  if (await first(db, "SELECT 1 FROM charges WHERE member_id = ? AND quarter = ?", [memberId, o.quarter]))
    throw new HttpError(409, "They're already charged for that quarter.");
  // Two admins at once both pass the check above: the index lets one in and the other is told it's there
  const added = await first<{ id: number }>(
    db,
    `INSERT INTO charges (member_id, quarter, amount_pence, due_on, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (quarter, member_id) WHERE quarter IS NOT NULL DO NOTHING RETURNING id`,
    [memberId, o.quarter, pence as number, dueOn, now, by],
  );
  if (!added) throw new HttpError(409, "They're already charged for that quarter.");
  // Its training nights are paid for now
  await chargeAttendance(db, londonToday(new Date(now)), now);
  return { id: added.id };
}

/**
 * Take back a quarter charged by hand by mistake. Every other charge follows something: who came, or a quarterly
 * membership, so that's what to change.
 */
export async function removeCharge(db: D1Database, id: number, now: string) {
  const c = await first<{ byHand: number; paid: number }>(
    db,
    `SELECT c.created_by IS NOT NULL byHand, NOT ${unpaid} paid FROM charges c WHERE c.id = ?`,
    [id],
  );
  if (!c) throw new HttpError(404, "No such charge.");
  if (!c.byHand) throw new HttpError(409, "It follows who came, or their quarterly membership: change that instead.");
  // A quarter or an adjustment, added by hand
  if (c.paid) throw new HttpError(409, "It's paid: mark it unpaid first.");
  await run(db, "DELETE FROM charges WHERE id = ?", [id]);
  // Its training nights are owed again
  await chargeAttendance(db, londonToday(new Date(now)), now);
}

const via = (o: Record<string, unknown>) => {
  if (o.via !== "transfer" && o.via !== "cash") throw new HttpError(400, "via should be transfer or cash.");
  return o.via;
};

interface Spare {
  id: number;
  member_id: number;
  spare: number;
}
interface Owed {
  id: number;
  member_id: number;
  left: number;
}

/** Reads for `spend`: each payment's unspent part, oldest first, and what's left to pay on its member's charges. */
function credit(db: D1Database, memberId?: number): D1PreparedStatement[] {
  const who = memberId === undefined ? "" : "AND p.member_id = ?";
  const params = memberId === undefined ? [] : [memberId];
  const spare = `SELECT p.id, p.member_id, p.amount_pence - COALESCE((SELECT SUM(pa.amount_pence)
       FROM payment_allocations pa WHERE pa.payment_id = p.id), 0) spare
     FROM payments p WHERE spare > 0 ${who}`;
  return [
    statement(db, `${spare} ORDER BY p.received_on, p.id`, params),
    statement(
      db,
      `SELECT c.id, c.member_id, c.amount_pence - COALESCE((SELECT SUM(pa.amount_pence) FROM payment_allocations pa
         WHERE pa.charge_id = c.id), 0) "left"
       FROM charges c WHERE "left" > 0 AND c.member_id IN (SELECT member_id FROM (${spare}))
       ORDER BY c.due_on, c.id`,
      params,
    ),
  ];
}

/**
 * Money not yet spent pays what's owed, oldest first (FIFO): each payment's unspent part, oldest payment first, goes
 * to the member's oldest charges not paid in full. A lump sum pays several charges and part of the next; what's left
 * over is credit, and pays the next charge as it comes. One round trip, none if there's nothing to pay. Returns how
 * many allocations it made.
 *
 * Two of these at once (every change that touches who came works the charges out, and so does the cron) read the same
 * credit: each allocation goes in only while its payment and its charge are still as they were read, so the second
 * spends nothing, and what's left is paid next time.
 */
async function spend(db: D1Database, [spare, owed]: [D1Result<Spare>, D1Result<Owed>]): Promise<number> {
  const byMember = new Map<number, (Owed & { was: number })[]>();
  for (const c of owed.results)
    byMember.set(c.member_id, [...(byMember.get(c.member_id) ?? []), { ...c, was: c.left }]);
  const made: { payment: number; charge: number; amount: number; spare: number; left: number }[] = [];
  for (const p of spare.results) {
    let left = p.spare;
    for (const c of byMember.get(p.member_id) ?? []) {
      if (!left) break;
      const amount = Math.min(left, c.left);
      if (!amount) continue;
      made.push({ payment: p.id, charge: c.id, amount, spare: p.spare, left: c.was });
      c.left -= amount;
      left -= amount;
    }
  }
  if (!made.length) return 0;
  const res = await run(
    db,
    `INSERT INTO payment_allocations (payment_id, charge_id, amount_pence)
     SELECT j.value ->> 'payment', j.value ->> 'charge', j.value ->> 'amount' FROM json_each(?) j
     WHERE (SELECT p.amount_pence - COALESCE((SELECT SUM(pa.amount_pence) FROM payment_allocations pa
              WHERE pa.payment_id = p.id), 0) FROM payments p WHERE p.id = j.value ->> 'payment') = j.value ->> 'spare'
       AND (SELECT c.amount_pence - COALESCE((SELECT SUM(pa.amount_pence) FROM payment_allocations pa
              WHERE pa.charge_id = c.id), 0) FROM charges c WHERE c.id = j.value ->> 'charge') = j.value ->> 'left'
     ON CONFLICT (payment_id, charge_id) DO UPDATE SET amount_pence = amount_pence + excluded.amount_pence`,
    [JSON.stringify(made)],
  );
  return res.meta.changes ?? 0;
}

/** Credit pays what's owed (spend), for one member or everyone. Two round trips. */
export async function settle(db: D1Database, memberId?: number): Promise<number> {
  return spend(db, (await batch(db, credit(db, memberId))) as [D1Result<Spare>, D1Result<Owed>]);
}

/** { pence, via }: money in, by transfer or cash, paying what they owe oldest first; the rest is credit. */
/** A day given, or today: never in the future. */
function pastDay(v: unknown, now: string, field: string, future: string): string {
  const today = londonToday(new Date(now));
  const day = v == null || v === "" ? today : v;
  if (!isDay(day)) throw new HttpError(400, `${field} should be a day, like 2026-10-02.`);
  if (day > today) throw new HttpError(400, future);
  return day;
}

/**
 * { pence, reason, on? }: an admin adjusts what someone owes, saying why (ADR 0007). More (pence above nothing) is a
 * charge; less is like money in, paying what they owe oldest first. Either is a line on their ledger.
 */
export async function addAdjustment(
  db: D1Database,
  memberId: number,
  o: Record<string, unknown>,
  by: number,
  now: string,
) {
  const reason = typeof o.reason === "string" ? o.reason.trim().replace(/\s+/g, " ") : "";
  if (!reason) throw new HttpError(400, "Say why: it's on their ledger.");
  if (reason.length > 120) throw new HttpError(400, "Keep the reason short: 120 characters.");
  const pence = o.pence;
  if (!Number.isInteger(pence) || pence === 0 || Math.abs(pence as number) > 1_000_000)
    throw new HttpError(400, "How much, in pence? More than nothing.");
  const on = pastDay(o.on, now, "on", "An adjustment can't be from the future.");
  await memberExists(db, memberId);
  const res =
    (pence as number) > 0
      ? await run(
          db,
          `INSERT INTO charges (member_id, reason, amount_pence, due_on, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
          [memberId, reason, pence as number, on, now, by],
        )
      : await run(
          db,
          `INSERT INTO payments (member_id, amount_pence, received_on, via, reason, recorded_by, created_at)
           VALUES (?, ?, ?, 'adjustment', ?, ?, ?)`,
          [memberId, -(pence as number), on, reason, by, now],
        );
  await settle(db, memberId);
  return { id: Number(res.meta.last_row_id), pence: pence as number, reason, on };
}

export async function recordPayment(
  db: D1Database,
  memberId: number,
  o: Record<string, unknown>,
  by: number,
  now: string,
) {
  const how = via(o);
  if (!Number.isInteger(o.pence) || (o.pence as number) <= 0 || (o.pence as number) > 1_000_000)
    throw new HttpError(400, "How much, in pence?");
  // The day it came in: today unless they say, never in the future
  const receivedOn = pastDay(o.receivedOn, now, "receivedOn", "A payment can't be from the future.");
  await memberExists(db, memberId);
  await run(
    db,
    `INSERT INTO payments (member_id, amount_pence, received_on, via, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [memberId, o.pence as number, receivedOn, how, by, now],
  );
  await settle(db, memberId);
}

/**
 * One payment, received today, for what's left of each of these charges. The payment goes in only while every charge
 * still has just that left, and its allocations only with it: one batch, the check inside it (ADR 0121), so a double
 * tap, or two admins at once, record it once (#119). The second finds it paid and writes nothing.
 */
async function pay(
  db: D1Database,
  memberId: number,
  charges: { id: number; left: number }[],
  how: string,
  by: number,
  now: string,
) {
  const total = charges.reduce((s, c) => s + c.left, 0);
  if (!charges.length) return;
  const list = JSON.stringify(charges.map(({ id, left }) => ({ id, left })));
  await batch(db, [
    statement(
      db,
      `INSERT INTO payments (member_id, amount_pence, received_on, via, recorded_by, created_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM json_each(?) j JOIN charges c ON c.id = j.value ->> 'id'
         WHERE c.amount_pence - COALESCE((SELECT SUM(pa.amount_pence) FROM payment_allocations pa
                 WHERE pa.charge_id = c.id), 0) <> j.value ->> 'left')
         AND (SELECT COUNT(*) FROM charges WHERE id IN (SELECT value ->> 'id' FROM json_each(?))) = ?`,
      [memberId, total, londonToday(new Date(now)), how, by, now, list, list, charges.length],
    ),
    // Only if the payment just went in (changes() is the statement before's, in this batch)
    statement(
      db,
      `INSERT INTO payment_allocations (payment_id, charge_id, amount_pence)
       SELECT last_insert_rowid(), value ->> 'id', value ->> 'left' FROM json_each(?) WHERE changes() = 1`,
      [list],
    ),
  ]);
}

/** What's left to pay on each of a member's charges (or one charge), where anything is. */
const owing = (db: D1Database, where: string, param: number) =>
  all<{ id: number; member_id: number; left: number }>(
    db,
    `SELECT c.id, c.member_id, c.amount_pence - COALESCE((SELECT SUM(pa.amount_pence) FROM payment_allocations pa
       WHERE pa.charge_id = c.id), 0) "left"
     FROM charges c WHERE ${where} = ? AND "left" > 0 ORDER BY c.due_on, c.id`,
    [param],
  );

/** { via }: a charge is paid, by transfer or in cash. */
export async function payCharge(db: D1Database, id: number, o: Record<string, unknown>, by: number, now: string) {
  const how = via(o);
  if (!(await first(db, "SELECT 1 FROM charges WHERE id = ?", [id]))) throw new HttpError(404, "No such charge.");
  const left = await owing(db, "c.id", id);
  if (left.length) await pay(db, left[0].member_id, left, how, by, now);
}

/**
 * A payment recorded by mistake, taken back from the ledger: what it paid is owed again, and any credit they still have
 * pays it, oldest first.
 */
export async function removePayment(db: D1Database, id: number) {
  const p = await first<{ member_id: number }>(db, "SELECT member_id FROM payments WHERE id = ?", [id]);
  if (!p) throw new HttpError(404, "No such payment.");
  const [, , ...reads] = await batch(db, [
    statement(db, "DELETE FROM payment_allocations WHERE payment_id = ?", [id]),
    statement(db, "DELETE FROM payments WHERE id = ?", [id]),
    ...credit(db, p.member_id),
  ]);
  await spend(db, reads as [D1Result<Spare>, D1Result<Owed>]);
  return p.member_id;
}

/**
 * A mistake: the charge isn't paid after all. Every payment that paid towards it is taken back whole (a lump sum
 * with everything else it paid for); any credit they still have then pays what's owed again, oldest first.
 */
export async function unpayCharge(db: D1Database, id: number) {
  const c = await first<{ member_id: number }>(db, "SELECT member_id FROM charges WHERE id = ?", [id]);
  if (!c) throw new HttpError(404, "No such charge.");
  const taken = "SELECT payment_id FROM payment_allocations WHERE charge_id = ?";
  const [, , ...reads] = await batch(db, [
    statement(db, `DELETE FROM payments WHERE id IN (${taken})`, [id]),
    statement(db, `DELETE FROM payment_allocations WHERE payment_id NOT IN (SELECT id FROM payments)`),
    ...credit(db, c.member_id),
  ]);
  await spend(db, reads as [D1Result<Spare>, D1Result<Owed>]);
}

// ─── As the app reads them ───

export interface ChargeJson {
  id: number;
  memberId: number;
  kind: "session" | "tournament" | "quarter" | "adjustment";
  /** The session's or tournament's id; null for a quarter or an adjustment. */
  refId: number | null;
  quarter: string | null;
  /** What it was for: the training or tournament's name; null for a quarter. */
  title: string | null;
  /** For its icon and colour: the training, or the tournament's series. */
  seriesId: number | null;
  typeId: number | null;
  startTime: string | null;
  pence: number;
  dueOn: string;
  /** Paid in full: the day, and how. */
  paidOn: string | null;
  /** Paid so far: all of it, or part (a lump sum that ran out). */
  paidPence: number;
  paidVia: "transfer" | "cash" | null;
  /** Charged by an admin, so it can be taken back. */
  byHand: boolean;
}

/** Charges as read (api.club.ts). */
export const chargesFrom = (rows: (Omit<ChargeJson, "byHand"> & { byHand: number })[]): ChargeJson[] =>
  rows.map((r) => ({ ...r, byHand: Boolean(r.byHand) }));

// ─── What the record compares (ADR 0095) ───

/** A charge: who, what for, how much, and whether it's paid. */
export const chargeState = (db: D1Database, id: number) =>
  first<{ memberId: number; what: string; pence: number; dueOn: string; paid: string | null }>(
    db,
    `SELECT c.member_id memberId, COALESCE(c.quarter, ts.name, t.name) what, c.amount_pence pence, c.due_on dueOn,
            (SELECT p.via FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
              WHERE pa.charge_id = c.id ORDER BY p.id DESC LIMIT 1) paid
     FROM charges c LEFT JOIN training_sessions s ON s.id = c.session_id
       LEFT JOIN training_series ts ON ts.id = s.series_id LEFT JOIN tournaments t ON t.id = c.tournament_id
     WHERE c.id = ?`,
    [id],
  );

/** A payment as the audit log records it. */
export const paymentState = (db: D1Database, id: number) =>
  first<{ memberId: number; pence: number; receivedOn: string; via: string }>(
    db,
    "SELECT member_id memberId, amount_pence pence, received_on receivedOn, via FROM payments WHERE id = ?",
    [id],
  );

/** What a member still owes, charge by charge. */
export const unpaidOf = async (db: D1Database, memberId: number) =>
  (await owing(db, "c.member_id", memberId)).map((c) => ({ id: c.id, left: c.left }));
