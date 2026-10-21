// Scoring a game as it's played (ADR 0061). Each game suggests a team sitting it out to keep score (scorekeepers in
// lib/fixtures.ts), but one person keeps it: whoever presses Start scoring holds the scoresheet, and nobody else can
// score that game until they let it go, or an admin does (someone had to leave: anyone can take it on from there).
// The holder starts and pauses the clock, logs each goal as it goes in (who scored, who assisted, when in game
// time), and each penalty (who, 2 or 5 minutes, what for, when), takes back the last of either, and calls full time,
// which makes the score the result. One game at a time. The score is on the game as it changes, so everyone sees it
// as it happens.
import { batch, run, statement } from "@cougars/shared/d1";
import { can, type Action } from "../../src/access/actions";
import { fillPlayoffs, listGames, tournamentOf, type Game, type TournamentRow } from "./fixtures";
import { HttpError, int, oneOf } from "../api/api.http";
import { INFRACTIONS, infractionOf, PENALTY_MINUTES } from "../../src/lib/penalties";
import { periodName } from "../../src/lib/periods";

interface Who {
  memberId: number;
  actions: ReadonlySet<Action>;
}

/** The game, and the day's games around it: one read for the whole tap (ADR 0059). */
async function gameOf(db: D1Database, tournamentId: number, gameId: number) {
  const games = await listGames(db, tournamentId);
  const game = games.find((g) => g.id === gameId);
  if (!game) throw new HttpError(404, "No such game.");
  return { game, games };
}

/** This member holds the game's scoresheet. */
function mustHold(game: Game, who: Who) {
  if (game.keeperId !== who.memberId)
    throw new HttpError(403, game.keeperId ? "Someone else is keeping score." : "Press Start scoring first.");
}

/** A finished game, and this member can put its result right: an admin's job, on the game's page. */
function mustCorrect(game: Game, who: Who) {
  if (!can(who.actions, "manage:Tournament")) throw new HttpError(403, "Only an admin can change a result.");
  if (game.status !== "done") throw new HttpError(409, "That game isn't over yet.");
}

/** The game, if this member holds its scoresheet. */
async function scorable(db: D1Database, tournamentId: number, gameId: number, who: Who) {
  const found = await gameOf(db, tournamentId, gameId);
  mustHold(found.game, who);
  return found;
}

/**
 * Start scoring (take the scoresheet, while nobody has it, for the game up next) or let it go (whoever holds it, or
 * an admin). A game that's over has nothing left to score.
 */
export async function holdScoresheet(
  db: D1Database,
  tournamentId: number,
  gameId: number,
  o: Record<string, unknown>,
  who: Who,
) {
  const action = oneOf(o, "action", ["claim", "release"] as const);
  const { game, games } = await gameOf(db, tournamentId, gameId);
  if (action === "claim") {
    if (game.keeperId === who.memberId) return;
    if (game.keeperId) throw new HttpError(409, "Someone else is keeping score.");
    if (game.status === "done") throw new HttpError(409, "That game's over.");
    // The game up next (or on now): the first in the day's order that isn't over
    const upNext = games.find((g) => g.status !== "done");
    if (upNext?.id !== gameId) throw new HttpError(409, `Game ${upNext?.position ?? ""} is up next: score that one.`);
    // Only if nobody's taken it in the meantime
    const res = await run(
      db,
      "UPDATE tournament_games SET keeper_member_id = ? WHERE id = ? AND keeper_member_id IS NULL",
      [who.memberId, gameId],
    );
    if (!res.meta.changes) throw new HttpError(409, "Someone else is keeping score.");
    return;
  }
  if (game.keeperId !== who.memberId && !can(who.actions, "manage:Tournament"))
    throw new HttpError(403, "Only whoever's keeping score, or an admin, can let it go.");
  await run(db, "UPDATE tournament_games SET keeper_member_id = NULL WHERE id = ?", [gameId]);
}

/** Time left on the clock now. */
const leftNow = (g: Game, now: Date) =>
  Math.max(0, (g.clockLeftMs ?? 0) - (g.clockStartedAt ? now.getTime() - Date.parse(g.clockStartedAt) : 0));

/**
 * The clock: start (or start again), pause, set (the time left, by the scorekeeper's watch: paused, or running on from
 * there), period (the period said is over: the next starts paused at full length after the break, which runs from
 * now until the scorekeeper starts it; said twice, it's already done), or
 * end (full time: the score's the result).
 */
