// Who's in (T2): sign-ups for training sessions, tournaments and club events, and the register on the night. One
// row per person per event (db/schema.sql). The rules live here, not in the app: a full
// event puts you on the waitlist, and when someone who was in drops out (or is taken off) the first on the
// waitlist moves up. On a training's waitlist Quarterly Members go first (ADR 0030). Admins can put someone in past
// the limit.
import { all, first, run } from "@cougars/shared/d1";
import { londonToday } from "../../src/lib/dates";
import { signupOpen, signupOver } from "../../src/lib/signup";
import { HttpError } from "../api/api.http";
import { offTeams } from "../training/training.teams";
import { joinDraft, leaveDraft } from "../tournaments/draft";

export type EntryKind = "session" | "tournament" | "event";
export type Answer = "in" | "out";

const TABLES = {
  session: { table: "attendance", key: "session_id" },
  tournament: { table: "tournament_entries", key: "tournament_id" },
  event: { table: "club_event_entries", key: "event_id" },
} as const;

/** What the app shows for one event: ids in sign-up order (the waitlist in its queue order). */
export interface Entries {
  going: number[];
  waitlist: number[];
  /** Who on the waitlist is a Quarterly Member, so goes ahead (a training's only) */
  quarterly: number[];
  out: number[];
  walkIns: number[];
  noShows: number[];
}

/** SQL: whether a member is a Quarterly Member on a day (ADR 0007: a subscription covering it) */
export const quarterlyOn = (member: string, day: string) =>
  `EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.member_id = ${member} AND sub.starts_on <= ${day}
    AND (sub.ends_on IS NULL OR sub.ends_on >= ${day}))`;

/**
 * SQL: 1 for someone on a training's waitlist who goes ahead, being a Quarterly Member on the day (ADR 0030), else 0.
 * `e` is the attendance row; the session's day is looked up. Other kinds' waitlists are first come, first served.
 */
export const aheadIn = (kind: EntryKind) =>
  kind === "session"
    ? `(e.signup = 'waitlist' AND ${quarterlyOn("e.member_id", "(SELECT held_on FROM training_sessions WHERE id = e.session_id)")})`
    : "FALSE"; // (not a bare 0: in an ORDER BY that names column 0)

/** Whether the event exists and takes sign-ups, and its limit (null: no limit). */
async function capacity(db: D1Database, kind: EntryKind, id: number): Promise<number | null> {
  const row =
    kind === "session"
      ? await first<{ capacity: number | null; cancelled: string | null }>(
          db,
          `SELECT COALESCE(s.capacity, ts.capacity) capacity, s.cancelled_at cancelled
           FROM training_sessions s JOIN training_series ts ON ts.id = s.series_id WHERE s.id = ?`,
          [id],
        )
      : kind === "tournament"
        ? await first<{ capacity: number | null; cancelled: null }>(
            db,
            "SELECT capacity, NULL cancelled FROM tournaments WHERE id = ?",
            [id],
          )
        : await first<{ capacity: number | null; cancelled: null; signup: number }>(
            db,
            "SELECT capacity, NULL cancelled, signup_enabled signup FROM club_events WHERE id = ?",
            [id],
          );
  if (!row) throw new HttpError(404, "No such event.");
  if (row.cancelled) throw new HttpError(409, "That session's cancelled.");
  if ("signup" in row && !row.signup) throw new HttpError(409, "That event doesn't take sign-ups.");
  return row.capacity;
}

async function current(db: D1Database, kind: EntryKind, id: number, memberId: number) {
  const { table, key } = TABLES[kind];
  return first<{ signup: string; walkIn: number }>(
    db,
    `SELECT signup, ${kind === "session" ? "walk_in" : "0"} walkIn FROM ${table} WHERE ${key} = ? AND member_id = ?`,
    [id, memberId],
  );
}

// Two people at once: each statement is atomic, but two requests' statements can interleave. So whether there's a
// place is decided inside the statement that takes it, never counted first and written after (entries.test.ts).
const roomIn = (table: string, key: string) =>
  `(? IS NULL OR (SELECT COUNT(*) FROM ${table} WHERE ${key} = ? AND signup = 'in') < ?)`;

