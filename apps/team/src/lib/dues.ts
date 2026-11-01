// Dues (ADR 0007): every charge is one person for one session, tournament or quarter. What someone owes, what a session
// collected and Unpaid fees are all sums over charges. Pure, so the D1 queries can be checked against it.

export interface Charge {
  id: number;
  memberId: number;
  kind: "session" | "tournament" | "quarter" | "adjustment";
  /** The training session's or tournament's id; null for a quarter. */
  refId: number | null;
  /** A quarter's charge: "2026-Q4". */
  quarter: string | null;
  /** The training's or tournament's name; null for a quarter. */
  title: string | null;
  /** For its icon and colour: the training, or the tournament's series. */
  seriesId: number | null;
  typeId: number | null;
  startTime: string | null;
  pence: number;
  /** The day it was held (or the quarter began): a charge is due from then. */
  dueOn: string;
  paidOn: string | null;
  paidVia: "transfer" | "cash" | null;
  /** Paid so far: all of it, or part of it (a lump sum pays the oldest first and runs out). */
  paidPence: number;
  /** Charged by an admin (a quarter), so it can be taken back. */
  byHand: boolean;
}

/** A fee that applies from a date, going forward. */
export interface DatedFee {
  pence: number;
  from: string;
}

/** Money in: a lump sum, paying their oldest charges first; anything over is credit. */
export interface Payment {
  id: number;
  memberId: number;
  pence: number;
  receivedOn: string;
  /** An adjustment takes some off what they owe, as money in would. */
  via: "transfer" | "cash" | "adjustment";
  /** An adjustment's reason. */
  reason?: string | null;
}

/** One line of a member's dues ledger: a charge (owed more) or a payment (owed less), and what they owe after it. */
export type LedgerLine =
  | { kind: "charge"; on: string; charge: Charge; pence: number; balance: number }
  | { kind: "payment"; on: string; payment: Payment; pence: number; balance: number };

/**
 * A member's dues as a ledger, newest first: every charge and payment by date, each with the running balance after it
 * (owed, or below nothing: credit). On one day, charges come before payments, so a night paid on the night nets out.
 */
export function ledger(charges: Charge[], payments: Payment[]): LedgerLine[] {
  const lines = [
    ...charges.map((charge) => ({
      kind: "charge" as const,
      on: charge.dueOn,
      charge,
      pence: charge.pence,
      id: charge.id,
    })),
    ...payments.map((payment) => ({
      kind: "payment" as const,
      on: payment.receivedOn,
      payment,
      pence: payment.pence,
      id: payment.id,
    })),
  ].sort((a, b) => a.on.localeCompare(b.on) || (a.kind === b.kind ? a.id - b.id : a.kind === "charge" ? -1 : 1));
  let balance = 0;
  return lines
    .map(({ id: _, ...l }) => {
      balance += l.kind === "charge" ? l.pence : -l.pence;
      return { ...l, balance } as LedgerLine;
    })
    .reverse();
}