export async function clockGame(
  db: D1Database,
  tournamentId: number,
  gameId: number,
  o: Record<string, unknown>,
  who: Who,
  now: Date,
) {
  const action = oneOf(o, "action", ["start", "pause", "set", "period", "end"] as const);
  const { game, games } = await scorable(db, tournamentId, gameId, who);
  const t = await tournamentOf(db, tournamentId);
  if (action === "start") {
    if (game.status === "done") throw new HttpError(409, "That game's over.");
    // The game up next (or on now): the first in the day's order that isn't over
    const upNext = games.find((g) => g.status !== "done");
    if (upNext?.id !== gameId) throw new HttpError(409, `Game ${upNext?.position ?? ""} is up next: score that one.`);
    if (game.homeTeamId === null || game.awayTeamId === null)
      throw new HttpError(409, "This game's teams aren't known yet.");
    if (game.clockStartedAt) throw new HttpError(409, "The clock's already running.");
    if (game.status === "next") {
      const other = games.find((g) => g.status === "live");
      if (other) throw new HttpError(409, `Game ${other.position}'s still on. Call full time on it first.`);
      await run(
        db,
        `UPDATE tournament_games SET status = 'live', home_goals = 0, away_goals = 0, clock_left_ms = ?,
           clock_started_at = ? WHERE id = ?`,
        [t.gameMinutes * 60_000, now.toISOString(), gameId],
      );
    } else
      // Starting the next period ends the break before it
      await run(db, "UPDATE tournament_games SET clock_started_at = ?, period_ended_at = NULL WHERE id = ?", [
        now.toISOString(),
        gameId,
      ]);
    return;
  }
  if (game.status !== "live") throw new HttpError(409, "That game isn't on.");
  if (action === "set") {
    const leftMs = int(o, "leftMs", { max: 60 * 60_000 })!;
    await run(db, "UPDATE tournament_games SET clock_left_ms = ?, clock_started_at = ? WHERE id = ?", [
      leftMs,
      game.clockStartedAt ? now.toISOString() : null,
      gameId,
    ]);
    return;
  }
  if (action === "period") {
    const ending = int(o, "period", { min: 1, max: 3 });
    // Already moved on (another phone, a retry): nothing to do
    if (ending < game.period) return;
    if (ending > game.period) throw new HttpError(409, `It's the ${periodName(game.period)} period.`);
    if (game.period >= t.periods) throw new HttpError(409, "That's the last period: call full time.");
    // Only from the period said: the same end sent by two phones at once moves on once
    await run(
      db,
      `UPDATE tournament_games SET period = period + 1, clock_left_ms = ?, clock_started_at = NULL, period_ended_at = ?
       WHERE id = ? AND period = ? AND status = 'live'`,
      [t.gameMinutes * 60_000, now.toISOString(), gameId, ending],
    );
    return;
  }
  if (action === "pause") {
    if (!game.clockStartedAt) return;
    await run(db, "UPDATE tournament_games SET clock_left_ms = ?, clock_started_at = NULL WHERE id = ?", [
      leftNow(game, now),
      gameId,
    ]);
    return;
  }
  // Full time. A playoff needs a winner: level, it plays on and the next goal wins (it's then a full time like any other)
  if (game.stage === "playoff" && (game.homeGoals ?? 0) === (game.awayGoals ?? 0))
    throw new HttpError(409, "It's level, and a playoff needs a winner: play on, next goal wins.");
  await run(
    db,
    "UPDATE tournament_games SET status = 'done', clock_left_ms = ?, clock_started_at = NULL WHERE id = ?",
    [leftNow(game, now), gameId],
  );
  if (game.stage === "group") await fillPlayoffs(db, tournamentId, t);
}

/**
 * Which period a goal or penalty was in: the one being played, or for an admin's after the game, the one they say (the
 * 1st unless said), none with no time.
 */
const periodOf = (o: Record<string, unknown>, done: boolean, atMs: number | null, game: Game, t: TournamentRow) =>
  !done ? game.period : atMs === null ? null : o.period == null ? 1 : int(o, "period", { min: 1, max: t.periods });

/**
 * SQL: the game is still as the tap found it, when its goal or penalty lands: on, with this scorekeeper holding the
 * sheet, or over, for an admin's correction. A goal sent just as full time is called is refused, never counted after
 * the result. Params: the game, then the scorekeeper (unused once it's over).
 */
const stillAsFound = (done: boolean) =>
  done
    ? "EXISTS (SELECT 1 FROM tournament_games WHERE id = ? AND status = 'done' AND ? IS NOT NULL)"
    : "EXISTS (SELECT 1 FROM tournament_games WHERE id = ? AND status = 'live' AND keeper_member_id = ?)";
