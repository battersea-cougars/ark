// Once a tournament's started, who's in is an admin's to change (apps/team/worker/tournaments/README.md): started is
// marked live or finished, or a match being played or played (lib/edition.ts editionState).
import { first } from "@cougars/shared/d1";
import { HttpError } from "../api/api.http";

/** SQL: the tournament `t` (its alias) has started, whatever its date says (apps/team/worker/tournaments/README.md). */
export const startedSql = (t: string) => `(${t}.status IN ('live', 'finished')
  OR EXISTS (SELECT 1 FROM tournament_games sg WHERE sg.tournament_id = ${t}.id AND sg.status <> 'next'))`;

/**
 * SQL: the tournament whose id is the one parameter has started. A member's own In or Out keeps to it inside the
 * statement that writes it (ADR 0003), so one landing as it goes live is refused or done whole; an admin's don't.
 */
export const STARTED = `EXISTS (SELECT 1 FROM tournaments st WHERE st.id = ? AND ${startedSql("st")})`;

/** Whether it's started, for the words of a refusal (the write itself keeps to STARTED). */
export async function hasStarted(db: D1Database, tournamentId: number) {
  return Boolean((await first<{ started: number }>(db, `SELECT ${STARTED} started`, [tournamentId]))?.started);
}

/** The refusal: "The Kumite's started: ask an admin to take you off." */
export async function startedRefusal(
  db: D1Database,
  tournamentId: number,
  ask: "take you off" | "put you in" | "change it",
) {
  const t = await first<{ short: string | null }>(
    db,
    `SELECT ty.short_name short FROM tournaments t LEFT JOIN tournament_types ty ON ty.id = t.type_id WHERE t.id = ?`,
    [tournamentId],
  );
  return new HttpError(409, `${t?.short ? `The ${t.short}'s` : "It's"} started: ask an admin to ${ask}.`);
}
