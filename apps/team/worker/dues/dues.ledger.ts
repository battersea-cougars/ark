// What members owe, as the app reads it (ADR 0007, #177): opening the app sends each member's own unpaid charges and
// a line per member of what they owe (by age, for Unpaid fees), never every charge and payment there has been. A
// member's ledger is read a page at a time, newest first, each line with what they owed after it; and what a night or
// a tournament collected, when an editor shows it. Every sum here is over the charges with something left to pay and
// the payments with something left to spend (charges.paid_pence and payments.spent_pence, kept by the schema's
// triggers), found by index, so none of it grows with the weeks behind the club.
import { HttpError } from "../api/api.http";
import { chargesFrom, type ChargeJson } from "./dues";
import type { Owed } from "../../src/lib/dues";

/**
 * A charge as the app shows it, from charges `c` (lib/dues.ts Charge): what it was for, and what's paid. Paid in full:
 * the last payment's day, and how the newest paid.
 */
export const CHARGE_COLUMNS =
  "id memberId kind refId quarter title seriesId typeId startTime pence dueOn paidOn paidVia paidPence byHand";
export const chargeSelect = (where: string, order = "c.due_on DESC, c.id DESC") => `
  SELECT c.id, c.member_id memberId,
         CASE WHEN c.session_id IS NOT NULL THEN 'session' WHEN c.tournament_id IS NOT NULL THEN 'tournament'
           WHEN c.reason IS NOT NULL THEN 'adjustment' ELSE 'quarter' END kind,
         COALESCE(c.session_id, c.tournament_id) refId, c.quarter, COALESCE(ts.name, t.name, c.reason) title,
         s.series_id seriesId, t.type_id typeId, COALESCE(s.start_time, ts.start_time, t.start_time) startTime,
         c.amount_pence pence, c.due_on dueOn,
         CASE WHEN c.paid_pence >= c.amount_pence THEN (SELECT MAX(p.received_on) FROM payment_allocations pa
           JOIN payments p ON p.id = pa.payment_id WHERE pa.charge_id = c.id) END paidOn,
         CASE WHEN c.paid_pence >= c.amount_pence THEN (SELECT p.via FROM payment_allocations pa
           JOIN payments p ON p.id = pa.payment_id WHERE pa.charge_id = c.id ORDER BY p.id DESC LIMIT 1) END paidVia,
         c.paid_pence paidPence, c.created_by IS NOT NULL byHand
  FROM charges c
    LEFT JOIN training_sessions s ON s.id = c.session_id LEFT JOIN training_series ts ON ts.id = s.series_id
    LEFT JOIN tournaments t ON t.id = c.tournament_id
  WHERE ${where}
  ORDER BY ${order}`;

/** Something left to pay on charge `c`; something left to spend of payment `p` (credit). Each has an index. */
export const OWING = (c: string) => `${c}.paid_pence < ${c}.amount_pence`;
export const SPARE = (p: string) => `${p}.spent_pence < ${p}.amount_pence`;

/** How old an unpaid charge `c` is, as Unpaid fees' columns (lib/dues.ts bucketOf), on `today` (SQL). */
const bucket = (c: string, today: string) => `CASE
    WHEN julianday(${today}) - julianday(${c}.due_on) <= 30 THEN 0 WHEN julianday(${today}) - julianday(${c}.due_on) <= 60 THEN 1
    WHEN julianday(${today}) - julianday(${c}.due_on) <= 90 THEN 2 ELSE 3 END`;

/**
 * What each of `members` (SQL listing their ids) owes on `today` (SQL), and how late (lib/dues.ts aged): what's left
 * by each charge's age, the oldest's bucket, what's overdue (due before today), and their credit. Only members who owe
 * something or have credit; worst first (oldest debt, then most owed).
 */
