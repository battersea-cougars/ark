// A tournament's fixtures, results and playoffs (ADR 0061). Once it has two teams (a captains' draft's captains, or the
// teams that entered), an admin has the app make the fixtures: a round robin, every team playing every other once
// (lib/fixtures.ts), then the playoff games its settings ask for, by table position. They can be made again until a
// game has a result. When the last group game has its result, the playoffs get their teams from the table.
import { all, batch, first, statement } from "@cougars/shared/d1";
import { roundRobin, scorekeepers, table } from "../../src/lib/fixtures";
import { HttpError, int } from "../api/api.http";
import type { Playoff } from "./tournaments";

export interface Game {
  id: number;
  tournamentId: number;
  stage: "group" | "playoff";
  round: number;
  position: number;
  name: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeSeed: number | null;
  awaySeed: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  status: "next" | "live" | "done";
  /** The team suggested to keep score: one sitting it out (ADR 0061); null until its teams are known. */
  scoringTeamId: number | null;
  /** Who holds the scoresheet: whoever pressed Start scoring (null: nobody yet). Only they score it. */
  keeperId: number | null;
  /** The game clock: time left when it last stopped, and when it was started again (null: stopped). */
  clockLeftMs: number | null;
  clockStartedAt: string | null;
  /** The period being played (1 unless the tournament has more): the clock counts down each in turn. */
  period: number;
  /** Each goal as it went in, in order. */
  goals: Goal[];
  /** Each penalty as it was called, in order. */
  penalties: Penalty[];
}

export interface Goal {
  id: number;
  teamId: number;
  scorerId: number | null;
  assistId: number | null;
  /** When, as time into its period: null when nobody said (a result typed in). */
  atMs: number | null;
  /** Which period; null with no time. */
  period: number | null;
}

export interface Penalty {
  id: number;
  teamId: number;
  /** Who: null for a bench penalty, or nobody said. */
  memberId: number | null;
  /** 2 or 5. */
  minutes: number;
  /** lib/penalties.ts INFRACTIONS, or "" when nobody said. */
  infraction: string;
  /** When, as time into its period: null when an admin added it after without a time. */
  atMs: number | null;
  period: number | null;
  recordedBy: number | null;
}

export async function listGames(db: D1Database, tournamentId?: number): Promise<Game[]> {
  const where = tournamentId ? "WHERE tournament_id = ?" : "";
  const args = tournamentId ? [tournamentId] : [];
  // All four in one round trip
  const [rows, goals, teams, penalties] = await batch(db, [
    statement(
      db,
      `SELECT id, tournament_id tournamentId, stage, round, position, name, home_team_id homeTeamId,
              away_team_id awayTeamId, home_seed homeSeed, away_seed awaySeed, home_goals homeGoals,
              away_goals awayGoals, status, clock_left_ms clockLeftMs, clock_started_at clockStartedAt,
              keeper_member_id keeperId, period
       FROM tournament_games ${where} ORDER BY tournament_id, position`,
      args,
    ),
    statement(
      db,
      `SELECT id, game_id gameId, team_id teamId, scorer_member_id scorerId, assist_member_id assistId, at_ms atMs,
              period
       FROM tournament_goals WHERE game_id IN (SELECT id FROM tournament_games ${where})
       ORDER BY at_ms IS NULL, period, at_ms, id`,
      args,
    ),
    statement(
      db,
      `SELECT id, tournament_id tournamentId FROM tournament_teams ${where}
       ORDER BY tournament_id, coalesce(pick, 1000), id`,
      args,
    ),
    statement(
      db,
      `SELECT id, game_id gameId, team_id teamId, member_id memberId, minutes, infraction, at_ms atMs,
              period, recorded_by recordedBy
       FROM tournament_penalties WHERE game_id IN (SELECT id FROM tournament_games ${where})
       ORDER BY at_ms IS NULL, period, at_ms, id`,
      args,
    ),
  ]);
  return gamesFrom(
    rows.results as Omit<Game, "scoringTeamId" | "goals" | "penalties">[],
    goals.results as (Goal & { gameId: number })[],
    teams.results as { id: number; tournamentId: number }[],
    penalties.results as (Penalty & { gameId: number })[],
  );
}

/**
 * Games as read, each with its goals, its penalties and who keeps score. `teams` is every team of their tournaments,
 * in pick order (a draft) or the order they entered.
 */
