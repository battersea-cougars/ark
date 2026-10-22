// What's already on when something new would be (ADR 0122): the calendar's timed things that overlap a window, so an
// admin putting the Kumite on a Friday night is asked whether Friday Training is off. Read from the agenda (ADR 0042),
// which every part of the club keeps, plus the nights a training's rule gives that aren't made yet (sessions are
// made 12 weeks ahead, ADR 0030; a tournament is often further off).
import { all, first, type Param } from "@cougars/shared/d1";
import { londonDay, londonISO } from "@cougars/shared/london";
import { can, type Action } from "../../src/access/actions";
import { HORIZON_WEEKS, WEEKDAYS, addDays, ruleDates, type Weekday } from "../../src/lib/recurrence";
import { HttpError, date, time } from "../api/api.http";

export interface Clash {
  /** Which it is, as a save says it was asked about (`clashes`): "session:12", "tournament:5", a night the rule gives
   * that isn't made yet "session:1@2027-03-12". */
  key: string;
  /** What it is: a training night, a tournament's day, a one-off. */
  source: "session" | "tournament" | "club_event";
  /** Its row; null for a training night the rule gives that isn't made yet. */
  id: number | null;
  /** A training night's series (to make the night before cancelling it). */
  seriesId: number | null;
  title: string;
  day: string;
  startsAt: string;
  endsAt: string;
  /** Whether whoever asked can call it off here: training and one-offs, by their own cancel. A tournament can't. */
  canCancel: boolean;
  /** Who's in or waiting: who'd hear it's off. */
  signedUp: number;
}

/** Each kind's cancel, and the action it needs (training.routes.ts, events.routes.ts). */
const CANCEL: Record<Clash["source"], Action | null> = {
  session: "manage:Training",
  club_event: "update:Event",
  tournament: null,
};

const ms = (iso: string) => Date.parse(iso);
/** Half-open windows: one ending as the other starts doesn't clash. */
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/** A time something new would be on, as London instants. */
export interface Span {
  startsAt: string;
  endsAt: string;
}

/**
 * What's on between `startsAt` and `endsAt` that isn't off already: training nights, tournament days and one-offs
 * with a time (not a deadline or a draft night, which have none, nor a tournament that's only a season so far).
 * `except` is the thing being edited ("tournament:5", "club_event:3"), which can't clash with itself.
 */
export async function findClashes(
  db: D1Database,
  window: Span & { except?: string | null },
  today: string,
  actions: Set<Action>,
): Promise<Clash[]> {
  const span: [number, number] = [ms(window.startsAt), ms(window.endsAt)];
  if (Number.isNaN(span[0]) || Number.isNaN(span[1]) || span[1] < span[0])
    throw new HttpError(400, "startsAt and endsAt should be times, the end after the start.");
  return clashesOver(db, [window], window.except ?? null, today, actions);
}

/**
 * What's on over any of these times. `except` as findClashes', or a training ("series:1"): none of its own nights,
 * made or not, is over it.
 */