const tooLate = (done: boolean) =>
  new HttpError(409, done ? "That game's back on." : "That game's over: full time's been called.");

/** Someone on this team: its captain or one of its players. */
const onTeam = (db: D1Database, teamId: number, memberId: number) =>
  statement(
    db,
    `SELECT 1 FROM tournament_teams t WHERE t.id = ? AND (t.captain_member_id = ? OR EXISTS
       (SELECT 1 FROM tournament_team_players p WHERE p.team_id = t.id AND p.member_id = ?))`,
    [teamId, memberId, memberId],
  );

/** A finished game, if this member can put its result right (mustCorrect). */
async function correctable(db: D1Database, tournamentId: number, gameId: number, who: Who) {
  const { game } = await gameOf(db, tournamentId, gameId);
  mustCorrect(game, who);
  return game;
}

/**
 * A goal: as it goes in (the scorekeeper, the game on, timed by the clock), or one missed on the day (an admin, the
 * game over, at the time they say or none). Its team, who scored and who assisted (both optional, both on that team).
 */
export async function addGoal(
  db: D1Database,
  tournamentId: number,
  gameId: number,
  o: Record<string, unknown>,
  who: Who,
  now: Date,
) {
  const { game } = await gameOf(db, tournamentId, gameId);
  const done = game.status === "done";
  if (done) mustCorrect(game, who);
  else mustHold(game, who);
  if (!done && game.status !== "live") throw new HttpError(409, "That game isn't on.");
  const teamId = int(o, "teamId")!;
  if (teamId !== game.homeTeamId && teamId !== game.awayTeamId) throw new HttpError(400, "That team isn't playing.");
  const scorerId = o.scorerId == null ? null : int(o, "scorerId");
  const assistId = o.assistId == null ? null : int(o, "assistId");
  // Both asked at once
  const named = [scorerId, assistId].filter((m) => m !== null);
  const found = await batch(
    db,
    named.map((m) => onTeam(db, teamId, m)),
  );
  if (found.some((r) => !r.results.length)) throw new HttpError(400, "They're not on that team.");
  if (scorerId !== null && scorerId === assistId) throw new HttpError(400, "Nobody assists their own goal.");
  const t = await tournamentOf(db, tournamentId);
  const atMs = done
    ? o.atMs == null
      ? null
      : int(o, "atMs", { max: t.gameMinutes * 60_000 })
    : t.gameMinutes * 60_000 - leftNow(game, now);
  // The goal and the score it makes in one batch: full time landing between them would make the result without it
  const [res] = await batch(db, [
    statement(
      db,
      `INSERT INTO tournament_goals (game_id, team_id, scorer_member_id, assist_member_id, at_ms, period, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${stillAsFound(done)}`,
      [
        gameId,
        teamId,
        scorerId,
        assistId,
        atMs,
        periodOf(o, done, atMs, game, t),
        now.toISOString(),
        gameId,
        who.memberId,
      ],
    ),
    recount(db, game),
  ]);
  if (!res.meta.changes) throw tooLate(done);
  if (done && game.stage === "group") await fillPlayoffs(db, tournamentId, t);
}

/** Any goal off a finished game: it wasn't one, or it was the other side's. */
export async function removeGoal(db: D1Database, tournamentId: number, gameId: number, goalId: number, who: Who) {
  const game = await correctable(db, tournamentId, gameId, who);
  const [res] = await batch(db, [
    statement(db, "DELETE FROM tournament_goals WHERE id = ? AND game_id = ?", [goalId, gameId]),
    recount(db, game),
  ]);
  if (!res.meta.changes) throw new HttpError(404, "No such goal.");
  // The playoffs from the table
  if (game.stage === "group") await fillPlayoffs(db, tournamentId, await tournamentOf(db, tournamentId));
}

/** The last goal comes off: logged by mistake. */
export async function undoGoal(db: D1Database, tournamentId: number, gameId: number, who: Who) {
  const { game } = await scorable(db, tournamentId, gameId, who);
  if (game.status !== "live") throw new HttpError(409, "That game isn't on.");
  // As a goal goes in: off, and the score with it, in one batch
  const [res] = await batch(db, [
    statement(
      db,
      `DELETE FROM tournament_goals WHERE id = (SELECT max(id) FROM tournament_goals WHERE game_id = ?) AND ${stillAsFound(false)}`,
      [gameId, gameId, who.memberId],
    ),
    recount(db, game),
  ]);
  if (!res.meta.changes) throw new HttpError(409, "No goals to take back.");
}