export function gamesFrom(
  rows: Omit<Game, "scoringTeamId" | "goals" | "penalties">[],
  goals: (Goal & { gameId: number })[],
  teams: { id: number; tournamentId: number }[],
  penalties: (Penalty & { gameId: number })[] = [],
): Game[] {
  // Who keeps score, per tournament, from its teams in pick order and its games in the day's order
  const keepers = new Map<number, number>();
  for (const tid of new Set(rows.map((g) => g.tournamentId)))
    for (const [game, team] of scorekeepers(
      teams.filter((t) => t.tournamentId === tid).map((t) => t.id),
      rows.filter((g) => g.tournamentId === tid),
    ))
      keepers.set(game, team);
  return rows.map((g) => ({
    ...g,
    scoringTeamId: keepers.get(g.id) ?? null,
    goals: goals.filter((x) => x.gameId === g.id).map(({ gameId: _, ...x }) => x),
    penalties: penalties.filter((x) => x.gameId === g.id).map(({ gameId: _, ...x }) => x),
  }));
}

export interface TournamentRow {
  kind: string;
  draftState: string;
  playoffs: string;
  win: number;
  draw: number;
  loss: number;
  gameMinutes: number;
  periods: number;
  /** The length a penalty's called at unless said (ADR 0061). */
  defaultPenaltyMinutes: number;
}

export async function tournamentOf(db: D1Database, id: number) {
  const t = await first<TournamentRow>(
    db,
    `SELECT kind, draft_state draftState, playoffs, points_win win, points_draw draw, points_loss loss,
            game_minutes gameMinutes, periods, default_penalty_minutes defaultPenaltyMinutes
     FROM tournaments WHERE id = ?`,
    [id],
  );
  if (!t) throw new HttpError(404, "No such tournament.");
  return t;
}

const teamIdsOf = async (db: D1Database, id: number) =>
  (
    await all<{ id: number }>(
      db,
      "SELECT id FROM tournament_teams WHERE tournament_id = ? ORDER BY coalesce(pick, 1000), id",
      [id],
    )
  ).map((t) => t.id);

/**
 * The statements that take a tournament's fixtures away: its matches and their goals and penalties, whatever
 * makeFixtures makes (a match's scoresheet, clock and result are on its row). `when`, if given, is SQL that must
 * hold for each to run, with its params: a batch that clears only if it's still the moment to (ADR 0121).
 */
export function clearingFixtures(db: D1Database, id: number, when = "1", whenArgs: number[] = []) {
  const games = "SELECT id FROM tournament_games WHERE tournament_id = ?";
  return [
    statement(db, `DELETE FROM tournament_goals WHERE game_id IN (${games}) AND (${when})`, [id, ...whenArgs]),
    statement(db, `DELETE FROM tournament_penalties WHERE game_id IN (${games}) AND (${when})`, [id, ...whenArgs]),
    statement(db, `DELETE FROM tournament_games WHERE tournament_id = ? AND (${when})`, [id, ...whenArgs]),
  ];
}

/** An admin clears the fixtures, results and all, in one batch: they can be made again. Twice is the same as once. */
export async function clearFixtures(db: D1Database, id: number) {
  await tournamentOf(db, id);
  await batch(db, clearingFixtures(db, id));
}

/** What the fixtures hold, for the record: matches, results and goals (one param: the tournament). */
export const FIXTURES_TALLY = `(SELECT COUNT(*) FROM tournament_games WHERE tournament_id = t.id) games,
  (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = t.id AND home_goals IS NOT NULL) results,
  (SELECT COUNT(*) FROM tournament_goals WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id = t.id)) goals`;

/**
 * Whether the app can make the fixtures now, refused in words if not: two teams or more, no game played, and enough
 * teams for the playoffs. Its tournament, teams and playoffs, for making them.
 */
export async function fixturesCanBeMade(db: D1Database, id: number) {
  const t = await tournamentOf(db, id);
  const teams = await teamIdsOf(db, id);
  if (teams.length < 2) throw new HttpError(409, "Fixtures need at least two teams.");
  if (
    await first(
      db,
      "SELECT 1 FROM tournament_games WHERE tournament_id = ? AND (home_goals IS NOT NULL OR status <> 'next')",
      [id],
    )
  )
    throw new HttpError(409, "A game has a result: the fixtures are set.");
  const playoffs = JSON.parse(t.playoffs) as Playoff[];
  const short = playoffs.find((p) => Math.max(p.home, p.away) > teams.length);
  if (short) throw new HttpError(409, `${short.name} needs ${Math.max(short.home, short.away)} teams.`);
  return { teams, playoffs };
}

/**
 * An admin has the app make the fixtures: the round robin, then the playoffs waiting on the table. Also the second
 * half of a draft's one-tap close (draft.ts finishDraft).
 */
