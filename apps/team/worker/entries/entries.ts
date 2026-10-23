// Who's in (T2): sign-ups for training sessions, tournaments and club events, and the register on the night. One
// row per person per event (db/schema.sql). The rules live here, not in the app: a full
// event puts you on the waitlist, and when someone who was in drops out (or is taken off) the first on the
// waitlist moves up. A training's places are the skaters'; keepers have their own, if the series sets any, else no
// limit (ADR 0030), so a keeper never takes a skater's place, nor a skater a keeper's. A training's list is in one order, Quarterly Members first (ADR 0030): one signing up for a full
// session takes the place of the last one in who pays as they go. Adding someone to a training keeps to
// its places too; only the team maker lets someone in past them (ADR 0076). Admins can put someone in a tournament or
// club event past its limit.
import { all, batch, first, run, statement, type Param } from "@cougars/shared/d1";
import { londonTime, londonToday } from "../../src/lib/dates";
import { nightOpen, nightOpensOn, opensWords, signupOpen, signupOver } from "../../src/lib/signup";
import { HttpError } from "../api/api.http";
import { offTeams } from "../training/training.teams";
import { joinDraft, leaveDraft } from "../tournaments/draft";
import { STARTED, hasStarted, startedRefusal } from "../tournaments/started";

export type EntryKind = "session" | "tournament" | "event";
/** In or out; "clear" takes back an Out, back to not answered. */
export type Answer = "in" | "out" | "clear";

export const TABLES = {
  session: { table: "attendance", key: "session_id" },
  tournament: { table: "tournament_entries", key: "tournament_id" },
  event: { table: "club_event_entries", key: "event_id" },
} as const;

