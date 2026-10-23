// Once a tournament's started, who's in is an admin's to change (ADR 0074): "once the kumite goes live, the player
// cannot remove themselves. only the admin can adjust it. it has fees implications" (the user, 2026-10-23). Started is
// what the app calls under way (lib/edition.ts editionState): marked live or finished (KUMITE!, The Anchor), or a match
// being played or played. A member's own In or Out keeps to it inside the statements that write it (worker/entries
// answer, ADR 0121), so one landing as it goes live is refused or done whole, never half. An admin's Add player and
// take-off (setPlayer) don't.
import { first } from "@cougars/shared/d1";
import { HttpError } from "../api/api.http";

/** SQL: the tournament whose id is the one parameter has started. */
export const STARTED = `EXISTS (SELECT 1 FROM tournaments st WHERE st.id = ? AND (st.status IN ('live', 'finished')
  OR EXISTS (SELECT 1 FROM tournament_games sg WHERE sg.tournament_id = st.id AND sg.status <> 'next')))`;

/** Whether it's started, for the words of a refusal (the write itself keeps to STARTED). */
export async function hasStarted(db: D1Database, tournamentId: number) {
  return Boolean((await first<{ started: number }>(db, `SELECT ${STARTED} started`, [tournamentId]))?.started);
}

/** The refusal: "The Kumite's started: ask an admin to take you off." */
export async function startedRefusal(db: D1Database, tournamentId: number, ask: "take you off" | "put you in") {
  const t = await first<{ short: string | null }>(
    db,
    `SELECT ty.short_name short FROM tournaments t LEFT JOIN tournament_types ty ON ty.id = t.type_id WHERE t.id = ?`,
    [tournamentId],
  );
  return new HttpError(409, `${t?.short ? `The ${t.short}'s` : "It's"} started: ask an admin to ${ask}.`);
}