export async function makeFixtures(db: D1Database, id: number) {
  const { teams, playoffs } = await fixturesCanBeMade(db, id);

  const rounds = roundRobin(teams);
  const rows: (string | number | null)[][] = [];
  rounds.forEach((games, r) =>
    games.forEach(([home, away]) => rows.push([id, "group", r + 1, rows.length + 1, "", home, away, null, null])),
  );
  for (const p of playoffs)
    rows.push([id, "playoff", rounds.length + 1, rows.length + 1, p.name, null, null, p.home, p.away]);
  await batch(db, [
    ...clearingFixtures(db, id),
    // Every game in one statement: a JSON list of rows (ADR 0059)
    statement(
      db,
      `INSERT INTO tournament_games (tournament_id, stage, round, position, name, home_team_id, away_team_id,
         home_seed, away_seed)
       SELECT value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6, value ->> 7,
         value ->> 8
       FROM json_each(?) ORDER BY key`,
      [JSON.stringify(rows)],
    ),
  ]);
}

/**
 * A game's final score, typed in by an admin (the game up next, after the fact, or a correction). The score is always
 * its goals: missing ones go on as nobody-said-who with no time, extra ones come off (those first, then the latest).
 * The last group result fills the playoffs from the table.
 */
export async function scoreGame(db: D1Database, tournamentId: number, gameId: number, o: Record<string, unknown>) {
  const homeGoals = int(o, "homeGoals", { max: 99 });
  const awayGoals = int(o, "awayGoals", { max: 99 });
  const t = await tournamentOf(db, tournamentId);
  const games = await listGames(db, tournamentId);
  const game = games.find((g) => g.id === gameId);
  if (!game) throw new HttpError(404, "No such game.");
  if (game.homeTeamId === null || game.awayTeamId === null)
    throw new HttpError(409, "This game's teams aren't known yet.");
  // A played game (put right), or the one up next: the first in the day's order that isn't over
  const upNext = games.find((g) => g.status !== "done");
  if (game.status !== "done" && upNext?.id !== gameId)
    throw new HttpError(409, `Game ${upNext?.position ?? ""} is up next: score that one.`);
  if (game.stage === "playoff" && homeGoals === awayGoals)
    throw new HttpError(400, "A playoff can't end level: the next goal won it.");
  // The score and its goals in one batch, each side's goals matched against the count inside its statement (ADR 0121):
  // the same result saved twice at once finds the goals the first put on and adds none
  await batch(db, [
    statement(db, "UPDATE tournament_games SET home_goals = ?, away_goals = ?, status = 'done' WHERE id = ?", [
      homeGoals,
      awayGoals,
      gameId,
    ]),
    ...matchGoals(db, gameId, game.homeTeamId, homeGoals),
    ...matchGoals(db, gameId, game.awayTeamId, awayGoals),
  ]);
  if (game.stage === "group") await fillPlayoffs(db, tournamentId, t);
}

/**
 * One side's goals made to match its score, as statements for the caller's batch. Each counts the goals as it runs:
 * the missing ones go on, the extra ones come off (nobody-said-who first, then no time, then the latest).
 */
export function matchGoals(db: D1Database, gameId: number, teamId: number, score: number): D1PreparedStatement[] {
  const have = "(SELECT count(*) FROM tournament_goals WHERE game_id = ? AND team_id = ?)";
  return [
    statement(
      db,
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO tournament_goals (game_id, team_id, at_ms, created_at)
       SELECT ?, ?, NULL, ? FROM n WHERE i <= ? AND i > ${have}`,
      [score, gameId, teamId, new Date().toISOString(), score, gameId, teamId],
    ),
    statement(
      db,
      `DELETE FROM tournament_goals WHERE id IN (SELECT id FROM tournament_goals WHERE game_id = ? AND team_id = ?
         ORDER BY scorer_member_id IS NULL DESC, at_ms IS NULL DESC, at_ms DESC, id DESC LIMIT max(0, ${have} - ?))`,
      [gameId, teamId, gameId, teamId, score],
    ),
  ];
}

export async function fillPlayoffs(db: D1Database, tournamentId: number, t: TournamentRow) {
  const games = await listGames(db, tournamentId);
  const group = games.filter((g) => g.stage === "group");
  if (group.some((g) => g.status !== "done")) return;
  const rows = table(await teamIdsOf(db, tournamentId), group, { win: t.win, draw: t.draw, loss: t.loss });
  await batch(
    db,
    games
      .filter((g) => g.stage === "playoff" && g.status === "next")
      .map((g) =>
        // Only while it's still to start, decided in the statement (#122): one being played keeps its teams and goals
        statement(
          db,
          `UPDATE tournament_games SET home_team_id = ?, away_team_id = ? WHERE id = ? AND status = 'next'
             AND NOT EXISTS (SELECT 1 FROM tournament_goals WHERE game_id = tournament_games.id)`,
          [rows[g.homeSeed! - 1]?.teamId ?? null, rows[g.awaySeed! - 1]?.teamId ?? null, g.id],
        ),
      ),
  );
}