/** What the app shows for one event: ids in sign-up order (a training's, Quarterly Members first). */
export interface Entries {
  going: number[];
  waitlist: number[];
  /** Who's a Quarterly skater (a training's only): in or waiting, so they come first; out too, for whoever sees who's
   * out, so the list of those can be grouped by plan like the others (ADR 0030) */
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
/** SQL: 1 for a keeper's row (`x`, an attendance row), else 0 */
const keeperRow = (x: string) => `((SELECT position FROM members WHERE id = ${x}.member_id) = 'G')`;
/** A training's places for a keeper (1) or a skater (0), at the session `s` of the series `ts`; null: no limit */
const placesFor = (keeper: string) =>
  `CASE WHEN ${keeper} THEN COALESCE(s.goalie_capacity, ts.goalie_capacity) ELSE COALESCE(s.capacity, ts.capacity) END`;

/**
 * SQL: 1 for someone signed up for a training (in or waiting) who comes first, being a Quarterly Member on the day
 * (ADR 0030), else 0. `e` is the attendance row. Other kinds are first come, first served.
 */
// (Not a bare 0 for the rest: in an ORDER BY that names column 0)
export const aheadIn = (kind: EntryKind) =>
  kind === "session" ? `(e.signup IN ('in', 'waitlist') AND ${quarterlySkater(kind)})` : "FALSE";

/** SQL: 1 for a Quarterly skater's answer to a training (in, waiting or out), else 0. `e` is the attendance row. */
export const quarterlySkater = (kind: EntryKind) =>
  kind === "session" ? `(${SKATER} AND ${quarterlyOn("e.member_id", SESSION_DAY)})` : "FALSE";

/**
 * A Quarterly skater waiting for a full training takes the place of the last skater in who pays as they go (not a
 * walk-in, never a keeper), who waits, at the top of their queue (their sign-up time is kept). One statement, so both move or neither.
 * The one bumped is marked to be told (`moved`, push.notices.ts places), in the same statement, so they're told once.
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
     UPDATE attendance SET signup = CASE WHEN attendance.id = (SELECT id FROM waiting) THEN 'in' ELSE 'waitlist' END,
       moved = CASE WHEN attendance.id = (SELECT id FROM waiting) THEN NULL ELSE 'bumped' END
     WHERE EXISTS (SELECT 1 FROM bumped) AND EXISTS (SELECT 1 FROM waiting)
       AND attendance.id IN (SELECT id FROM bumped UNION ALL SELECT id FROM waiting)`,
    [sessionId, sessionId, memberId],
  );
const bump = (db: D1Database, sessionId: number, memberId: number) => batch(db, [bumping(db, sessionId, memberId)]);

/** Where a member's place counts: their side of a training (a keeper's places or the skaters'), and its limit */
interface Places {
  /** null: no limit */
  limit: number | null;
  /** A keeper on a training (their places counted apart); always false elsewhere */
  keeper: boolean;
  /** A training's day and when it ends (London), for whether it's over; null elsewhere */
  night: Night | null;
  /** A club event's end: once it's past, members' own answers are over too */
  endsAt: string | null;
}

/** A training's night: its day, when it ends, and how many days before it sign-up opens (null: always open). */
interface Night {
  heldOn: string;
  endTime: string;
  opensDays: number | null;
}

/** A training's night is over once it has ended, London time. */
const nightOver = (night: Night, now: string) => {
  const today = londonToday(new Date(now));
  return today > night.heldOn || (today === night.heldOn && londonTime(now) >= night.endTime);
};

/** Whether the event exists and takes sign-ups, and the places that count for this member. */
async function capacity(db: D1Database, kind: EntryKind, id: number, memberId: number): Promise<Places> {
  const row =
    kind === "session"
      ? await first<{
          capacity: number | null;
          cancelled: string | null;
          keeper: number;
          heldOn: string;
          endTime: string;
          opensDays: number | null;
        }>(
          db,
          `SELECT k.keeper, ${placesFor("k.keeper")} capacity, s.cancelled_at cancelled, s.held_on heldOn,
             COALESCE(s.end_time, ts.end_time) endTime, ts.signup_opens_days opensDays
           FROM training_sessions s JOIN training_series ts ON ts.id = s.series_id
             JOIN (SELECT COALESCE((SELECT position = 'G' FROM members WHERE id = ?), 0) keeper) k
           WHERE s.id = ?`,
          [memberId, id],
        )
      : kind === "tournament"
        ? await first<{ capacity: number | null; cancelled: null }>(
            db,
            "SELECT capacity, NULL cancelled FROM tournaments WHERE id = ?",
            [id],
          )
        : await first<{ capacity: number | null; cancelled: string | null; signup: number; endsAt: string }>(
            db,
            "SELECT capacity, cancelled_at cancelled, signup_enabled signup, ends_at endsAt FROM club_events WHERE id = ?",
            [id],
          );
  if (!row) throw new HttpError(404, "No such event.");
  if (row.cancelled) throw new HttpError(409, kind === "session" ? "That session's cancelled." : "That's called off.");
  if ("signup" in row && !row.signup) throw new HttpError(409, "That event doesn't take sign-ups.");
  return {
    limit: row.capacity,
    keeper: "keeper" in row && Boolean(row.keeper),
    night: "heldOn" in row ? { heldOn: row.heldOn, endTime: row.endTime, opensDays: row.opensDays } : null,
    endsAt: "endsAt" in row ? row.endsAt : null,
  };
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
// A training counts a side at a time: keepers' places or skaters' (`keeper`, a boolean, so safe in the SQL).
const roomIn = (kind: EntryKind, keeper: boolean) => {
  const { table, key } = TABLES[kind];
  const side = kind === "session" ? ` AND ${keeperRow("x")} = ${keeper ? 1 : 0}` : "";
  return `(? IS NULL OR (SELECT COUNT(*) FROM ${table} x WHERE x.${key} = ? AND x.signup = 'in'${side}) < ?)`;
};

/**
 * Write someone's answer. `join` is in if there's a place, else the waitlist, decided in the same statement; it never
 * touches an answer that's already in or waiting (a double tap, or two of their phones at once), which would count
 * their own place against them and send them to the back. A member's `own` answer to a tournament goes only while it
 * hasn't started (tournaments/started.ts), in the same statement, so one landing as it goes live is refused whole.
 */
function putting(
  db: D1Database,
  kind: EntryKind,
  id: number,
  memberId: number,
  signup: "in" | "out" | { join: Places },
  now: string,
  own = false,
) {
  const { table, key } = TABLES[kind];
  // A fresh answer clears what the register said about an old one, and a move up not told yet: it's old news
  const reset = (kind === "session" ? ", attended = NULL, walk_in = 0" : "") + ", moved = NULL";
  const join = typeof signup === "object";
  const locked = own && kind === "tournament";
  const lock = locked ? ` AND NOT ${STARTED}` : "";
  return statement(
    db,
    `INSERT INTO ${table} (${key}, member_id, signup, signed_up_at)
     SELECT ?, ?, ${join ? `CASE WHEN ${roomIn(kind, signup.join.keeper)} THEN 'in' ELSE 'waitlist' END` : "?"}, ?
     WHERE TRUE${lock}
     ON CONFLICT (${key}, member_id) DO UPDATE SET signup = excluded.signup, signed_up_at = excluded.signed_up_at${reset}
     WHERE TRUE${join ? ` AND ${table}.signup NOT IN ('in', 'waitlist')` : ""}${lock}`,
    [
      ...(join ? [id, memberId, signup.join.limit, id, signup.join.limit, now] : [id, memberId, signup, now]),
      ...(locked ? [id, id] : []),
    ],
  );
}
const put = (...args: Parameters<typeof putting>) => putting(...args).run();

/** A place came free: the first on the waitlist (a training's Quarterly Members first) moves up, if there's still
 * room as it does. A training keeps their sign-up time, so its one order holds; elsewhere they join the end. On a
 * training the place is a keeper's or a skater's, as the one leaving was (`places`), and goes to the same. Sent in
 * the same batch as whatever freed the place, so nobody signing up in between can take it first. Whoever moves up is
 * marked to be told (`moved`, push.notices.ts places). */
function movingUp(db: D1Database, kind: EntryKind, id: number, places: Places, now: string, own = false) {
  const { table, key } = TABLES[kind];
  const kept = kind === "session";
  const side = kept ? ` AND ${keeperRow("e")} = ${places.keeper ? 1 : 0}` : "";
  const { limit } = places;
  // A member's own Out from a tournament that's started is refused (putting), and so is this with it
  const locked = own && kind === "tournament";
  return statement(
    db,
    `UPDATE ${table} SET signup = 'in', moved = 'place'${kept ? "" : ", signed_up_at = ?"}
     WHERE id = (SELECT e.id FROM ${table} e WHERE e.${key} = ? AND e.signup = 'waitlist'${side}
                 ORDER BY ${aheadIn(kind)} DESC, e.signed_up_at, e.id LIMIT 1)
       AND ${roomIn(kind, places.keeper)}${locked ? ` AND NOT ${STARTED}` : ""}`,
    [...(kept ? [id, limit, id, limit] : [now, id, limit, id, limit]), ...(locked ? [id] : [])],
  );
}

const PARENTS = { session: "training_sessions", tournament: "tournaments", event: "club_events" } as const;

/**
 * Places came free on many events at once (a limit raised, someone's places given up): on each, as many of the first
 * waiting move up as there's now room for, in the order `movingUp` keeps (a training's a side at a time, Quarterly
 * Members first). `scope` picks the events, as SQL on `s` (the training session, with `ts` its series) or `t` (the
 * tournament or club event). One statement, so the room is counted as it's taken (ADR 0121); send it in the batch
 * that freed the places. A night that's over, or called off, is left as it is. Whoever moves up is marked to be told
 * (`moved`), as by `movingUp`.
 */
export function fillingUp(
  db: D1Database,
  kind: EntryKind,
  scope: { sql: string; params: Param[] },
  today: string,
  now: string,
) {
  const { table, key } = TABLES[kind];
  if (kind === "session") {
    const side = (x: string) => `COALESCE(${keeperRow(x)}, 0)`;
    return statement(
      db,
      `UPDATE attendance SET signup = 'in', moved = 'place' WHERE id IN (
         SELECT id FROM (
           SELECT e.id, ${placesFor(side("e"))} places,
             ROW_NUMBER() OVER (PARTITION BY e.session_id, ${side("e")}
                                ORDER BY ${aheadIn(kind)} DESC, e.signed_up_at, e.id) rn,
             (SELECT COUNT(*) FROM attendance x WHERE x.session_id = e.session_id AND x.signup = 'in'
                AND ${side("x")} = ${side("e")}) taken
           FROM attendance e JOIN training_sessions s ON s.id = e.session_id JOIN training_series ts ON ts.id = s.series_id
           WHERE e.signup = 'waitlist' AND s.cancelled_at IS NULL AND s.held_on >= ? AND (${scope.sql}))
         WHERE places IS NULL OR rn <= places - taken)`,
      [today, ...scope.params],
    );
  }
  const live = kind === "tournament" ? "t.held_on >= ?" : "t.cancelled_at IS NULL AND t.starts_at >= ?";
  return statement(
    db,
    `UPDATE ${table} SET signup = 'in', moved = 'place', signed_up_at = ? WHERE id IN (
       SELECT id FROM (
         SELECT e.id, t.capacity places,
           ROW_NUMBER() OVER (PARTITION BY e.${key} ORDER BY e.signed_up_at, e.id) rn,
           (SELECT COUNT(*) FROM ${table} x WHERE x.${key} = e.${key} AND x.signup = 'in') taken
         FROM ${table} e JOIN ${PARENTS[kind]} t ON t.id = e.${key}
         WHERE e.signup = 'waitlist' AND ${live} AND (${scope.sql}))
       WHERE places IS NULL OR rn <= places - taken)`,
    [now, kind === "tournament" ? today : now, ...scope.params],
  );
}

/**
 * A member says in or out for themselves. In on a full event is the waitlist. Not once a tournament's started: who's
 * in then is an admin's to change (tournaments/started.ts), decided in the statements that write it.
 */
export async function answer(db: D1Database, kind: EntryKind, id: number, memberId: number, a: Answer, now: string) {
  const places = await capacity(db, kind, id, memberId);
  // A night that's over is the register's record (ADR 0007, 0030): who came, and what it charged, is the register's
  // to change, not a member's own In or Out (#128)
  if (places.night && nightOver(places.night, now))
    throw new HttpError(409, "That night's over: the register says who came.");
  if (places.endsAt && places.endsAt <= now) throw new HttpError(409, "That's over now.");
  if (a === "clear") return takeBack(db, kind, id, memberId);
  const was = await current(db, kind, id, memberId);
  if (a === "out") {
    if (was?.signup === "out") return;
    // Drafted: off their team while the draft's open; once it's closed (or a captain), through an admin
    const offTeam = kind === "tournament" ? await leaveDraft(db, id, memberId) : [];
    // Out, and the first waiting in, at once (whatever they were when read: another of their taps may have moved
    // them since). A session's published teams keep them until a team maker remakes the teams or keeps them as they
    // are (ADR 0076). A tournament that's started refuses all of it, the team too
    const done = await batch(db, [
      ...offTeam,
      putting(db, kind, id, memberId, "out", now, true),
      movingUp(db, kind, id, places, now, true),
    ]);
    if (kind === "tournament" && !done[offTeam.length].meta.changes) throw await startedRefusal(db, id, "take you off");
    return;
  }
  if (was?.signup === "in" || was?.signup === "waitlist") return;
  // A training's night takes sign-ups from its opening day (lib/signup.ts); saying you're out is always fine
  if (places.night) {
    const today = londonToday(new Date(now));
    const opens = nightOpensOn(places.night.heldOn, places.night.opensDays);
    if (opens && !nightOpen(places.night.heldOn, places.night.opensDays, today))
      throw new HttpError(409, `Sign-up opens ${opensWords(opens, today)}.`);
  }
  // A tournament takes sign-ups once an admin opens them or its opening day comes, until the end of the closing day
  // (London, lib/signup.ts); saying you're out is always fine
  if (kind === "tournament") {
    const t = await first<{
      status: string;
      signupOpensOn: string | null;
      signupClosesOn: string | null;
      signupClosedAt: string | null;
    }>(
      db,
      `SELECT status, signup_opens_on signupOpensOn, signup_closes_on signupClosesOn, signup_closed_at signupClosedAt
       FROM tournaments WHERE id = ?`,
      [id],
    );
    const today = londonToday(new Date(now));
    if (t && !signupOpen(t, today)) {
      if (t.status === "planned" && !signupOver(t, today))
        throw new HttpError(409, t.signupOpensOn ? `Sign-up opens on ${t.signupOpensOn}.` : "Sign-up isn't open yet.");
      throw new HttpError(409, "Sign-up has closed.");
    }
  }
  const joined = await put(db, kind, id, memberId, { join: places }, now, true);
  // Nothing written: a double tap, already in or waiting; or it's started
  if (kind === "tournament" && !joined.meta.changes && (await hasStarted(db, id)))
    throw await startedRefusal(db, id, "put you in");
  if (kind === "session" && places.limit !== null && !places.keeper) await bump(db, id, memberId);
}

/**
 * A member takes back their Out: not answered, as if they'd never said, so they're among those told when sign-up opens
 * (training.signup.ts, tournaments/signup.ts). One statement, and only their own Out: an In or a place waiting is
 * taken back by saying Out, and a double tap, or two phones at once, finds nothing more to do. Not once a tournament's
 * started, decided in the same statement (tournaments/started.ts); the caller's already refused a night that's over.
 */
async function takeBack(db: D1Database, kind: EntryKind, id: number, memberId: number) {
  const { table, key } = TABLES[kind];
  const locked = kind === "tournament";
  const res = await run(
    db,
    `DELETE FROM ${table} WHERE ${key} = ? AND member_id = ? AND signup = 'out'${locked ? ` AND NOT ${STARTED}` : ""}`,
    [id, memberId, ...(locked ? [id] : [])],
  );
  if (locked && !res.meta.changes && (await hasStarted(db, id))) throw await startedRefusal(db, id, "change it");
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
  const places = await capacity(db, kind, id, memberId);
  const was = await current(db, kind, id, memberId);
  if (inIt) {
    if (was?.signup === "in") return "in";
    // Someone new to it may not exist (erased while the drawer was open): told so, not the insert's foreign key
    if (!was && !(await first(db, "SELECT 1 FROM members WHERE id = ?", [memberId])))
      throw new HttpError(404, "No such member.");
    if (kind === "session") {
      if (was?.signup === "waitlist") return "waitlist";
      await put(db, kind, id, memberId, { join: places }, now);
      if (places.limit !== null && !places.keeper) await bump(db, id, memberId);
    } else {
      if (kind === "tournament") await joinDraft(db, id);
      await put(db, kind, id, memberId, "in", now);
    }
    return (await current(db, kind, id, memberId))?.signup ?? null;
  }
  if (!was) return null;
  const offTeam = kind === "tournament" ? await leaveDraft(db, id, memberId, true) : [];
  const { table, key } = TABLES[kind];
  // Off, off the night's teams, and the first waiting in: one batch, so nobody signing up between takes the place
  await batch(db, [
    ...offTeam,
    statement(db, `DELETE FROM ${table} WHERE ${key} = ? AND member_id = ?`, [id, memberId]),
    ...(kind === "session" ? [offTeams(db, id, memberId)] : []),
    movingUp(db, kind, id, places, now),
  ]);
  return null;
}

/**
 * The team maker lets someone waiting for a training in, over its limit if need be (ADR 0076): the limit is what
 * members see and what sign-up keeps to, not a wall. They keep their sign-up time, so they take their place in the
 * one order. One statement: refused unless they're waiting and the session's on. They're marked to be told it was the
 * team maker (`moved`).
 */
export async function letIn(db: D1Database, sessionId: number, memberId: number) {
  const res = await run(
    db,
    `UPDATE attendance SET signup = 'in', moved = 'let-in'
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
    keeper: number;
  }>(
    db,
    `SELECT s.id, s.held_on heldOn, s.cancelled_at cancelled, a.signup, a.walk_in walkIn,
       COALESCE((SELECT position = 'G' FROM members WHERE id = ?), 0) keeper
     FROM training_sessions s LEFT JOIN attendance a ON a.session_id = s.id AND a.member_id = ?
     WHERE s.id IN (SELECT value FROM json_each(?))`,
    [memberId, memberId, ids],
  );
  // A keeper's places or the skaters' (a boolean, so safe in the SQL)
  const keeper = rows[0]?.keeper ? "1" : "0";
  const room = `(${placesFor(keeper)} IS NULL
    OR (SELECT COUNT(*) FROM attendance x WHERE x.session_id = s.id AND x.signup = 'in' AND ${keeperRow("x")} = ${keeper})
      < ${placesFor(keeper)})`;
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
       FROM (SELECT s.id, ${room} room
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
    ...(keeper === "1" ? [] : joining.map((sessionId) => bumping(db, sessionId, memberId))),
    statement(db, `DELETE FROM attendance WHERE member_id = ? AND session_id IN (${offList})`, [memberId, list(off)]),
    statement(
      db,
      `DELETE FROM session_team_players WHERE member_id = ?
       AND team_id IN (SELECT id FROM session_teams WHERE session_id IN (${offList}))`,
      [memberId, list(off)],
    ),
    // A place came free on each of those nights (a keeper's or a skater's, as theirs was): the first waiting for one
    // moves up, where there's room, and is told
    statement(
      db,
      `UPDATE attendance SET signup = 'in', moved = 'place'
       WHERE id IN (
         SELECT (SELECT e.id FROM attendance e WHERE e.session_id = s.id AND e.signup = 'waitlist'
                   AND ${keeperRow("e")} = ${keeper}
                 ORDER BY ${aheadIn("session")} DESC, e.signed_up_at, e.id LIMIT 1)
         FROM training_sessions s JOIN training_series ts ON ts.id = s.series_id
         WHERE s.id IN (${offList}) AND ${room})`,
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
    `SELECT e.${key} eventId, e.member_id memberId, e.signup, ${extra}, ${aheadIn(kind)} ahead,
            ${quarterlySkater(kind)} quarterly FROM ${table} e
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
  /** A Quarterly skater, whatever their answer (quarterlySkater) */
  quarterly?: number;
  /** When it was given, and its row: the club read sends answers unsorted (api.club.ts) */
  signedUpAt?: string;
  id?: number;
}

/** Signed up (in or waiting) as a Quarterly skater: ahead in a training's queue (aheadIn). */
const isAhead = (r: EntryRow) =>
  r.ahead === undefined ? Boolean(r.quarterly) && (r.signup === "in" || r.signup === "waitlist") : Boolean(r.ahead);

/**
 * Queue order: Quarterly skaters signed up for a training first, then sign-up order. Rows that don't say when they
 * were given (`listEntries`, sorted by its query) keep the order they came in (a stable sort).
 */
function inQueueOrder(rows: EntryRow[]): EntryRow[] {
  const when = (r: EntryRow) => r.signedUpAt ?? "";
  return [...rows].sort(
    (a, b) =>
      Number(isAhead(b)) - Number(isAhead(a)) ||
      (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0) ||
      (a.id ?? 0) - (b.id ?? 0),
  );
}

/** Answers grouped by event, each in queue order: an event with none has empty lists. */
export function entriesFrom(rows: EntryRow[], ids: number[]): Map<number, Entries> {
  const out = new Map<number, Entries>(
    ids.map((id) => [id, { going: [], waitlist: [], quarterly: [], out: [], walkIns: [], noShows: [] }]),
  );
  for (const r of inQueueOrder(rows)) {
    const e = out.get(r.eventId);
    if (!e) continue;
    if (r.signup === "in") e.going.push(r.memberId);
    else if (r.signup === "waitlist") e.waitlist.push(r.memberId);
    else e.out.push(r.memberId);
    if (r.ahead || r.quarterly) e.quarterly.push(r.memberId);
    if (r.walkIn) e.walkIns.push(r.memberId);
    if (r.attended === 0) e.noShows.push(r.memberId);
  }
  return out;
}