/** "2026-Q4" for any day in October to December 2026. */
export const quarterOf = (day: string) => `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
export const QUARTER = /^(\d{4})-Q([1-4])$/;
/** Its first day: 2026-Q4 → 2026-10-01. */
export function quarterStart(q: string) {
  const [, year, n] = q.match(QUARTER)!;
  return `${year}-${String((Number(n) - 1) * 3 + 1).padStart(2, "0")}-01`;
}
/** The quarter after: 2026-Q4 → 2027-Q1. */
export function nextQuarter(q: string) {
  const [, year, n] = q.match(QUARTER)!;
  return n === "4" ? `${Number(year) + 1}-Q1` : `${year}-Q${Number(n) + 1}`;
}

/** Its months: 2027-Q1 → "Jan–Mar 2027". */
export function quarterMonths(q: string) {
  const [, year, n] = q.match(QUARTER)!;
  return `${["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"][Number(n) - 1]} ${year}`;
}

/** The fee in force on a date: the latest one that had started. Nothing before the first. */
export function feeOn(fees: DatedFee[], date: string): number {
  let best: DatedFee | undefined;
  for (const f of fees) if (f.from <= date && (!best || f.from > best.from)) best = f;
  return best?.pence ?? 0;
}

/** Unpaid fees' columns, by how long a charge has been owed, in plain words (ranges say "to", never a dash). */
export const BUCKETS = ["Up to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"] as const;

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);

/** 0 up to 30 days, 1 31 to 60, 2 61 to 90, 3 over 90. */
export function bucketOf(dueOn: string, today: string): 0 | 1 | 2 | 3 {
  const age = daysBetween(dueOn, today);
  return age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
}

export interface AgedRow {
  memberId: number;
  amounts: [number, number, number, number];
  total: number;
  /** The bucket of their oldest unpaid charge. */
  oldest: 0 | 1 | 2 | 3;
}

/**
 * A member's line of what they owe (#177), as the club read sends it: your own, or everyone's for who sees Unpaid fees,
 * worked out by the server from the charges not paid and the payments not spent (worker/dues/dues.ledger.ts): what's
 * left (in all, overdue, by age as Unpaid fees' columns), the oldest's bucket, and their credit.
 */
export interface Owed {
  memberId: number;
  owed: number;
  overdue: number;
  credit: number;
  amounts: [number, number, number, number];
  oldest: 0 | 1 | 2 | 3;
}

/** Unpaid fees' rows from the club's lines: everyone who owes, as the server put them (worst first). */
export const agedOf = (lines: Owed[]): AgedRow[] =>
  lines
    .filter((l) => l.owed > 0)
    .map(({ memberId, amounts, owed, oldest }) => ({ memberId, amounts: [...amounts], total: owed, oldest }));

/** What's still to pay on a charge. */
export const leftOn = (c: Charge) => (c.paidOn ? 0 : Math.max(0, c.pence - (c.paidPence ?? 0)));

/** Unpaid fees: everyone with unpaid charges, worst first (oldest debt, then most owed). */
export function aged(charges: Charge[], today: string): AgedRow[] {
  const rows = new Map<number, AgedRow>();
  for (const c of charges) {
    if (c.paidOn) continue;
    const row = rows.get(c.memberId) ?? { memberId: c.memberId, amounts: [0, 0, 0, 0], total: 0, oldest: 0 };
    const b = bucketOf(c.dueOn, today);
    row.amounts[b] += leftOn(c);
    row.total += leftOn(c);
    row.oldest = Math.max(row.oldest, b) as AgedRow["oldest"];
    rows.set(c.memberId, row);
  }
  return [...rows.values()].sort((a, b) => b.oldest - a.oldest || b.total - a.total);
}

/** What someone owes: their unpaid charges. */
export const owed = (charges: Charge[], memberId: number) =>
  charges.reduce((sum, c) => sum + (c.memberId === memberId ? leftOn(c) : 0), 0);

/** What a session or tournament was due, and what it has collected. */
export function collected(charges: Charge[], kind: Charge["kind"], refId: number) {
  const mine = charges.filter((c) => c.kind === kind && c.refId === refId);
  const paid = mine.filter((c) => c.paidOn);
  return {
    due: mine.reduce((s, c) => s + c.pence, 0),
    paid: mine.reduce((s, c) => s + c.pence - leftOn(c), 0),
    people: mine.length,
    paidPeople: paid.length,
  };
}

/** What someone owes that's overdue: what's left on their charges whose day has passed (a night is due on the night,
 * so paying on it is never late). Home's header shouts about it (ADR 0118). */
export const overdue = (charges: Charge[], memberId: number, today: string) =>
  charges.reduce((sum, c) => sum + (c.memberId === memberId && c.dueOn < today ? leftOn(c) : 0), 0);
