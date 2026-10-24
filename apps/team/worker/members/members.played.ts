// How many training nights each member has played (#177): the player card's "played", in every member's row of the
// club read. A night counts once its day has passed: they were in and weren't a no-show, and it wasn't called off.
// Counting every night ever played on every open read more of D1 each week, so the nights whose register has closed
// (06:00 London the morning after, lib/register-closes.ts) are counted once, into `members.played`, up to a day kept
// beside the data version (`played_through`); from then nothing changes who came to them. The club read adds the few
// nights since that day, held before today, which is at most a night or two, found by the sessions' day index.
import { batch, first, statement } from "@cougars/shared/d1";
import { londonEvening } from "@cougars/shared/london";

/** A night `a` (attendance) at `s` (training_sessions) that counts as played, once its day has passed. */
export const PLAYED = "a.signup = 'in' AND COALESCE(a.attended, 1) = 1 AND s.cancelled_at IS NULL";

/**
 * The club read's "played" for member `m` as viewer `v` sees it: what's counted, and the nights after the day counted
 * through that were held before today.
 */
export const playedOf = (m: string, v: string) =>
  `(${m}.played + (SELECT COUNT(*) FROM data_version dv CROSS JOIN training_sessions s
       CROSS JOIN attendance a ON a.session_id = s.id AND a.member_id = ${m}.id
     WHERE dv.id = 1 AND s.held_on > COALESCE(dv.played_through, '') AND s.held_on < ${v}.today AND ${PLAYED}))`;

/** The last day whose nights' registers have all closed at `now`: the day before London's evening. */
const closedThrough = (now: Date) =>
  new Date(Date.parse(`${londonEvening(now)}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Count the nights whose registers have closed since the last count into each member's `played` (the day's first open
 * and the hourly check). One round trip to read where it got to, one batch to count on: the batch only counts while
 * that's still where it got to, so two at once count each night once. None if nothing new has closed.
 */
export async function countPlayed(db: D1Database, now: Date): Promise<void> {
  const row = await first<{ through: string | null }>(
    db,
    "SELECT played_through through FROM data_version WHERE id = 1",
  );
  if (!row) return;
  const was = row.through ?? "";
  const through = closedThrough(now);
  if (through <= was) return;
  const still = "(SELECT COALESCE(played_through, '') FROM data_version WHERE id = 1) = ?";
  const nights = `SELECT a.member_id FROM training_sessions s JOIN attendance a ON a.session_id = s.id
    WHERE s.held_on > ? AND s.held_on <= ? AND ${PLAYED}`;
  await batch(db, [
    statement(
      db,
      `UPDATE members AS m SET played = m.played + (SELECT COUNT(*) FROM (${nights}) n WHERE n.member_id = m.id)
       WHERE ${still} AND m.id IN (${nights})`,
      [was, through, was, was, through],
    ),
    statement(db, `UPDATE data_version SET played_through = ? WHERE id = 1 AND ${still}`, [through, was]),
  ]);
}

/**
 * Count everyone's nights again from the start: after nights were written straight into D1 (a script, a test's
 * history), not through the register, so the count since `played_through` missed them.
 */
export async function recountPlayed(db: D1Database, now: Date): Promise<void> {
  await batch(db, [
    statement(db, "UPDATE members SET played = 0"),
    statement(db, "UPDATE data_version SET played_through = NULL WHERE id = 1"),
  ]);
  await countPlayed(db, now);
}