/**
 * A penalty, kept the way goals are: as it's called (the scorekeeper, the game on, timed by the clock), or one missed
 * on the day (an admin, the game over, at the time they say or none). Its team; who (optional: a bench penalty, or
 * on that team; a bench infraction may be on nobody); 2, 4 or 5 minutes (the tournament's usual length unless said; some only 2); what for (always).
 */
export async function addPenalty(
  db: D1Database,
  tournamentId: number,
  gameId: number,
  o: Record<string, unknown>,
  who: Who,
  now: Date,
) {
  const { game } = await gameOf(db, tournamentId, gameId);
  const done = game.status === "done";
  if (done) mustCorrect(game, who);
  else mustHold(game, who);
  if (!done && game.status !== "live") throw new HttpError(409, "That game isn't on.");
  const teamId = int(o, "teamId")!;
  if (teamId !== game.homeTeamId && teamId !== game.awayTeamId) throw new HttpError(400, "That team isn't playing.");
  const memberId = o.memberId == null ? null : int(o, "memberId");
  if (memberId !== null && !(await onTeam(db, teamId, memberId).first()))
    throw new HttpError(400, "They're not on that team.");
  // Always for something; a player's infraction is on someone, a bench one may be on nobody
  const infraction = infractionOf(
    oneOf(
      o,
      "infraction",
      INFRACTIONS.map((i) => i.value),
    ),
  )!;
  if (!infraction.bench && memberId === null) throw new HttpError(400, "Who's it on?");
  const t = await tournamentOf(db, tournamentId);
  // Unless said, the tournament's usual length (a minor-only infraction is always 2)
  const minutes = o.minutes != null ? int(o, "minutes") : infraction.minorOnly ? 2 : t.defaultPenaltyMinutes;
  if (!(PENALTY_MINUTES as readonly number[]).includes(minutes))
    throw new HttpError(400, "A penalty's 2, 4 (a double minor) or 5 minutes.");
  if (infraction.minorOnly && minutes !== 2) throw new HttpError(400, `${infraction.label} is a minor: 2 minutes.`);
  const atMs = done
    ? o.atMs == null
      ? null
      : int(o, "atMs", { max: t.gameMinutes * 60_000 })
    : t.gameMinutes * 60_000 - leftNow(game, now);
  const res = await run(
    db,
    `INSERT INTO tournament_penalties (game_id, team_id, member_id, minutes, infraction, at_ms, period, recorded_by,
       created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${stillAsFound(done)}`,
    [
      gameId,
      teamId,
      memberId,
      minutes,
      infraction.value,
      atMs,
      periodOf(o, done, atMs, game, t),
      who.memberId,
      now.toISOString(),
      gameId,
      who.memberId,
    ],
  );
  if (!res.meta.changes) throw tooLate(done);
}

/** Any penalty off a finished game: an admin putting it right. */
export async function removePenalty(db: D1Database, tournamentId: number, gameId: number, penaltyId: number, who: Who) {
  await correctable(db, tournamentId, gameId, who);
  const res = await run(db, "DELETE FROM tournament_penalties WHERE id = ? AND game_id = ?", [penaltyId, gameId]);
  if (!res.meta.changes) throw new HttpError(404, "No such penalty.");
}

/** The last penalty comes off: logged by mistake. */
export async function undoPenalty(db: D1Database, tournamentId: number, gameId: number, who: Who) {
  const { game } = await scorable(db, tournamentId, gameId, who);
  if (game.status !== "live") throw new HttpError(409, "That game isn't on.");
  const res = await run(
    db,
    `DELETE FROM tournament_penalties WHERE id = (SELECT max(id) FROM tournament_penalties WHERE game_id = ?) AND ${stillAsFound(false)}`,
    [gameId, gameId, who.memberId],
  );
  if (!res.meta.changes) throw new HttpError(409, "No penalties to take back.");
}

/** The score on the game, from its goals: what everyone sees. Sent in the same batch as the change to its goals, so
 * nothing (full time's result above all) reads a goal without its score. */
const recount = (db: D1Database, game: Game) =>
  statement(
    db,
    `UPDATE tournament_games SET
       home_goals = (SELECT count(*) FROM tournament_goals WHERE game_id = ? AND team_id = ?),
       away_goals = (SELECT count(*) FROM tournament_goals WHERE game_id = ? AND team_id = ?)
     WHERE id = ?`,
    [game.id, game.homeTeamId, game.id, game.awayTeamId, game.id],
  );
