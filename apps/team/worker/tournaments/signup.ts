// An admin closes a tournament's sign-up now (ADR 0074), before its closing day: when, on its own (signup_closed_at),
// its dates left as they were, so a later save never finds it closing before it opens (lib/signup.ts signupOver).
// Members can't say they're in any more, and a captains' draft moves on to Draft open, where the order's drawn
// (lib/tournament-front.ts statusOf). One statement that only does anything while sign-up's open and nothing's drawn
// or made, so two taps at once close it once (ADR 0121). Back to Sign-up open (step-back.ts) opens it again.
import { first, run } from "@cougars/shared/d1";
import { syncTournament } from "@cougars/shared/agenda";
import { HttpError } from "../api/api.http";

export async function closeSignup(db: D1Database, tournamentId: number, today: string, now: string) {
  const res = await run(
    db,
    `UPDATE tournaments SET signup_closed_at = ?
     WHERE id = ? AND signup_closed_at IS NULL
       AND (status = 'open' OR (status = 'planned' AND signup_opens_on IS NOT NULL AND signup_opens_on <= ?))
       AND (signup_closes_on IS NULL OR signup_closes_on >= ?)
       AND NOT EXISTS (SELECT 1 FROM tournament_games WHERE tournament_id = ?)
       AND (kind <> 'draft' OR draft_state = 'none')`,
    [now, tournamentId, today, today, tournamentId],
  );
  if (!res.meta.changes) {
    const there = await first(db, "SELECT 1 FROM tournaments WHERE id = ?", [tournamentId]);
    throw there ? new HttpError(409, "Sign-up isn't open.") : new HttpError(404, "No such tournament.");
  }
  await syncTournament(db, tournamentId);
}
