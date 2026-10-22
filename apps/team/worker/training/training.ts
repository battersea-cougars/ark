// Training (ADR 0030): series and their sessions. Sessions are rows, made 12 weeks ahead from each active series'
// rule, so each can be cancelled on its own.
import { syncSeries } from "@cougars/shared/agenda";
import { all, batch, first, run, statement, type Param } from "@cougars/shared/d1";
import { SCHEDULE_ICONS, TONES } from "../../src/demo/model";
import { WEEKDAYS, addDays, datesToMake, type Weekday } from "../../src/lib/recurrence";
import { HttpError, bool, date, int, oneOf, text, time } from "../api/api.http";
import { freeSlug, slugify } from "../api/api.slugs";
import { fillingUp } from "../entries/entries";
import type { SeriesRef } from "../dues/dues";
import { scribe } from "@cougars/shared/scribe";
import { placeFields } from "../settings/venues";

interface SeriesRow {
  id: number;
  slug: string;
  name: string;
  short_name: string;
  icon: string;
  tone: string;
  repeat_every: number;
  weekdays: string;
  starts_on: string;
  ends_on: string | null;
  start_time: string;
  end_time: string;
  venue_id: number | null;
  venue: string;
  map_url: string;
  capacity: number | null;
  goalie_capacity: number | null;
  signup_opens_days: number | null;
  public: number;
  active: number;
}

const seriesJson = (s: SeriesRow, fees: { seriesId: number; pence: number; from: string }[]) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  shortName: s.short_name,
  icon: s.icon,
  tone: s.tone,
  repeatEvery: s.repeat_every,
  weekdays: s.weekdays.split(",").filter(Boolean) as Weekday[],
  startsOn: s.starts_on,
  endsOn: s.ends_on,
  startTime: s.start_time,
  endTime: s.end_time,
  venueId: s.venue_id,
  venue: s.venue,
  mapUrl: s.map_url,
  capacity: s.capacity,
  goalieCapacity: s.goalie_capacity,
  // A night's sign-up opens this many days before it, at midnight London (lib/signup.ts); null: always open
  signupOpensDays: s.signup_opens_days,
  public: Boolean(s.public),
  active: Boolean(s.active),
  // The fee per session, from each date (ADR 0007)
  fees: fees.filter((f) => f.seriesId === s.id).map(({ pence, from }) => ({ pence, from })),
});

/** Training series as read (api.club.ts), each with its fees. */
export const seriesFrom = (rows: SeriesRow[], fees: { seriesId: number; pence: number; from: string }[]) =>
  rows.map((s) => seriesJson(s, fees));

/** New sessions, all in one statement: a JSON list of [seriesId, day] (ADR 0059). */
const INSERT_SESSIONS = `INSERT OR IGNORE INTO training_sessions (series_id, held_on)
  SELECT value ->> 0, value ->> 1 FROM json_each(?)`;

const log = scribe.logger("training");

/** What else goes in the batch that saves a training (its fees, ADR 0007): statements about it, by `SeriesRef`. */
type Also = (series: SeriesRef) => D1PreparedStatement[];

/**
 * Make each active series' sessions up to the horizon. Dates already made (even cancelled or moved) are skipped. This
 * runs on every member's opening of the app, so a training whose rule can't make dates (a row from before its dates
 * were checked, or one changed by hand) is reported and skipped, never a failure for everyone (#129).
 */
export async function ensureSessions(db: D1Database, today: string) {
  // Every active series and the dates it has, in one round trip
  const [series, sessions] = await batch(db, [
    statement(db, "SELECT * FROM training_series WHERE active = 1"),
    statement(
      db,
      `SELECT series_id seriesId, held_on heldOn, moved_from movedFrom FROM training_sessions
       WHERE series_id IN (SELECT id FROM training_series WHERE active = 1)`,
    ),
  ]);
  const existing = sessions.results as { seriesId: number; heldOn: string; movedFrom: string | null }[];
  const made = (series.results as SeriesRow[]).map((s) => {
    const rule = {
      repeatEvery: s.repeat_every,
      weekdays: s.weekdays.split(",") as Weekday[],
      startsOn: s.starts_on,
      endsOn: s.ends_on,
    };
    try {
      return {
        id: s.id,
        dates: datesToMake(
          rule,
          existing.filter((x) => x.seriesId === s.id),
          today,
        ),
      };
    } catch (error) {
      log.error("A training's rule makes no dates: skipped", error, { seriesId: s.id, rule });
      return { id: s.id, dates: [] };
    }
  });
  const fresh = made.flatMap((s) => s.dates.map((d) => [s.id, d]));
  if (fresh.length) await run(db, INSERT_SESSIONS, [JSON.stringify(fresh)]);
  // Only when there are new ones: this runs on every load of the app
  for (const s of made) if (s.dates.length) await syncSeries(db, s.id);
}

