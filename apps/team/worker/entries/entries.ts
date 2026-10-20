// Who's in (T2): sign-ups for training sessions, tournaments and club events, and the register on the night. One
// row per person per event (db/schema.sql). The rules live here, not in the app: a full
// event puts you on the waitlist, and when someone who was in drops out (or is taken off) the first on the
// waitlist moves up. A training's list is in one order, Quarterly Members first (ADR 0030): one signing up for a full
// session takes the place of the last one in who pays as they go. Adding someone to a training keeps to
// its places too; only the team maker lets someone in past them (ADR 0076). Admins can put someone in a tournament or
// club event past its limit.
import { all, batch, first, run, statement } from "@cougars/shared/d1";
import { londonToday } from "../../src/lib/dates";
import { signupOpen, signupOver } from "../../src/lib/signup";
import { HttpError } from "../api/api.http";
import { offTeams } from "../training/training.teams";
import { joinDraft, leaveDraft } from "../tournaments/draft";

export type EntryKind = "session" | "tournament" | "event";
export type Answer = "in" | "out";

export const TABLES = {
  session: { table: "attendance", key: "session_id" },
  tournament: { table: "tournament_entries", key: "tournament_id" },
  event: { table: "club_event_entries", key: "event_id" },
} as const;

/** What the app shows for one event: ids in sign-up order (a training's, Quarterly Members first). */
export interface Entries {
  going: number[];
  waitlist: number[];
  /** Who signed up (in or waiting) is a Quarterly Member, so comes first (a training's only) */
  quarterly: number[];
  out: number[];
  walkIns: number[];
  noShows: number[];
}

/** SQL: whether a member is a Quarterly Member on a day (ADR 0007: a subscription covering it) */
export const quarterlyOn = (member: string, day: string) =>
  `EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.member_id = ${member} AND sub.starts_on <= ${day}
    AND (sub.ends_on IS NULL OR sub.ends_on >= ${day}))`;

const SESSION_DAY = "(SELECT held_on FROM training_sessions WHERE id = e.session_id)";
/** Keepers aren't in the Quarterly rule (ADR 0030): they keep their sign-up place, and nobody takes theirs */
const SKATER = "(SELECT position FROM members WHERE id = e.member_id) <> 'G'";

/**
 * SQL: 1 for someone signed up for a training (in or waiting) who comes first, being a Quarterly Member on the day
 * (ADR 0030), else 0. `e` is the attendance row. Other kinds are first come, first served.
 */
export const aheadIn = (kind: EntryKind) =>
  kind === "session"
    ? `(e.signup IN ('in', 'waitlist') AND ${SKATER} AND ${quarterlyOn("e.member_id", SESSION_DAY)})`
    : "FALSE"; // (not a bare 0: in an ORDER BY that names column 0)

/**
 * A Quarterly skater waiting for a full training takes the place of the last skater in who pays as they go (not a
 * walk-in, never a keeper), who waits, at the top of their queue (their sign-up time is kept). One statement, so both move or neither.
 */
const bumping = (db: D1Database, sessionId: number, memberId: number) =>
  statement(
    db,
    `WITH bumped AS MATERIALIZED (
       SELECT e.id FROM attendance e
       WHERE e.session_id = ? AND e.signup = 'in' AND e.walk_in = 0 AND ${SKATER}
         AND NOT ${quarterlyOn("e.member_id", SESSION_DAY)}
       ORDER BY e.signed_up_at DESC, e.id DESC LIMIT 1),
     waiting AS MATERIALIZED (
       SELECT e.id FROM attendance e
       WHERE e.session_id = ? AND e.member_id = ? AND e.signup = 'waitlist' AND ${SKATER}
         AND ${quarterlyOn("e.member_id", SESSION_DAY)})
     UPDATE attendance SET signup = CASE WHEN attendance.id = (SELECT id FROM waiting) THEN 'in' ELSE 'waitlist' END
     WHERE EXISTS (SELECT 1 FROM bumped) AND EXISTS (SELECT 1 FROM waiting)
       AND attendance.id IN (SELECT id FROM bumped UNION ALL SELECT id FROM waiting)`,
    [sessionId, sessionId, memberId],
  );
const bump = (db: D1Database, sessionId: number, memberId: number) => batch(db, [bumping(db, sessionId, memberId)]);

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
 * room as it does. A training keeps their sign-up time, so its one order holds; elsewhere they join the end. */
