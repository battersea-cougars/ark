// Whose charges a working-out covers (ADR 0007, #222). Working out every charge there's ever been after each change
// read the club's whole history: about 52,000 D1 rows a register mark after a year. A change knows what it touched,
// so it works out only that: a night or a tournament (its register, a let-in, a cancellation, an answer on the day),
// or a member (their quarterly membership, a payment, an adjustment). The hourly run works out what a new day can
// change: the nights and tournaments since its last run, and the Quarterly Members (whose quarter pays for its nights). A fee
// or the quarterly rate changed from an earlier date, a tournament made, moved or deleted, and Recalculate still work
// out the whole club: rare, and an admin's.
import { first, run, type Param } from "@cougars/shared/d1";

/** What a working-out covers: these nights', tournaments' and members' charges, any of them. None: the whole club. */
export interface ChargeScope {
  sessions?: readonly number[];
  tournaments?: readonly number[];
  members?: readonly number[];
}

/** SQL saying a row is in the scope, and its values; null when no row of that kind can be. */
export interface InScope {
  sql: string;
  params: Param[];
}

const listed = (column: string) => `${column} IN (SELECT value FROM json_each(?))`;

/**
 * A row of one kind (a night's or a tournament's) in the scope: its event (`event`, SQL) is one of the scope's, or its
 * member (`member`) is. The whole club: every row. Null: the scope has none of this kind, nor any member.
 */
export function inScope(
  scope: ChargeScope | undefined,
  kind: "sessions" | "tournaments",
  event: string,
  member: string,
): InScope | null {
  if (!scope) return { sql: "true", params: [] };
  const terms: InScope[] = [];
  if (scope[kind]?.length) terms.push({ sql: listed(event), params: [JSON.stringify(scope[kind])] });
  if (scope.members?.length) terms.push({ sql: listed(member), params: [JSON.stringify(scope.members)] });
  return either(terms);
}

/** Any of these; null for none. */
const either = (terms: InScope[]): InScope | null =>
  terms.length ? { sql: `(${terms.map((t) => t.sql).join(" OR ")})`, params: terms.flatMap((t) => t.params) } : null;

/** A member in the scope (`member`, SQL): the whole club, every one; null when the scope names no members. */
export function membersIn(scope: ChargeScope | undefined, member: string): InScope | null {
  if (!scope) return { sql: "true", params: [] };
  if (!scope.members?.length) return null;
  return { sql: listed(member), params: [JSON.stringify(scope.members)] };
}

/** A night `s` in the scope, or one its members signed up for: the whole club, every one. Null: none can be. */
export function sessionsIn(scope: ChargeScope | undefined): InScope | null {
  if (!scope) return { sql: "true", params: [] };
  const terms: InScope[] = [];
  if (scope.sessions?.length) terms.push({ sql: listed("s.id"), params: [JSON.stringify(scope.sessions)] });
  if (scope.members?.length)
    terms.push({
      sql: `s.id IN (SELECT a.session_id FROM attendance a WHERE ${listed("a.member_id")})`,
      params: [JSON.stringify(scope.members)],
    });
  return either(terms);
}

/** A charge `c` in the scope, of any kind: the whole club, every one. */
export function chargesIn(scope: ChargeScope | undefined): InScope {
  if (!scope) return { sql: "true", params: [] };
  const terms: [string, readonly number[] | undefined][] = [
    ["c.session_id", scope.sessions],
    ["c.tournament_id", scope.tournaments],
    ["c.member_id", scope.members],
  ];
  const named = terms.filter(([, ids]) => ids?.length);
  if (!named.length) return { sql: "false", params: [] };
  return {
    sql: `(${named.map(([column]) => listed(column)).join(" OR ")})`,
    params: named.map(([, ids]) => JSON.stringify(ids)),
  };
}

/**
 * What a new day can change (the hourly run, and the day's first open): the nights and tournaments from the day the
 * last run worked charges out to (one whose day has come since is charged), and every Quarterly Member since then (a
 * quarter charged from its first day, or the day they joined, pays for its nights). Read by the days' and members'
 * indexes. The first run, or one with the clock put back past the last (the dev clock, ADR 0123), looks at the whole
 * club. `ranThrough` says the run's done, so the next starts from today.
 */
export async function newDays(db: D1Database, today: string) {
  const row = await first<{ through: string | null }>(
    db,
    "SELECT charged_through through FROM data_version WHERE id = 1",
  );
  const from = row?.through && row.through <= today ? row.through : null;
  const ranThrough = () => run(db, "UPDATE data_version SET charged_through = ? WHERE id = 1", [today]);
  if (!from) return { scope: undefined, ranThrough };
  const days = await first<{ sessions: string; tournaments: string; members: string }>(
    db,
    `SELECT (SELECT json_group_array(id) FROM training_sessions WHERE held_on BETWEEN ? AND ?) sessions,
            (SELECT json_group_array(id) FROM tournaments WHERE held_on BETWEEN ? AND ?) tournaments,
            (SELECT json_group_array(DISTINCT member_id) FROM subscriptions
              WHERE starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?)) members`,
    [from, today, from, today, today, from],
  );
  const scope: ChargeScope = {
    sessions: JSON.parse(days?.sessions ?? "[]"),
    tournaments: JSON.parse(days?.tournaments ?? "[]"),
    members: JSON.parse(days?.members ?? "[]"),
  };
  return { scope, ranThrough };
}