/**
 * An admin looks further ahead: the next 12 weeks of a training's sessions past the last one made, so a far-off
 * date can be cancelled early. At most two years ahead.
 */
export async function moreSessions(db: D1Database, seriesId: number, today: string) {
  const s = await first<SeriesRow>(db, "SELECT * FROM training_series WHERE id = ?", [seriesId]);
  if (!s) throw new HttpError(404, "No such training.");
  const existing = await all<{ heldOn: string; movedFrom: string | null }>(
    db,
    "SELECT held_on heldOn, moved_from movedFrom FROM training_sessions WHERE series_id = ?",
    [s.id],
  );
  const last = existing.reduce((m, x) => (x.heldOn > m ? x.heldOn : m), today);
  const limit = addDays(today, 2 * 365);
  const to = addDays(last, 12 * 7) < limit ? addDays(last, 12 * 7) : limit;
  const rule = {
    repeatEvery: s.repeat_every,
    weekdays: s.weekdays.split(",") as Weekday[],
    startsOn: s.starts_on,
    endsOn: s.ends_on,
  };
  const fresh = datesToMake(rule, existing, today, to).map((d) => [s.id, d]);
  if (fresh.length) await run(db, INSERT_SESSIONS, [JSON.stringify(fresh)]);
  await syncSeries(db, s.id);
}

/**
 * One night a training's rule gives, made now if it isn't already (ADR 0122): a clash far ahead can be cancelled
 * before the weeks ahead reach it. Made, it's like any other night: ensureSessions skips its date, cancelled or not.
 */
export async function nightOf(db: D1Database, seriesId: number, o: Record<string, unknown>, today: string) {
  const heldOn = date(o, "heldOn")!;
  const s = await first<SeriesRow>(db, "SELECT * FROM training_series WHERE id = ?", [seriesId]);
  if (!s) throw new HttpError(404, "No such training.");
  const existing = await all<{ id: number; heldOn: string; movedFrom: string | null }>(
    db,
    "SELECT id, held_on heldOn, moved_from movedFrom FROM training_sessions WHERE series_id = ? AND (held_on = ? OR moved_from = ?)",
    [s.id, heldOn, heldOn],
  );
  const there = existing.find((x) => x.heldOn === heldOn);
  if (there) return there.id;
  const rule = {
    repeatEvery: s.repeat_every,
    weekdays: s.weekdays.split(",") as Weekday[],
    startsOn: s.starts_on,
    endsOn: s.ends_on,
  };
  if (!s.active || !datesToMake(rule, existing, today, addDays(today, 2 * 365)).includes(heldOn))
    throw new HttpError(400, `${s.name} isn't on that day.`);
  await run(db, INSERT_SESSIONS, [JSON.stringify([[s.id, heldOn]])]);
  await syncSeries(db, s.id);
  const made = await first<{ id: number }>(db, "SELECT id FROM training_sessions WHERE series_id = ? AND held_on = ?", [
    s.id,
    heldOn,
  ]);
  return made!.id;
}

/** A training session as read (api.club.ts), before its answers and teams. */
export interface SessionRow {
  id: number;
  seriesId: number;
  heldOn: string;
  movedFrom: string | null;
  startTime: string | null;
  endTime: string | null;
  venueId: number | null;
  venue: string | null;
  mapUrl: string | null;
  capacity: number | null;
  note: string | null;
  cancelledAt: string | null;
  registerClosedAt: string | null;
}

async function seriesFields(db: D1Database, o: Record<string, unknown>) {
  const weekdays = o.weekdays;
  if (!Array.isArray(weekdays) || !weekdays.length || weekdays.some((d) => !WEEKDAYS.includes(d as Weekday)))
    throw new HttpError(400, "weekdays should list at least one day.");
  const startsOn = date(o, "startsOn")!;
  const endsOn = date(o, "endsOn", { nullable: true });
  if (endsOn && endsOn < startsOn) throw new HttpError(400, "The last session can't be before the first.");
  const startTime = time(o, "startTime");
  const endTime = time(o, "endTime");
  if (endTime <= startTime) throw new HttpError(400, "A session ends after it starts.");
  return {
    name: text(o, "name", { max: 60 }),
    shortName: text(o, "shortName", { max: 12 }),
    icon: oneOf(o, "icon", SCHEDULE_ICONS),
    tone: oneOf(o, "tone", TONES),
    repeatEvery: int(o, "repeatEvery", { min: 1, max: 8 })!,
    weekdays: WEEKDAYS.filter((d) => weekdays.includes(d)).join(","),
    startsOn,
    endsOn,
    startTime,
    endTime,
    place: await placeFields(db, o, "venue"),
    capacity: int(o, "capacity", { min: 1, max: 500, nullable: true }),
    goalieCapacity: int(o, "goalieCapacity", { min: 0, max: 50, nullable: true }),
    signupOpensDays: int(o, "signupOpensDays", { min: 0, max: 28, nullable: true }),
    public: bool(o, "public"),
    active: bool(o, "active"),
  };
}