export const OWED_COLUMNS = "memberId owed overdue credit a0 a1 a2 a3 oldest";
export const owedSelect = (members: string, today: string) => `
  SELECT memberId, SUM(owed) owed, SUM(overdue) overdue, SUM(credit) credit, SUM(a0) a0, SUM(a1) a1, SUM(a2) a2,
         SUM(a3) a3, COALESCE(MAX(bucket), 0) oldest
  FROM (SELECT c.member_id memberId, c.amount_pence - c.paid_pence owed,
               CASE WHEN c.due_on < ${today} THEN c.amount_pence - c.paid_pence ELSE 0 END overdue, 0 credit,
               ${[0, 1, 2, 3].map((n) => `CASE WHEN ${bucket("c", today)} = ${n} THEN c.amount_pence - c.paid_pence ELSE 0 END a${n}`).join(", ")},
               ${bucket("c", today)} bucket
        FROM charges c WHERE c.member_id IN (${members}) AND ${OWING("c")}
        UNION ALL
        SELECT p.member_id, 0, 0, p.amount_pence - p.spent_pence, 0, 0, 0, 0, NULL
        FROM payments p WHERE p.member_id IN (${members}) AND ${SPARE("p")})
  GROUP BY memberId
  ORDER BY oldest DESC, owed DESC, memberId`;

type OwedRow = Omit<Owed, "amounts"> & Record<"a0" | "a1" | "a2" | "a3", number>;
export const owedFrom = (rows: OwedRow[]): Owed[] =>
  rows.map(({ a0, a1, a2, a3, ...r }) => ({ ...r, amounts: [a0, a1, a2, a3] }));

// ─── A member's ledger, a page at a time ───

/** Where a page starts: before this line (its day, charge or payment, and its id). */
export interface LineCursor {
  on: string;
  kind: "c" | "p";
  id: number;
}
const LAST = { on: "9999-12-31", kind: "p" as const, id: Number.MAX_SAFE_INTEGER };

/** A page's `before` and `limit`, checked: 30 a page unless it says, 200 at most (a ledger read again whole). */
export function linePageOf(url: URL): { before: LineCursor; limit: number } {
  const limit = Number(url.searchParams.get("limit") ?? 30);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, "limit is 1 to 200.");
  const before = url.searchParams.get("before");
  if (!before) return { before: LAST, limit };
  const hit = /^(\d{4}-\d{2}-\d{2})_([cp])(\d+)$/.exec(before);
  if (!hit) throw new HttpError(400, "before is a line, as the last page said.");
  return { before: { on: hit[1], kind: hit[2] as "c" | "p", id: Number(hit[3]) }, limit };
}

/**
 * The bounds a cursor puts on each table. Oldest first, a day's charges come before its payments (lib/dues.ts ledger),
 * so before a payment come that day's charges and its earlier payments; before a charge, its earlier charges only.
 */
const bounds = (b: LineCursor) => ({
  charge: b.kind === "p" ? [b.on, Number.MAX_SAFE_INTEGER] : [b.on, b.id],
  payment: b.kind === "p" ? [b.on, b.id] : [b.on, 0],
});

export interface Payment {
  id: number;
  memberId: number;
  pence: number;
  receivedOn: string;
  via: "transfer" | "cash" | "adjustment";
  reason: string | null;
}
export type Line =
  | { kind: "charge"; on: string; charge: ChargeJson; pence: number; balance: number }
  | { kind: "payment"; on: string; payment: Payment; pence: number; balance: number };

/**
 * A page of a member's ledger, newest first, `limit` lines before `before`, each with what they owed after it (below
 * nothing, credit): what they owe now, less the lines newer than the page. One statement: at most `limit + 1` of each
 * by index, what they owe and their credit (the owing and spare indexes), and the sums of the lines above the page
 * (as many as have been scrolled past). The first page also says what they've paid in all, and which quarters from
 * two years back they're charged for (member sheet → Charge a quarter).
 */
