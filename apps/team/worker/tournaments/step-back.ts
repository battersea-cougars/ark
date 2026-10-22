// An admin steps a tournament back one step of its workflow (ADR 0074, 0060; lib/step-back.ts names the steps). The
// request says which step it's leaving (`from`): read here from the tournament as it is, and refused if it's moved on
// since, so a tap from a page that's out of date never takes a second step. Each step back is one batch whose
// statements only do anything while the tournament is still at that step, so two taps at once step back once
// (ADR 0121). The draft's own steps are for whoever runs the draft too; the rest are an admin's.
import { all, batch, first, statement } from "@cougars/shared/d1";
import { syncTournament } from "@cougars/shared/agenda";
import { HttpError } from "../api/api.http";
import { can, type Action } from "../../src/access/actions";
import { londonToday } from "../../src/lib/dates";
import { BACK_FROM, DRAFT_STEPS, backFrom, type BackFrom } from "../../src/lib/step-back";
import { clearingFixtures } from "./fixtures";

/** The tournament as the steps read it, and what each step back would take: for the check and the record. */
export async function whereItIs(db: D1Database, tournamentId: number, today: string) {
  const t = await first<{
    name: string;
    kind: string;
    draftState: string;
    status: string;
    signupClosesOn: string | null;
  }>(
    db,
    `SELECT name, kind, draft_state draftState, status, signup_closes_on signupClosesOn FROM tournaments WHERE id = ?`,
    [tournamentId],
  );
  if (!t) throw new HttpError(404, "No such tournament.");
  const [teams, games, goals] = await Promise.all([
    all<{ pick: number | null }>(db, "SELECT pick FROM tournament_teams WHERE tournament_id = ?", [tournamentId]),
    all<{ status: string; homeGoals: number | null }>(
      db,
      "SELECT status, home_goals homeGoals FROM tournament_games WHERE tournament_id = ?",
      [tournamentId],
    ),
    first<{ n: number }>(
      db,
      `SELECT COUNT(*) n FROM tournament_goals WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id = ?)`,
      [tournamentId],
    ),
  ]);
  const picks = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) n FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
     WHERE t.tournament_id = ?`,
    [tournamentId],
  );
  return {
    name: t.name,
    step: backFrom({ ...t, teams, games }, today),
    draftState: t.draftState,
    status: t.status,
    signupClosesOn: t.signupClosesOn,
    drawn: teams.filter((x) => x.pick !== null).length,
    picks: picks?.n ?? 0,
    games: games.length,
    results: games.filter((g) => g.homeGoals !== null).length,
    goals: goals?.n ?? 0,
  };
}

/** SQL: a match of the tournament has started or has a result (one param: the tournament). */
const PLAYED =
  "SELECT 1 FROM tournament_games WHERE tournament_id = ? AND (home_goals IS NOT NULL OR status <> 'next')";

/** Each step back, as the statements that take it: the last one's changes say whether it was still there to take. */
function stepsBack(db: D1Database, id: number, today: string): Record<BackFrom, D1PreparedStatement[]> {
  const games = "SELECT id FROM tournament_games WHERE tournament_id = ?";
  return {
    // Every match as it was before it started: no score, clock, scoresheet or period; the playoffs wait for the table
    // again. Their goals and penalties go first; the reset is last, and finds nothing on a second tap
    results: [
      statement(db, `DELETE FROM tournament_goals WHERE game_id IN (${games})`, [id]),
      statement(db, `DELETE FROM tournament_penalties WHERE game_id IN (${games})`, [id]),
      statement(
        db,
        `UPDATE tournament_games SET home_goals = NULL, away_goals = NULL, status = 'next', clock_left_ms = NULL,
           clock_started_at = NULL, keeper_member_id = NULL, period = 1, period_ended_at = NULL,
           home_team_id = CASE WHEN stage = 'playoff' THEN NULL ELSE home_team_id END,
           away_team_id = CASE WHEN stage = 'playoff' THEN NULL ELSE away_team_id END
         WHERE tournament_id = ? AND (home_goals IS NOT NULL OR status <> 'next'
           OR (stage = 'playoff' AND (home_team_id IS NOT NULL OR away_team_id IS NOT NULL)))`,
        [id],
      ),
    ],
    // The fixtures, only while none has started (they're made again the same way, from the teams)
    fixtures: clearingFixtures(db, id, `NOT EXISTS (${PLAYED})`, [id]),
    // The draft open again, its picks kept: only while closed with no fixtures
    teams: [
      statement(
        db,
        `UPDATE tournaments SET draft_state = 'open' WHERE id = ? AND kind = 'draft' AND draft_state = 'closed'
         AND NOT EXISTS (SELECT 1 FROM tournament_games WHERE tournament_id = ?)`,
        [id, id],
      ),
    ],
    // The picks so far off and the draft not open, its order kept: only while it's open
    draft: [
      statement(
        db,
        `DELETE FROM tournament_team_players WHERE team_id IN (SELECT id FROM tournament_teams WHERE tournament_id = ?)
         AND (SELECT draft_state FROM tournaments WHERE id = ?) = 'open'`,
        [id, id],
      ),
      statement(db, "UPDATE tournaments SET draft_state = 'none' WHERE id = ? AND draft_state = 'open'", [id]),
    ],
    // The order undrawn: only while the draft isn't open
    order: [
      statement(
        db,
        `UPDATE tournament_teams SET pick = NULL WHERE tournament_id = ? AND pick IS NOT NULL
         AND (SELECT draft_state FROM tournaments WHERE id = ?) = 'none'`,
        [id, id],
      ),
    ],
    // Sign-up open again, with no closing day (set one in its settings): only while it's past it and nothing's drawn
    signup: [
      statement(
        db,
        `UPDATE tournaments SET status = 'open', signup_closes_on = NULL
         WHERE id = ? AND signup_closes_on < ? AND NOT EXISTS (SELECT 1 FROM tournament_games WHERE tournament_id = ?)
           AND (kind <> 'draft' OR (draft_state = 'none'
             AND NOT EXISTS (SELECT 1 FROM tournament_teams WHERE tournament_id = ? AND pick IS NOT NULL)))`,
        [id, today, id, id],
      ),
    ],
  };
}

/** `from`, checked: one of the steps. */
export function backFromIn(o: Record<string, unknown>): BackFrom {
  const from = o.from;
  if (typeof from !== "string" || !BACK_FROM.includes(from as BackFrom))
    throw new HttpError(400, `from should be one of ${BACK_FROM.join(", ")}.`);
  return from as BackFrom;
}

/** One step back from `from`, by someone allowed it, while the tournament's still there. */
export async function stepBack(
  db: D1Database,
  tournamentId: number,
  from: BackFrom,
  by: { actions: Set<Action> },
  now: string,
) {
  const draftStep = DRAFT_STEPS.includes(from);
  if (!can(by.actions, "manage:Tournament") && !(draftStep && can(by.actions, "run:Draft")))
    throw new HttpError(403, draftStep ? "That takes someone who runs the draft." : "That takes an admin.");
  const today = londonToday(new Date(now));
  const at = (await whereItIs(db, tournamentId, today)).step;
  if (!at) throw new HttpError(409, "There's no step before this one.");
  if (at !== from) throw new HttpError(409, "It's moved on since: have another look.");
  const results = await batch(db, stepsBack(db, tournamentId, today)[from]);
  if (!results.at(-1)?.meta.changes) throw new HttpError(409, "It's moved on since: have another look.");
  await syncTournament(db, tournamentId);
}