const seriesParams = (f: Awaited<ReturnType<typeof seriesFields>>): Param[] => [
  f.name,
  f.shortName,
  f.icon,
  f.tone,
  f.repeatEvery,
  f.weekdays,
  f.startsOn,
  f.endsOn,
  f.startTime,
  f.endTime,
  ...f.place,
  f.capacity,
  f.goalieCapacity,
  f.signupOpensDays,
  f.public ? 1 : 0,
  f.active ? 1 : 0,
];

/** A new training, with whatever goes with it (`also`) in the same batch: all of it checked first, so a refusal makes
 * nothing (#131). */
export async function createSeries(db: D1Database, o: Record<string, unknown>, today: string, also: Also = () => []) {
  const f = await seriesFields(db, o);
  const slug = await freeSlug(db, "training_series", slugify(f.shortName || f.name));
  const [res] = await batch(db, [
    statement(
      db,
      `INSERT INTO training_series (name, short_name, icon, tone, repeat_every, weekdays, starts_on, ends_on, start_time,
         end_time, venue_id, venue, map_url, capacity, goalie_capacity, signup_opens_days, public, active, slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...seriesParams(f), slug],
    ),
    ...also({ sql: "(SELECT id FROM training_series WHERE slug = ?)", params: [slug] }),
  ]);
  await ensureSessions(db, today);
  await syncSeries(db, Number(res.meta.last_row_id));
  return { id: Number(res.meta.last_row_id), slug };
}

/**
 * Change a series. Future sessions the new rule no longer makes go, unless they were moved or cancelled (an admin
 * touched them) or, once sign-ups exist, someone has signed up. Then the rule fills in what's missing. The training,
 * whatever goes with it (`also`) and the first waiting moving up into any room it now has (a limit raised is a place
 * coming free, ADR 0030, #127) are one batch, checked first: a refusal changes nothing (#131), and nobody signing up
 * between takes the new room ahead of those waiting (ADR 0121).
 */
export async function updateSeries(
  db: D1Database,
  id: number,
  o: Record<string, unknown>,
  today: string,
  now: string,
  also: Also = () => [],
) {
  if (!(await first(db, "SELECT 1 FROM training_series WHERE id = ?", [id])))
    throw new HttpError(404, "No such training.");
  const f = await seriesFields(db, o);
  await batch(db, [
    statement(
      db,
      `UPDATE training_series SET name = ?, short_name = ?, icon = ?, tone = ?, repeat_every = ?, weekdays = ?,
         starts_on = ?, ends_on = ?, start_time = ?, end_time = ?, venue_id = ?, venue = ?, map_url = ?, capacity = ?, goalie_capacity = ?,
         signup_opens_days = ?, public = ?, active = ? WHERE id = ?`,
      [...seriesParams(f), id],
    ),
    ...also({ sql: "?", params: [id] }),
    fillingUp(db, "session", { sql: "s.series_id = ?", params: [id] }, today, now),
  ]);
  const keep = new Set(
    f.active
      ? datesToMake(
          {
            repeatEvery: f.repeatEvery,
            weekdays: f.weekdays.split(",") as Weekday[],
            startsOn: f.startsOn,
            endsOn: f.endsOn,
          },
          [],
          today,
        )
      : [],
  );
  // A session someone has answered (or that was moved or cancelled) isn't untouched: it stays for them
  const future = await all<{
    id: number;
    held_on: string;
    moved_from: string | null;
    cancelled_at: string | null;
    answered: number;
  }>(
    db,
    `SELECT s.id, s.held_on, s.moved_from, s.cancelled_at,
            EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id) answered
     FROM training_sessions s WHERE s.series_id = ? AND s.held_on >= ?`,
    [id, today],
  );
  await batch(
    db,
    future
      .filter((s) => !keep.has(s.held_on) && !s.moved_from && !s.cancelled_at && !s.answered)
      .map((s) => statement(db, "DELETE FROM training_sessions WHERE id = ?", [s.id])),
  );
  await ensureSessions(db, today);
  await syncSeries(db, id);
}

/** Cancel one session (Christmas, Easter), or restore it. It stays a row, so whoever signed up can be told. */
export async function setSessionCancelled(db: D1Database, id: number, cancelled: boolean, now: string) {
  const res = await run(db, "UPDATE training_sessions SET cancelled_at = ? WHERE id = ?", [cancelled ? now : null, id]);
  if (!res.meta.changes) throw new HttpError(404, "No such session.");
  const s = await first<{ seriesId: number }>(db, "SELECT series_id seriesId FROM training_sessions WHERE id = ?", [
    id,
  ]);
  if (s) await syncSeries(db, s.seriesId);
}