export async function ledgerPage(
  db: D1Database,
  memberId: number,
  { before, limit }: { before: LineCursor; limit: number },
  today: string,
) {
  const { charge, payment } = bounds(before);
  const first = before === LAST;
  const sql = `SELECT
      (SELECT json_group_array(json_object(${CHARGE_COLUMNS.split(" ")
        .map((c) => `'${c}', "${c}"`)
        .join(", ")})) FROM (${chargeSelect("c.member_id = ? AND (c.due_on, c.id) < (?, ?)")} LIMIT ?)) charges,
      (SELECT json_group_array(json_object('id', id, 'memberId', member_id, 'pence', amount_pence,
         'receivedOn', received_on, 'via', via, 'reason', reason)) FROM (
         SELECT * FROM payments WHERE member_id = ? AND (received_on, id) < (?, ?)
         ORDER BY received_on DESC, id DESC LIMIT ?)) payments,
      (SELECT COALESCE(SUM(amount_pence - paid_pence), 0) FROM charges c WHERE member_id = ? AND ${OWING("c")}) owed,
      (SELECT COALESCE(SUM(amount_pence - spent_pence), 0) FROM payments p WHERE member_id = ? AND ${SPARE("p")}) credit,
      (SELECT COALESCE(SUM(amount_pence), 0) FROM charges WHERE member_id = ? AND (due_on, id) >= (?, ?)) chargedAbove,
      (SELECT COALESCE(SUM(amount_pence), 0) FROM payments WHERE member_id = ? AND (received_on, id) >= (?, ?)) paidAbove,
      ${first ? "(SELECT COALESCE(SUM(spent_pence), 0) FROM payments WHERE member_id = ?)" : "NULL"} paid,
      ${first ? "(SELECT json_group_array(quarter) FROM charges WHERE quarter IS NOT NULL AND quarter >= ? AND member_id = ?)" : "NULL"} quarters`;
  const row = await db
    .prepare(sql)
    .bind(
      memberId,
      ...charge,
      limit + 1,
      memberId,
      ...payment,
      limit + 1,
      memberId,
      memberId,
      memberId,
      ...charge,
      memberId,
      ...payment,
      ...(first ? [memberId, `${Number(today.slice(0, 4)) - 2}-Q1`, memberId] : []),
    )
    .first<{
      charges: string;
      payments: string;
      owed: number;
      credit: number;
      chargedAbove: number;
      paidAbove: number;
      paid: number | null;
      quarters: string | null;
    }>();
  const charges = chargesFrom(JSON.parse(row!.charges));
  const payments = JSON.parse(row!.payments) as Payment[];
  // Newest first: a later day first, and on one day its payments before its charges, each newest first
  const merged = [
    ...charges.map((c) => ({ kind: "charge" as const, on: c.dueOn, charge: c, pence: c.pence, id: c.id })),
    ...payments.map((p) => ({ kind: "payment" as const, on: p.receivedOn, payment: p, pence: p.pence, id: p.id })),
  ].sort((a, b) => b.on.localeCompare(a.on) || (a.kind === b.kind ? b.id - a.id : a.kind === "payment" ? -1 : 1));
  const page = merged.slice(0, limit);
  let balance = row!.owed - row!.credit - (row!.chargedAbove - row!.paidAbove);
  const lines = page.map(({ id: _, ...l }) => {
    const line = { ...l, balance } as Line;
    balance -= l.kind === "charge" ? l.pence : -l.pence;
    return line;
  });
  const last = page.at(-1);
  return {
    lines,
    next: merged.length > limit && last ? `${last.on}_${last.kind === "charge" ? "c" : "p"}${last.id}` : null,
    ...(first ? { paid: row!.paid ?? 0, quarters: JSON.parse(row!.quarters ?? "[]") as string[] } : {}),
  };
}

// ─── What a night or a tournament collected ───

/** Up to 50 ids, from `?sessions=1,2,3`. */
export function idsOf(url: URL, key: string): number[] {
  const given = (url.searchParams.get(key) ?? "").split(",").filter(Boolean).map(Number);
  if (given.length > 50 || !given.every((n) => Number.isInteger(n) && n > 0))
    throw new HttpError(400, `${key} is up to 50 ids, with commas.`);
  return given;
}

export interface Collected {
  refId: number;
  due: number;
  paid: number;
  people: number;
  paidPeople: number;
}

/**
 * What each of these nights (`session_id`) or tournaments (`tournament_id`) was due and has collected, and from how
 * many (lib/dues.ts collected), by each one's charges' index. `money`: false for whoever doesn't see dues, who sees
 * only how many were charged (an editor's "already charged: the fee is fixed").
 */
export async function collectedFor(
  db: D1Database,
  column: "session_id" | "tournament_id",
  ids: number[],
  money: boolean,
): Promise<Collected[]> {
  if (!ids.length) return [];
  const { results } = await db
    .prepare(
      `SELECT c.${column} refId, SUM(c.amount_pence) due, SUM(MIN(c.paid_pence, c.amount_pence)) paid, COUNT(*) people,
              SUM(c.paid_pence >= c.amount_pence AND c.paid_pence > 0) paidPeople
       FROM charges c WHERE c.${column} IN (SELECT value FROM json_each(?)) GROUP BY c.${column} ORDER BY c.${column}`,
    )
    .bind(JSON.stringify(ids))
    .all<Collected>();
  return money ? results : results.map((r) => ({ ...r, due: 0, paid: 0, paidPeople: 0 }));
}
