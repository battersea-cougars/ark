// A member's dues as the app reads them, for the use cases (#177): their ledger page by page (what the Dues tab and
// the member sheet show), and their line of what they owe from the club read. For Vitest only.
import { expect } from "vitest";
import type { ChargeJson } from "./dues";
import type { Line, Payment } from "./dues.ledger";
import type { Owed } from "../../src/lib/dues";

interface Asker {
  call: (
    method: string,
    path: string,
    payload?: unknown,
    options?: { now?: Date },
  ) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Every line of a member's ledger, newest first, read a page at a time as the app scrolls (`limit` a page). */
export async function ledgerOf(b: Asker, memberId: number, now?: Date, limit = 30): Promise<Line[]> {
  const lines: Line[] = [];
  for (let before: string | null = ""; before !== null;) {
    const res = await b.call(
      "GET",
      `/api/members/${memberId}/ledger?limit=${limit}${before ? `&before=${before}` : ""}`,
      undefined,
      { now },
    );
    expect(res.status).toBe(200);
    lines.push(...res.body.lines);
    before = res.body.next;
  }
  return lines;
}

/** A member's charges, paid or not, newest first. */
export const chargesOf = async (b: Asker, memberId: number, now?: Date): Promise<ChargeJson[]> =>
  (await ledgerOf(b, memberId, now)).flatMap((l) => (l.kind === "charge" ? [l.charge] : []));

/** A member's payments (adjustments too), newest first. */
export const paymentsOf = async (b: Asker, memberId: number, now?: Date): Promise<Payment[]> =>
  (await ledgerOf(b, memberId, now)).flatMap((l) => (l.kind === "payment" ? [l.payment] : []));

/** What each owes, as the club read sends it to `b` (their own, or everyone's for who sees Unpaid fees). */
export const owedLines = async (b: Asker, now?: Date): Promise<Owed[]> =>
  (await b.call("GET", "/api/bootstrap", undefined, { now })).body.dues;

/** A member's credit, as the club read sends it. */
export const creditOf = async (b: Asker, memberId: number, now?: Date) =>
  (await owedLines(b, now)).find((o) => o.memberId === memberId)?.credit ?? 0;

/** Everyone in credit, as the club read sends it to `b`: who, and how much. */
export const creditsOf = async (b: Asker, now?: Date) =>
  (await owedLines(b, now)).filter((o) => o.credit > 0).map((o) => ({ memberId: o.memberId, pence: o.credit }));

/** Every member's charges, paid or not, as whoever sees everyone's dues reads them: each member's ledger in turn. */
export async function clubCharges(b: Asker, now?: Date): Promise<ChargeJson[]> {
  const members = (await b.call("GET", "/api/bootstrap", undefined, { now })).body.members as { id: number }[];
  return (await Promise.all(members.map((m) => chargesOf(b, m.id, now)))).flat();
}