/** Write someone's answer. `join` is in if there's a place, else the waitlist, decided in the same statement. */
async function put(
  db: D1Database,
  kind: EntryKind,
  id: number,
  memberId: number,
  signup: "in" | "out" | { join: number | null },
  now: string,
) {
  const { table, key } = TABLES[kind];
  // A fresh answer clears what the register said about an old one
  const reset = kind === "session" ? ", attended = NULL, walk_in = 0" : "";
  const join = typeof signup === "object";
  await run(
    db,
    `INSERT INTO ${table} (${key}, member_id, signup, signed_up_at)
     VALUES (?, ?, ${join ? `CASE WHEN ${roomIn(table, key)} THEN 'in' ELSE 'waitlist' END` : "?"}, ?)
     ON CONFLICT (${key}, member_id) DO UPDATE SET signup = excluded.signup, signed_up_at = excluded.signed_up_at${reset}`,
    join ? [id, memberId, signup.join, id, signup.join, now] : [id, memberId, signup, now],
  );
}

/** A place came free: the first on the waitlist (a training's Quarterly Members first) moves up, if there's still
 * room as it does. */
async function moveUp(db: D1Database, kind: EntryKind, id: number, limit: number | null, now: string) {
  const { table, key } = TABLES[kind];
  await run(
    db,
    `UPDATE ${table} SET signup = 'in', signed_up_at = ?
     WHERE id = (SELECT e.id FROM ${table} e WHERE e.${key} = ? AND e.signup = 'waitlist'
                 ORDER BY ${aheadIn(kind)} DESC, e.signed_up_at, e.id LIMIT 1)
       AND ${roomIn(table, key)}`,
    [now, id, limit, id, limit],
  );
}

/** A member says in or out for themselves. In on a full event is the waitlist. */
export async function answer(db: D1Database, kind: EntryKind, id: number, memberId: number, a: Answer, now: string) {
  const limit = await capacity(db, kind, id);
  const was = await current(db, kind, id, memberId);
  if (a === "out") {
    if (was?.signup === "out") return;
    // Drafted: off their team while the draft's open; once it's closed (or a captain), through an admin
    if (kind === "tournament") await leaveDraft(db, id, memberId);
    await put(db, kind, id, memberId, "out", now);
    // A session's published teams keep them until a team maker remakes the teams or keeps them as they are (ADR 0076)
    if (was?.signup === "in") await moveUp(db, kind, id, limit, now);
    return;
  }
  if (was?.signup === "in" || was?.signup === "waitlist") return;
  // A tournament takes sign-ups once an admin opens them or its opening day comes, until the end of the closing day
  // (London, lib/signup.ts); saying you're out is always fine
  if (kind === "tournament") {
    const t = await first<{ status: string; signupOpensOn: string | null; signupClosesOn: string | null }>(
      db,
      `SELECT status, signup_opens_on signupOpensOn, signup_closes_on signupClosesOn FROM tournaments WHERE id = ?`,
      [id],
    );
    const today = londonToday(new Date(now));
    if (t && !signupOpen(t, today)) {
      if (t.status === "planned" && !signupOver(t, today))
        throw new HttpError(409, t.signupOpensOn ? `Sign-up opens on ${t.signupOpensOn}.` : "Sign-up isn't open yet.");
      throw new HttpError(409, "Sign-up has closed.");
    }
  }
  await put(db, kind, id, memberId, { join: limit }, now);
}