export async function clashesOver(
  db: D1Database,
  spans: Span[],
  except: string | null,
  today: string,
  actions: ReadonlySet<Action>,
): Promise<Clash[]> {
  if (!spans.length) return [];
  // A night that runs past midnight is on two days; nothing that's been is worth asking about
  const earliest = spans.map((w) => londonDay(w.startsAt)).reduce((a, b) => (a < b ? a : b));
  const from = earliest > today ? earliest : today;
  const to = spans.map((w) => londonDay(w.endsAt)).reduce((a, b) => (a > b ? a : b));
  if (to < from) return [];
  const windows = spans.map((w): [number, number] => [ms(w.startsAt), ms(w.endsAt)]);

  const [rows, series, made] = await Promise.all([
    all<{ source: Clash["source"]; id: number; title: string; day: string; startsAt: string; endsAt: string }>(
      db,
      // Through the day index (agenda_day); the evening before too, for one that runs past midnight
      `SELECT source, source_id id, title, day, starts_at startsAt, ends_at endsAt FROM agenda
       WHERE day BETWEEN ? AND ? AND kind IN ('training', 'tournament', 'event')
         AND all_day = 0 AND date_tbc = 0 AND cancelled = 0 AND audience = 'everyone'`,
      [addDays(from, -1), to],
    ),
    all<{
      id: number;
      name: string;
      repeatEvery: number;
      weekdays: string;
      startsOn: string;
      endsOn: string | null;
      startTime: string;
      endTime: string;
    }>(
      db,
      `SELECT id, name, repeat_every repeatEvery, weekdays, starts_on startsOn, ends_on endsOn, start_time startTime,
              end_time endTime
       FROM training_series WHERE active = 1`,
    ),
    // Every night made on those days, cancelled or moved too: a night the rule gives that's here isn't still to make
    all<{ seriesId: number; heldOn: string; movedFrom: string | null }>(
      db,
      `SELECT series_id seriesId, held_on heldOn, moved_from movedFrom FROM training_sessions
       WHERE held_on BETWEEN ? AND ? OR moved_from BETWEEN ? AND ?`,
      [addDays(from, -1), to, addDays(from, -1), to],
    ),
  ]);

  const found: Omit<Clash, "key" | "canCancel" | "signedUp">[] = rows.map((r) => ({
    source: r.source,
    id: r.id,
    seriesId: null,
    title: r.title,
    day: r.day,
    startsAt: r.startsAt,
    endsAt: endOf(r.startsAt, r.endsAt),
  }));
  // The nights still to make: what each rule gives on those days, less what's made
  const taken = new Set(made.flatMap((s) => [`${s.seriesId}:${s.heldOn}`, `${s.seriesId}:${s.movedFrom}`]));
  for (const s of series) {
    const rule = {
      repeatEvery: s.repeatEvery,
      weekdays: s.weekdays.split(",") as Weekday[],
      startsOn: s.startsOn,
      endsOn: s.endsOn,
    };
    for (const day of ruleDates(rule, addDays(from, -1), to))
      if (!taken.has(`${s.id}:${day}`)) {
        const startsAt = londonISO(day, s.startTime);
        found.push({
          source: "session",
          id: null,
          seriesId: s.id,
          title: s.name,
          day,
          startsAt,
          endsAt: endOf(startsAt, londonISO(day, s.endTime)),
        });
      }
  }

  const clashes = found.filter(
    (c) =>
      `${c.source}:${c.id}` !== except &&
      c.day >= today &&
      windows.some((w) => overlaps(w, [ms(c.startsAt), ms(c.endsAt)])),
  );
  const sessionIds = clashes.filter((c) => c.source === "session" && c.id).map((c) => c.id);
  const eventIds = clashes.filter((c) => c.source === "club_event").map((c) => c.id);
  const [sessionMeta, signedUp] = await Promise.all([
    all<{ id: number; seriesId: number }>(
      db,
      "SELECT id, series_id seriesId FROM training_sessions WHERE id IN (SELECT value FROM json_each(?))",
      [JSON.stringify(sessionIds)],
    ),
    // Who'd hear it's off (push.notices.ts sessionOff): those in or waiting
    all<{ source: string; id: number; n: number }>(
      db,
      `SELECT 'session' source, session_id id, COUNT(*) n FROM attendance
       WHERE session_id IN (SELECT value FROM json_each(?)) AND signup IN ('in', 'waitlist') GROUP BY session_id
       UNION ALL
       SELECT 'club_event', event_id, COUNT(*) FROM club_event_entries
       WHERE event_id IN (SELECT value FROM json_each(?)) AND signup IN ('in', 'waitlist') GROUP BY event_id`,
      [JSON.stringify(sessionIds), JSON.stringify(eventIds)],
    ),
  ]);
  return clashes
    .map((c) => {
      const cancel = CANCEL[c.source];
      const seriesId = c.seriesId ?? sessionMeta.find((s) => s.id === c.id)?.seriesId ?? null;
      return {
        ...c,
        key: `${c.source}:${c.id ?? `${seriesId}@${c.day}`}`,
        seriesId,
        canCancel: cancel !== null && can(actions, cancel),
        signedUp: signedUp.find((n) => n.source === c.source && n.id === c.id)?.n ?? 0,
      };
    })
    .filter((c) => !(c.source === "session" && `series:${c.seriesId}` === except))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
}