async function moveUp(db: D1Database, kind: EntryKind, id: number, limit: number | null, now: string) {
  const { table, key } = TABLES[kind];
  const kept = kind === "session";
  await run(
    db,
    `UPDATE ${table} SET signup = 'in'${kept ? "" : ", signed_up_at = ?"}
     WHERE id = (SELECT e.id FROM ${table} e WHERE e.${key} = ? AND e.signup = 'waitlist'
                 ORDER BY ${aheadIn(kind)} DESC, e.signed_up_at, e.id LIMIT 1)
       AND ${roomIn(table, key)}`,
    kept ? [id, limit, id, limit] : [now, id, limit, id, limit],
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
  if (kind === "session" && limit !== null) await bump(db, id, memberId);
}

/**
 * An admin puts someone in or takes them off altogether. A training keeps to its places (ADR 0030): in if there's
 * room, else waiting as if they'd signed up, and only the team maker's Let in goes over the limit. A tournament or
 * club event takes them past its limit, if need be. Says where they are now (null: not on it).
 */
export async function setPlayer(
  db: D1Database,
  kind: EntryKind,
  id: number,
  memberId: number,
  inIt: boolean,
  now: string,
): Promise<string | null> {
  const limit = await capacity(db, kind, id);
  const was = await current(db, kind, id, memberId);
  if (inIt) {
    if (was?.signup === "in") return "in";
    if (kind === "session") {
      if (was?.signup === "waitlist") return "waitlist";
      await put(db, kind, id, memberId, { join: limit }, now);
      if (limit !== null) await bump(db, id, memberId);
    } else {
      if (kind === "tournament") await joinDraft(db, id);
      await put(db, kind, id, memberId, "in", now);
    }
    return (await current(db, kind, id, memberId))?.signup ?? null;
  }
  if (!was) return null;
  if (kind === "tournament") await leaveDraft(db, id, memberId, true);
  const { table, key } = TABLES[kind];
  await run(db, `DELETE FROM ${table} WHERE ${key} = ? AND member_id = ?`, [id, memberId]);
  if (kind === "session") await offTeams(db, id, memberId);
  if (was.signup === "in") await moveUp(db, kind, id, limit, now);
  return null;
}

/**
 * The team maker lets someone waiting for a training in, over its limit if need be (ADR 0076): the limit is what
 * members see and what sign-up keeps to, not a wall. They keep their sign-up time, so they take their place in the
 * one order. One statement: refused unless they're waiting and the session's on.
 */
export async function letIn(db: D1Database, sessionId: number, memberId: number) {
  const res = await run(
    db,
    `UPDATE attendance SET signup = 'in'
     WHERE session_id = ? AND member_id = ? AND signup = 'waitlist'
       AND EXISTS (SELECT 1 FROM training_sessions WHERE id = ? AND cancelled_at IS NULL)`,
    [sessionId, memberId, sessionId],
  );
  if (!res.meta.changes) throw new HttpError(409, "They're not on the waiting list.");
}

/** One Friday on the register: here or not. */
export interface Mark {
  sessionId: number;
  here: boolean;
}

/**
 * The register for one member, one Friday or many (their attendance, saved at once): a sign-up is marked here or a
 * no-show; anyone else here is a walk-in, and a walk-in not here comes off (and off the night's teams, and the first
 * waiting moves up). A walk-in keeps to the places, as a sign-up does (ADR 0030): on a full night, today or ahead,
 * they wait (a Quarterly Member taking the last place of someone paying as they go) until the team maker lets them in.
 * Someone already waiting keeps their place in the queue. A night that's over is a record of who came, so a walk-in
 * there is in. Two round trips, however many Fridays: the Fridays as they are, then every change in one batch, each
 * statement taking the whole list (ADR 0059), and one per Friday a Quarterly walk-in may take a place on.
 */
export async function markAll(db: D1Database, memberId: number, marks: Mark[], by: number, now: string) {
  const ids = JSON.stringify(marks.map((m) => m.sessionId));
  const rows = await all<{
    id: number;
    heldOn: string;
    cancelled: string | null;
    signup: string | null;
    walkIn: number | null;
  }>(
    db,
    `SELECT s.id, s.held_on heldOn, s.cancelled_at cancelled, a.signup, a.walk_in walkIn
     FROM training_sessions s LEFT JOIN attendance a ON a.session_id = s.id AND a.member_id = ?
     WHERE s.id IN (SELECT value FROM json_each(?))`,
    [memberId, ids],
  );
  const today = londonToday(new Date(now));
  const was = new Map(rows.map((r) => [r.id, r]));
  const signedUp: Mark[] = [];
  const walkIns: number[] = [];
  const joining: number[] = [];
  const off: number[] = [];
  for (const m of marks) {
    const r = was.get(m.sessionId);
    if (!r) throw new HttpError(404, "No such event.");
    if (r.cancelled) throw new HttpError(409, "That session's cancelled.");
    if (r.signup === "in" && !r.walkIn) signedUp.push(m);
    else if (m.here) (r.heldOn >= today && r.signup !== "in" ? joining : walkIns).push(m.sessionId);
    else if (r.walkIn) off.push(m.sessionId);
  }
  const list = (v: unknown[]) => JSON.stringify(v);
  const offList = "SELECT value FROM json_each(?)";
  await batch(db, [
    statement(
      db,
      `UPDATE attendance AS a SET attended = m.value ->> 'here', recorded_by = ?, recorded_at = ?
       FROM json_each(?) m WHERE a.session_id = m.value ->> 'sessionId' AND a.member_id = ?`,
      [by, now, list(signedUp.map((m) => ({ sessionId: m.sessionId, here: m.here ? 1 : 0 }))), memberId],
    ),
    statement(
      db,
      `INSERT INTO attendance (session_id, member_id, signup, signed_up_at, attended, walk_in, recorded_by, recorded_at)
       SELECT value, ?, 'in', ?, 1, 1, ?, ? FROM json_each(?) WHERE true
       ON CONFLICT (session_id, member_id) DO UPDATE SET signup = 'in', signed_up_at = excluded.signed_up_at,
         attended = 1, walk_in = 1, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at`,
      [memberId, now, by, now, list(walkIns)],
    ),
    // Today or ahead: in if there's room, else waiting; someone waiting already keeps their place in the queue
    statement(
      db,
      `INSERT INTO attendance (session_id, member_id, signup, signed_up_at, attended, walk_in, recorded_by, recorded_at)
       SELECT q.id, ?, CASE WHEN q.room THEN 'in' ELSE 'waitlist' END, ?, CASE WHEN q.room THEN 1 END, 1, ?, ?
       FROM (SELECT s.id, (COALESCE(s.capacity, ts.capacity) IS NULL
               OR (SELECT COUNT(*) FROM attendance x WHERE x.session_id = s.id AND x.signup = 'in')
                 < COALESCE(s.capacity, ts.capacity)) room
             FROM training_sessions s JOIN training_series ts ON ts.id = s.series_id
             WHERE s.id IN (SELECT value FROM json_each(?))) q WHERE true
       ON CONFLICT (session_id, member_id) DO UPDATE SET signup = excluded.signup,
         signed_up_at = CASE WHEN excluded.signup = 'waitlist' AND attendance.signup = 'waitlist'
           THEN attendance.signed_up_at ELSE excluded.signed_up_at END,
         walk_in = CASE WHEN excluded.signup = 'waitlist' AND attendance.signup = 'waitlist'
           THEN attendance.walk_in ELSE 1 END,
         attended = excluded.attended, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at`,
      [memberId, now, by, now, list(joining)],
    ),
    ...joining.map((sessionId) => bumping(db, sessionId, memberId)),
    statement(db, `DELETE FROM attendance WHERE member_id = ? AND session_id IN (${offList})`, [memberId, list(off)]),
    statement(
      db,
      `DELETE FROM session_team_players WHERE member_id = ?
       AND team_id IN (SELECT id FROM session_teams WHERE session_id IN (${offList}))`,
      [memberId, list(off)],
    ),
    // A place came free on each of those nights: the first waiting moves up, where there's room
    statement(
      db,
      `UPDATE attendance SET signup = 'in'
       WHERE id IN (
         SELECT (SELECT e.id FROM attendance e WHERE e.session_id = s.id AND e.signup = 'waitlist'
                 ORDER BY ${aheadIn("session")} DESC, e.signed_up_at, e.id LIMIT 1)
         FROM training_sessions s JOIN training_series ts ON ts.id = s.series_id
         WHERE s.id IN (${offList})
           AND (COALESCE(s.capacity, ts.capacity) IS NULL
             OR (SELECT COUNT(*) FROM attendance x WHERE x.session_id = s.id AND x.signup = 'in')
               < COALESCE(s.capacity, ts.capacity)))`,
      [list(off)],
    ),
  ]);
}

/** The register on the night: one member, here or not (markAll). Says where they are now: in, waiting, or null. */
export async function mark(
  db: D1Database,
  sessionId: number,
  memberId: number,
  here: boolean,
  by: number,
  now: string,
) {
  await markAll(db, memberId, [{ sessionId, here }], by, now);
  return (await current(db, "session", sessionId, memberId))?.signup ?? null;
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

/** One answer as read; `ahead` marks a Quarterly Member signed up for a training (aheadIn). */
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
    else if (r.signup === "waitlist") e.waitlist.push(r.memberId);
    else e.out.push(r.memberId);
    if (r.ahead) e.quarterly.push(r.memberId);
    if (r.walkIn) e.walkIns.push(r.memberId);
    if (r.attended === 0) e.noShows.push(r.memberId);
  }
  return out;
}
