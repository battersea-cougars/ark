// Why a training night is off (#186, ADR 0122): called off by hand from its own page (`called_off_at`), or off for a
// tournament on its day (`training_session_offs`: the clash sheet's Cancel, a training skipping its night). The two
// are kept apart, and the night is off (`cancelled_at`, which everything else reads) while either holds: a Kumite
// deleted or moved off its day takes its reason away, and the night comes back unless another still keeps it off.
// It's back on, from the night's page, takes every reason away: the admin's Keep both. A night whose register's
// closed is the record (lib/register-closes.ts): it stays as it was.
import { syncSeries } from "@cougars/shared/agenda";
import { all, batch, first, run, statement } from "@cougars/shared/d1";
import { registerClosed } from "../../src/lib/register-closes";
import { addDays } from "../../src/lib/recurrence";
import { londonEvening } from "../../src/lib/dates";
import { HttpError } from "../api/api.http";
import { refuseClosedSession } from "./training.register";

/** The London days a tournament is on: its own, and the next if it runs past midnight; none while it's a season. */
async function tournamentDays(db: D1Database, id: number): Promise<string[] | null> {
  const t = await first<{ heldOn: string; startTime: string; endTime: string; season: string | null }>(
    db,
    "SELECT held_on heldOn, start_time startTime, end_time endTime, season FROM tournaments WHERE id = ?",
    [id],
  );
  if (!t) return null;
  if (t.season) return [];
  return t.endTime < t.startTime ? [t.heldOn, addDays(t.heldOn, 1)] : [t.heldOn];
}

/** A night by its id, or 404; refused (409) once its register's closed. */
async function nightOf(db: D1Database, id: number, now: string) {
  const night = await first<{ heldOn: string }>(db, "SELECT held_on heldOn FROM training_sessions WHERE id = ?", [id]);
  if (!night) throw new HttpError(404, "No such session.");
  await refuseClosedSession(db, id, now);
  return night;
}

/**
 * Off: by hand (`tournamentId` null), or for a tournament on the night's day, refused (400) if it isn't. Already off
 * for something else, it stays off from when it went (nobody hears it twice).
 */
export async function callOff(db: D1Database, id: number, tournamentId: number | null, now: string) {
  const night = await nightOf(db, id, now);
  if (tournamentId === null) {
    await run(db, "UPDATE training_sessions SET called_off_at = COALESCE(called_off_at, ?) WHERE id = ?", [now, id]);
  } else {
    if (!(await tournamentDays(db, tournamentId))?.includes(night.heldOn))
      throw new HttpError(400, "That tournament isn't on the night's day.");
    await run(db, "INSERT OR IGNORE INTO training_session_offs (session_id, tournament_id) VALUES (?, ?)", [
      id,
      tournamentId,
    ]);
  }
  await settle(db, [id], now);
}

/** It's back on, from its page: whatever kept it off, by hand or for a Kumite. */
export async function backOn(db: D1Database, id: number, now: string) {
  await nightOf(db, id, now);
  await run(db, "UPDATE training_sessions SET called_off_at = NULL WHERE id = ?", [id]);
  await run(db, "DELETE FROM training_session_offs WHERE session_id = ?", [id]);
  await settle(db, [id], now);
}

/** A tournament's London days, as a statement's rows (`day`): tournamentDays, for a statement to use as it writes. */
const DAYS_OF = `SELECT held_on day FROM tournaments WHERE id = ? AND season IS NULL
  UNION ALL SELECT date(held_on, '+1 day') FROM tournaments WHERE id = ? AND season IS NULL AND end_time < start_time`;

/** A night already off on a tournament's day is off for it too, so it stays off if what put it off goes. */
const offOnItsDaysStatement = (db: D1Database, tournamentId: number) =>
  statement(
    db,
    `INSERT OR IGNORE INTO training_session_offs (session_id, tournament_id)
     SELECT id, ? FROM training_sessions WHERE held_on IN (${DAYS_OF}) AND cancelled_at IS NOT NULL`,
    [tournamentId, tournamentId, tournamentId],
  );

/** After a tournament's made: a night already off on its day is off for it too. */
export const offOnItsDays = (db: D1Database, tournamentId: number) =>
  batch(db, [offOnItsDaysStatement(db, tournamentId)]);

/**
 * After a tournament's saved: the nights it keeps off are those on its day(s) now, in one round trip (a save's D1
 * budget, ADR 0121). One it kept off on a day it's left is free of it, and back on unless something else keeps it
 * off (called off by hand, or another tournament), and unless its register's closed; a night already off on its new
 * day is off for it too.
 */
export async function tournamentMoved(db: D1Database, tournamentId: number, now: string) {
  const left = `SELECT o.session_id FROM training_session_offs o JOIN training_sessions s ON s.id = o.session_id
    WHERE o.tournament_id = ? AND s.held_on NOT IN (${DAYS_OF})`;
  const [back] = await batch<{ seriesId: number }>(db, [
    statement(
      db,
      `UPDATE training_sessions SET cancelled_at = NULL
       WHERE id IN (${left}) AND held_on >= ? AND called_off_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM training_session_offs o
                         WHERE o.session_id = training_sessions.id AND o.tournament_id <> ?)
       RETURNING series_id seriesId`,
      [tournamentId, tournamentId, tournamentId, londonEvening(new Date(now)), tournamentId],
    ),
    statement(db, `DELETE FROM training_session_offs WHERE tournament_id = ? AND session_id IN (${left})`, [
      tournamentId,
      tournamentId,
      tournamentId,
      tournamentId,
    ]),
    offOnItsDaysStatement(db, tournamentId),
  ]);
  const series = new Set((back.results ?? []).map((s) => s.seriesId));
  if (series.size) await syncSeries(db, ...series);
}

/** The nights a tournament keeps off, read before it's deleted (its reasons go with it), to settle after. */
export const nightsOffFor = async (db: D1Database, tournamentId: number) =>
  (
    await all<{ id: number }>(db, "SELECT session_id id FROM training_session_offs WHERE tournament_id = ?", [
      tournamentId,
    ])
  ).map((s) => s.id);

/**
 * Each night off while anything keeps it off, on when nothing does; one whose register's closed stays as it was.
 * Their trainings' agenda rows follow (ADR 0042), which the clash question reads.
 */
export async function settle(db: D1Database, ids: number[], now: string) {
  if (!ids.length) return;
  const nights = await all<{ id: number; heldOn: string; seriesId: number }>(
    db,
    "SELECT id, held_on heldOn, series_id seriesId FROM training_sessions WHERE id IN (SELECT value FROM json_each(?))",
    [JSON.stringify(ids)],
  );
  const open = nights.filter((s) => !registerClosed(s.heldOn, new Date(now)));
  if (!open.length) return;
  await run(
    db,
    `UPDATE training_sessions SET cancelled_at =
       CASE WHEN called_off_at IS NOT NULL
              OR EXISTS (SELECT 1 FROM training_session_offs o WHERE o.session_id = training_sessions.id)
            THEN COALESCE(cancelled_at, ?) END
     WHERE id IN (SELECT value FROM json_each(?))`,
    [now, JSON.stringify(open.map((s) => s.id))],
  );
  await syncSeries(db, ...new Set(open.map((s) => s.seriesId)));
}