/** A night whose end is before its start runs past midnight: it ends the next day. */
function endOf(startsAt: string, endsAt: string | null) {
  if (!endsAt) return startsAt;
  return ms(endsAt) < ms(startsAt) ? new Date(ms(endsAt) + 86_400_000).toISOString() : endsAt;
}

// ─── A training's nights (its editor asks, then saves) ───

/** A training's when, as its editor saves it. */
export interface TrainingTimes {
  repeatEvery: number;
  weekdays: Weekday[];
  startsOn: string;
  endsOn: string | null;
  startTime: string;
  endTime: string;
  active: boolean;
}

/** A training's editor's question, from its query: the rule and hours it would save, and which training it is. */
export function trainingAsked(q: URLSearchParams): TrainingTimes & { seriesId: number | null } {
  const o = Object.fromEntries(q);
  const weekdays = (o.weekdays ?? "").split(",");
  if (weekdays.some((d) => !WEEKDAYS.includes(d as Weekday)))
    throw new HttpError(400, "weekdays should list days (mon,fri).");
  const repeatEvery = Number(o.repeatEvery);
  if (!Number.isInteger(repeatEvery) || repeatEvery < 1 || repeatEvery > 8)
    throw new HttpError(400, "repeatEvery should be a whole number from 1 to 8.");
  const seriesId = o.series ? Number(o.series) : null;
  if (seriesId !== null && !Number.isInteger(seriesId)) throw new HttpError(400, "series should be a training's id.");
  const startTime = time(o, "startTime");
  const endTime = time(o, "endTime");
  if (endTime <= startTime) throw new HttpError(400, "A session ends after it starts.");
  return {
    seriesId,
    repeatEvery,
    weekdays: weekdays as Weekday[],
    startsOn: date(o, "startsOn")!,
    endsOn: date(o, "endsOn", { nullable: true }),
    startTime,
    endTime,
    active: true,
  };
}

/** One night a training's save puts on: its day and hours (London's wall clock), and as instants. */
export interface Night extends Span {
  day: string;
  startTime: string;
  endTime: string;
}

/**
 * The nights a training's save adds or moves, over the weeks its nights are made ahead (ADR 0030): every one the rule
 * gives, less those the saved training already has at the same hours (asked about when they were put on) and those
 * of its nights that are off. A paused training puts nothing on.
 */
export async function trainingNights(
  db: D1Database,
  t: TrainingTimes,
  seriesId: number | null,
  today: string,
): Promise<Night[]> {
  if (!t.active) return [];
  const to = addDays(today, HORIZON_WEEKS * 7);
  const days = ruleDates(t, today, to);
  if (!days.length) return [];
  const [saved, off] = seriesId
    ? await Promise.all([
        first<{
          repeatEvery: number;
          weekdays: string;
          startsOn: string;
          endsOn: string | null;
          startTime: string;
          endTime: string;
          active: number;
        }>(
          db,
          `SELECT repeat_every repeatEvery, weekdays, starts_on startsOn, ends_on endsOn, start_time startTime,
                  end_time endTime, active FROM training_series WHERE id = ?`,
          [seriesId],
        ),
        all<{ heldOn: string }>(
          db,
          `SELECT held_on heldOn FROM training_sessions
           WHERE series_id = ? AND held_on BETWEEN ? AND ? AND cancelled_at IS NOT NULL`,
          [seriesId, today, to],
        ),
      ])
    : [null, []];
  const kept =
    saved?.active && saved.startTime === t.startTime && saved.endTime === t.endTime
      ? new Set(ruleDates({ ...saved, weekdays: saved.weekdays.split(",") as Weekday[] }, today, to))
      : new Set<string>();
  const cancelled = new Set(off.map((s) => s.heldOn));
  return days
    .filter((day) => !kept.has(day) && !cancelled.has(day))
    .map((day) => ({
      day,
      startTime: t.startTime,
      endTime: t.endTime,
      startsAt: londonISO(day, t.startTime),
      endsAt: londonISO(day, t.endTime),
    }));
}