/** An admin puts someone in (past the limit, if need be) or takes them off altogether. */
export async function setPlayer(
  db: D1Database,
  kind: EntryKind,
  id: number,
  memberId: number,
  inIt: boolean,
  now: string,
) {
  const limit = await capacity(db, kind, id);
  const was = await current(db, kind, id, memberId);
  if (inIt) {
    if (was?.signup === "in") return;
    if (kind === "tournament") await joinDraft(db, id);
    await put(db, kind, id, memberId, "in", now);
    return;
  }
  if (!was) return;
  if (kind === "tournament") await leaveDraft(db, id, memberId, true);
  const { table, key } = TABLES[kind];
  await run(db, `DELETE FROM ${table} WHERE ${key} = ? AND member_id = ?`, [id, memberId]);
  if (kind === "session") await offTeams(db, id, memberId);
  if (was.signup === "in") await moveUp(db, kind, id, limit, now);
}

/**
 * The register on the night. A sign-up is expected: unticking marks a no-show, ticking takes it back. Anyone else
 * ticked is a walk-in, in tonight whatever the limit; unticking a walk-in takes them off again.
 */
export async function mark(
  db: D1Database,
  sessionId: number,
  memberId: number,
  here: boolean,
  by: number,
  now: string,
) {
  const limit = await capacity(db, "session", sessionId);
  const was = await current(db, "session", sessionId, memberId);
  if (was?.signup === "in" && !was.walkIn) {
    await run(
      db,
      "UPDATE attendance SET attended = ?, recorded_by = ?, recorded_at = ? WHERE session_id = ? AND member_id = ?",
      [here ? 1 : 0, by, now, sessionId, memberId],
    );
    return;
  }
  if (here) {
    await run(
      db,
      `INSERT INTO attendance (session_id, member_id, signup, signed_up_at, attended, walk_in, recorded_by, recorded_at)
       VALUES (?, ?, 'in', ?, 1, 1, ?, ?)
       ON CONFLICT (session_id, member_id) DO UPDATE SET signup = 'in', signed_up_at = excluded.signed_up_at,
         attended = 1, walk_in = 1, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at`,
      [sessionId, memberId, now, by, now],
    );
    return;
  }
  if (was?.walkIn) {
    await run(db, "DELETE FROM attendance WHERE session_id = ? AND member_id = ?", [sessionId, memberId]);
    await offTeams(db, sessionId, memberId);
    await moveUp(db, "session", sessionId, limit, now);
  }
}

/** Everyone's answers for the given events, keyed by event id. */
export async function listEntries(db: D1Database, kind: EntryKind, ids: number[]): Promise<Map<number, Entries>> {
  const { table, key } = TABLES[kind];
  if (!ids.length) return entriesFrom([], ids);
  const extra = kind === "session" ? "e.walk_in walkIn, e.attended" : "0 walkIn, NULL attended";
  const rows = await all<EntryRow>(
    db,
    `SELECT e.${key} eventId, e.member_id memberId, e.signup, ${extra}, ${aheadIn(kind)} ahead FROM ${table} e
     WHERE e.${key} IN (SELECT value FROM json_each(?)) ORDER BY ahead DESC, e.signed_up_at, e.id`,
    [JSON.stringify(ids)],
  );
  return entriesFrom(rows, ids);
}

/** One answer as read; `ahead` marks a Quarterly Member on a training's waitlist (aheadIn). */
interface EntryRow {
  eventId: number;
  memberId: number;
  signup: string;
  walkIn: number;
  attended: number | null;
  ahead?: number;
}

/** Answers as read, in queue order (aheadIn first, then sign-up order), grouped by event: an event with none has
 * empty lists. */
export function entriesFrom(rows: EntryRow[], ids: number[]): Map<number, Entries> {
  const out = new Map<number, Entries>(
    ids.map((id) => [id, { going: [], waitlist: [], quarterly: [], out: [], walkIns: [], noShows: [] }]),
  );
  for (const r of rows) {
    const e = out.get(r.eventId);
    if (!e) continue;
    if (r.signup === "in") e.going.push(r.memberId);
    else if (r.signup === "waitlist") {
      e.waitlist.push(r.memberId);
      if (r.ahead) e.quarterly.push(r.memberId);
    } else e.out.push(r.memberId);
    if (r.walkIn) e.walkIns.push(r.memberId);
    if (r.attended === 0) e.noShows.push(r.memberId);
  }
  return out;
}
