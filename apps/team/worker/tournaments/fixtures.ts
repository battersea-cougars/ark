// A tournament's fixtures, results and playoffs (ADR 0061). Once it has two teams (a captains' draft's captains, or the
// teams that entered), an admin has the app make the fixtures: a round robin, every team playing every other once
// (lib/fixtures.ts), then the playoff games its settings ask for, by table position. They can be made again until a
// game has a result. When the last group game has its result, the playoffs get their teams from the table.
import { all, batch, first, run, statement } from "@cougars/shared/d1";
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

/** An admin has the app make the fixtures: the round robin, then the playoffs waiting on the table. */
export async function makeFixtures(db: D1Database, id: number) {
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

  const rounds = roundRobin(teams);
  const rows: (string | number | null)[][] = [];
  rounds.forEach((games, r) =>
    games.forEach(([home, away]) => rows.push([id, "group", r + 1, rows.length + 1, "", home, away, null, null])),
  );
  for (const p of playoffs)
    rows.push([id, "playoff", rounds.length + 1, rows.length + 1, p.name, null, null, p.home, p.away]);
  await batch(db, [
    statement(
      db,
      "DELETE FROM tournament_goals WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id = ?)",
      [id],
    ),
    statement(
      db,
      "DELETE FROM tournament_penalties WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id = ?)",
      [id],
    ),
    statement(db, "DELETE FROM tournament_games WHERE tournament_id = ?", [id]),
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
  await run(db, "UPDATE tournament_games SET home_goals = ?, away_goals = ?, status = 'done' WHERE id = ?", [
    homeGoals,
    awayGoals,
    gameId,
  ]);
  await matchGoals(db, gameId, game.homeTeamId, homeGoals);
  await matchGoals(db, gameId, game.awayTeamId, awayGoals);
  if (game.stage === "group") await fillPlayoffs(db, tournamentId, t);
}

/** One side's goals made to match its score. */
export async function matchGoals(db: D1Database, gameId: number, teamId: number, score: number) {
  const have =
    (
      await first<{ n: number }>(db, "SELECT count(*) n FROM tournament_goals WHERE game_id = ? AND team_id = ?", [
        gameId,
        teamId,
      ])
    )?.n ?? 0;
  const at = new Date().toISOString();
  await batch(
    db,
    Array.from({ length: Math.max(0, score - have) }, () =>
      statement(db, "INSERT INTO tournament_goals (game_id, team_id, at_ms, created_at) VALUES (?, ?, NULL, ?)", [
        gameId,
        teamId,
        at,
      ]),
    ),
  );
  if (have > score)
    await run(
      db,
      `DELETE FROM tournament_goals WHERE id IN (SELECT id FROM tournament_goals WHERE game_id = ? AND team_id = ?
         ORDER BY scorer_member_id IS NULL DESC, at_ms IS NULL DESC, at_ms DESC, id DESC LIMIT ?)`,
      [gameId, teamId, have - score],
    );
}

export async function fillPlayoffs(db: D1Database, tournamentId: number, t: TournamentRow) {
  const games = await listGames(db, tournamentId);
  const group = games.filter((g) => g.stage === "group");
  if (group.some((g) => g.status !== "done")) return;
  const rows = table(await teamIdsOf(db, tournamentId), group, { win: t.win, draw: t.draw, loss: t.loss });
  await batch(
    db,
    games
      .filter((g) => g.stage === "playoff" && g.status !== "done")
      .map((g) =>
        statement(db, "UPDATE tournament_games SET home_team_id = ?, away_team_id = ? WHERE id = ?", [
          rows[g.homeSeed! - 1]?.teamId ?? null,
          rows[g.awaySeed! - 1]?.teamId ?? null,
          g.id,
        ]),
      ),
  );
}