/** The other trainings' rules, as one line: a night one gives that isn't made yet can't be found in a statement. */
const OTHER_RULES = `(SELECT COALESCE(group_concat(r, ';'), '') FROM (
  SELECT id || ',' || repeat_every || ',' || weekdays || ',' || starts_on || ',' || COALESCE(ends_on, '') || ','
         || start_time || ',' || end_time r
  FROM training_series WHERE active = 1 AND id != ? ORDER BY id))`;

/**
 * A training's save that says what its editor asked about (`answered`, the clashes' keys): refused (409) if anything
 * else is on its new nights now, and the condition that keeps that so to the statements that write it (ADR 0121),
 * to go on the end of each one's WHERE. Something put on between the question and the answer, or between this read
 * and the write, refuses it, and the editor asks again. Null when there's nothing to keep to: the save wasn't asked
 * about (no `answered`), or puts no night on.
 */
export async function answeredGuard(
  db: D1Database,
  nights: Night[],
  answered: unknown,
  seriesId: number | null,
  today: string,
): Promise<{ sql: string; params: Param[] } | null> {
  if (answered === undefined || !nights.length) return null;
  if (!Array.isArray(answered) || answered.some((k) => typeof k !== "string"))
    throw new HttpError(400, "clashes should list what was asked about.");
  const asked = new Set(answered as string[]);
  const self = seriesId ?? 0;
  // The rules first: one changed after this is read refuses the write, one changed before is in what's found next
  const rules = await first<{ rules: string }>(db, `SELECT ${OTHER_RULES} rules`, [self]);
  const now = await clashesOver(db, nights, `series:${self}`, today, new Set());
  const unasked = now.filter((c) => !asked.has(c.key));
  if (unasked.length) throw new HttpError(409, `${unasked[0].title} is on then now too. Have a look again.`);

  // What findClashes reads from the agenda, from each thing's own row (the agenda is written after it)
  const keys = "(SELECT value FROM json_each(?))";
  const sql = `NOT EXISTS (SELECT 1 FROM json_each(?) n WHERE
      EXISTS (SELECT 1 FROM tournaments t
        WHERE t.held_on BETWEEN date(n.value ->> 'day', '-1 day') AND n.value ->> 'day' AND t.held_on >= ?
          AND t.season IS NULL AND t.status != 'finished'
          AND t.held_on || ' ' || t.start_time < n.value ->> 'to'
          AND CASE WHEN t.end_time < t.start_time THEN date(t.held_on, '+1 day') ELSE t.held_on END
              || ' ' || t.end_time > n.value ->> 'from'
          AND 'tournament:' || t.id NOT IN ${keys})
      OR EXISTS (SELECT 1 FROM club_events e
        WHERE e.cancelled_at IS NULL AND e.starts_at >= ?
          AND unixepoch(e.starts_at) < n.value ->> 'until'
          AND unixepoch(e.ends_at) + CASE WHEN e.ends_at < e.starts_at THEN 86400 ELSE 0 END > n.value ->> 'since'
          AND 'club_event:' || e.id NOT IN ${keys})
      OR EXISTS (SELECT 1 FROM training_sessions s JOIN training_series r ON r.id = s.series_id
        WHERE s.held_on = n.value ->> 'day' AND s.series_id != ? AND r.active = 1 AND s.cancelled_at IS NULL
          AND s.held_on || ' ' || COALESCE(s.start_time, r.start_time) < n.value ->> 'to'
          AND s.held_on || ' ' || COALESCE(s.end_time, r.end_time) > n.value ->> 'from'
          AND 'session:' || s.id NOT IN ${keys}
          AND 'session:' || s.series_id || '@' || s.held_on NOT IN ${keys}))
    AND ${OTHER_RULES} = ?`;
  const list = JSON.stringify(answered);
  const windows = nights.map((n) => ({
    day: n.day,
    from: `${n.day} ${n.startTime}`,
    to: `${n.day} ${n.endTime}`,
    since: ms(n.startsAt) / 1000,
    until: ms(n.endsAt) / 1000,
  }));
  return {
    sql,
    params: [
      JSON.stringify(windows),
      today,
      list,
      londonISO(today, "00:00"),
      list,
      self,
      list,
      list,
      self,
      rules!.rules,
    ],
  };
}
