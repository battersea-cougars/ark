// The Kumite simulator (ADR 0123): a dev-only tool that plays a tournament forward from wherever it is to its
// after-party, so the after-party (ADR 0074) can be tried without scoring every match by hand. Every move is one the
// app's own use cases make, as an admin would: the draft drawn, opened, each pick for the team on the clock, closed
// with the fixtures; each match's scoresheet taken, its clock started, goals (with assists) and the odd penalty
// logged as the clock runs, its periods ended and full time called, the playoffs filled from the table. It stops
// with every match played and the awards still provisional: an admin confirms them and reveals them by hand.
//
// A request makes a few moves and says whether there's more (`done`): the app asks again till it's done, so each
// request keeps well inside an invocation's D1 queries (Workers Free, ADR 0003) and the page moves as it plays. Every
// move is read from the tournament as it is, so a second run carries on where the first stopped, or says it's done.
// The dice are the Worker's crypto (draft.ts randomBelow), which the tests seed (testing.ts luck).
import { all, first } from "@cougars/shared/d1";
import { isDone } from "@cougars/shared/results";
import type { Action } from "../../src/access/actions";
import { INFRACTIONS } from "../../src/lib/penalties";
import { HttpError } from "../api/api.http";
import { drawOrder, finishDraft, openDraft, pick, randomBelow } from "./draft";
import { listGames, makeFixtures, tournamentOf, type Game } from "./fixtures";
import { addGoal, addPenalty, clockGame, holdScoresheet } from "./scoring";

/**
 * Whether the simulator exists on this Worker: only where the environment says, in so many words, that it isn't
 * production. A deploy says with SITE_ENV (scripts/ci/target.mjs: "dev" from main, "production" from release); your
 * own machine's server with TEAM_ENV "local" (vite.config.ts) and no SITE_ENV. Anything else (production, a missing
 * or unknown environment) is production here: fail closed. Elsewhere the route isn't there at all (api.ts).
 */
export const simulatorHere = (env: { SITE_ENV?: string; TEAM_ENV?: string }) =>
  env.SITE_ENV === "dev" || (env.TEAM_ENV === "local" && env.SITE_ENV === undefined);

/** Moves a request makes: each is a handful of D1 queries, so a request stays inside an invocation's 50. */
export const MOVES_PER_REQUEST = 2;

export interface Simulated {
  /** Nothing left to play: it's at the after-party. */
  done: boolean;
  /** The last move, in words: "Match 3: goal", "Full time: 3–2". */
  said: string;
}

interface Who {
  memberId: number;
  actions: Set<Action>;
}

const DONE_SAID = "Every match played: on to the after-party. Confirm the awards, then reveal them.";

/** A few moves on from where it is (`moves`), as `who` (an admin), at `now`. */
export async function simulate(
  db: D1Database,
  tournamentId: number,
  who: Who,
  now: Date,
  moves = MOVES_PER_REQUEST,
): Promise<Simulated> {
  let said = "";
  for (let i = 0; i < moves; i++) {
    const move = await nextMove(db, tournamentId, who, now);
    said = move.said;
    if (move.done) return move;
  }
  return { done: false, said };
}

/** One move, from the tournament as it is now. */
async function nextMove(db: D1Database, tournamentId: number, who: Who, now: Date): Promise<Simulated> {
  const t = await first<{ kind: string; draftState: string; status: string }>(
    db,
    "SELECT kind, draft_state draftState, status FROM tournaments WHERE id = ?",
    [tournamentId],
  );
  if (!t) throw new HttpError(404, "No such tournament.");
  const games = await listGames(db, tournamentId);
  if (games.length && isDone(t.status, games)) return { done: true, said: DONE_SAID };
  // The draft first, whatever's been made: its teams are the fixtures' teams
  if (t.kind === "draft" && t.draftState !== "closed") return draftMove(db, tournamentId, t.draftState, who);
  if (!games.length) {
    await makeFixtures(db, tournamentId);
    return { done: false, said: "Fixtures made" };
  }
  return gameMove(db, tournamentId, games, who, now);
}

/** Who's still to pick: in, not a captain, not on a team (draft.ts POOL). */
const POOL = `SELECT e.member_id id, m.position = 'G' goalie FROM tournament_entries e
              JOIN members m ON m.id = e.member_id
              WHERE e.tournament_id = ? AND e.signup = 'in'
                AND e.member_id NOT IN (SELECT captain_member_id FROM tournament_teams
                                        WHERE tournament_id = ? AND captain_member_id IS NOT NULL)
                AND e.member_id NOT IN (SELECT p.member_id FROM tournament_team_players p
                                        JOIN tournament_teams t ON t.id = p.team_id
                                        WHERE t.tournament_id = ? AND p.member_id IS NOT NULL)
              ORDER BY e.member_id`;

/**
 * The draft's next move: the order drawn and the draft opened (refused, as an admin's tap would be, while too few
 * have signed up: the simulator never signs anyone up), then a pick at random for the team on the clock, then closed
 * with the fixtures. A goalie first, while there's one and the team on the clock has none (every team wants one;
 * pick refuses a second); someone no team can take (a goalie too many) is left out once nobody else is left.
 */
async function draftMove(db: D1Database, tournamentId: number, state: string, who: Who): Promise<Simulated> {
  if (state === "none") {
    await drawOrder(db, tournamentId);
    await openDraft(db, tournamentId);
    return { done: false, said: "Order drawn, the draft's open" };
  }
  const pool = await all<{ id: number; goalie: number }>(db, POOL, [tournamentId, tournamentId, tournamentId]);
  const goaliesFirst = [...shuffled(pool.filter((p) => p.goalie)), ...shuffled(pool.filter((p) => !p.goalie))];
  for (const { id } of goaliesFirst) {
    try {
      await pick(db, tournamentId, id, who);
      return { done: false, said: "Picked" };
    } catch (e) {
      // Not for this team (a second goalie): someone else
      if (!(e instanceof HttpError) || e.status !== 409) throw e;
    }
  }
  await finishDraft(db, tournamentId, pool.length > 0);
  return { done: false, said: "The draft's closed, the fixtures are out" };
}

/** The same things in a random order. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pickOne = <T>(items: readonly T[]) => items[randomBelow(items.length)];

/** A team's people: its captain and its players. */
async function rosterOf(db: D1Database, teamId: number) {
  const rows = await all<{ id: number }>(
    db,
    `SELECT captain_member_id id FROM tournament_teams WHERE id = ? AND captain_member_id IS NOT NULL
     UNION SELECT member_id FROM tournament_team_players WHERE team_id = ? AND member_id IS NOT NULL`,
    [teamId, teamId],
  );
  return rows.map((r) => r.id);
}

/** Enough goals in one match: then the period ends. */
const MOST_GOALS = 10;

/**
 * The next move in the match up next. The scoresheet taken (from whoever had it, as an admin may), the clock started,
 * then as it runs, at random: a goal for either side, the odd penalty, or the period's end (full time in the last,
 * with a golden goal first if a playoff's level). Each at a time on the clock: a clock the simulator starts is started
 * a period ago, so its period runs out now and nothing is timed in the future.
 */
async function gameMove(db: D1Database, tournamentId: number, games: Game[], who: Who, now: Date): Promise<Simulated> {
  const game = games.find((g) => g.status !== "done")!;
  const match = `Match ${game.position}`;
  const home = game.homeTeamId;
  const away = game.awayTeamId;
  if (home === null || away === null) throw new HttpError(409, `${match}'s teams aren't known yet.`);
  if (game.keeperId !== who.memberId) {
    if (game.keeperId) await holdScoresheet(db, tournamentId, game.id, { action: "release" }, who);
    await holdScoresheet(db, tournamentId, game.id, { action: "claim" }, who);
    return { done: false, said: `${match}: scoresheet taken` };
  }
  const t = await tournamentOf(db, tournamentId);
  const full = t.gameMinutes * 60_000;
  if (game.status === "next" || !game.clockStartedAt) {
    const left = game.status === "next" ? full : (game.clockLeftMs ?? full);
    await clockGame(db, tournamentId, game.id, { action: "start" }, who, new Date(now.getTime() - left));
    return { done: false, said: `${match}: the clock's running` };
  }
  // The clock as it runs: started at `started` with `left` to go, so it runs out at `ends` (now, if we started it)
  const started = Date.parse(game.clockStartedAt);
  const left = game.clockLeftMs ?? full;
  const ends = Math.min(now.getTime(), started + left);
  // The last thing logged this period, as a time: nothing goes in before it
  const gone = full - left;
  const lastAt = Math.max(
    0,
    ...[...game.goals, ...game.penalties].filter((x) => x.period === game.period).map((x) => x.atMs ?? 0),
  );
  const last = Math.max(started, started + lastAt - gone);
  const goals = (game.homeGoals ?? 0) + (game.awayGoals ?? 0);
  const roll = randomBelow(100);
  if (roll >= 68 || goals >= MOST_GOALS || last + 30_000 >= ends) {
    const at = new Date(ends);
    if (game.period < t.periods) {
      await clockGame(db, tournamentId, game.id, { action: "period", period: game.period }, who, at);
      return { done: false, said: `${match}: end of the period` };
    }
    let { homeGoals, awayGoals } = game;
    // A playoff needs a winner: level, the next goal wins
    if (game.stage === "playoff" && (homeGoals ?? 0) === (awayGoals ?? 0)) {
      const side = randomBelow(2) ? home : away;
      await goal(db, tournamentId, game.id, side, who, at);
      if (side === home) homeGoals = (homeGoals ?? 0) + 1;
      else awayGoals = (awayGoals ?? 0) + 1;
    }
    await clockGame(db, tournamentId, game.id, { action: "end" }, who, at);
    return { done: false, said: `${match}: full time, ${homeGoals ?? 0}–${awayGoals ?? 0}` };
  }
  const at = new Date(Math.min(ends, last + 30_000 + randomBelow(Math.max(1, Math.floor((ends - last) / 2)))));
  if (roll < 60) {
    await goal(db, tournamentId, game.id, roll < 30 ? home : away, who, at);
    return { done: false, said: `${match}: goal` };
  }
  const side = randomBelow(2) ? home : away;
  const roster = await rosterOf(db, side);
  const players = INFRACTIONS.filter((i) => !i.bench);
  await addPenalty(
    db,
    tournamentId,
    game.id,
    roster.length
      ? { teamId: side, memberId: pickOne(roster), infraction: pickOne(players).value }
      : { teamId: side, infraction: "delay-of-game" },
    who,
    at,
  );
  return { done: false, said: `${match}: penalty` };
}

/** A goal for a side: someone on it scored, and most of the time someone else on it assisted. */
async function goal(db: D1Database, tournamentId: number, gameId: number, teamId: number, who: Who, at: Date) {
  const roster = shuffled(await rosterOf(db, teamId));
  const scorerId = roster[0] ?? null;
  const assistId = roster.length > 1 && randomBelow(10) < 7 ? roster[1] : null;
  await addGoal(db, tournamentId, gameId, { teamId, scorerId, assistId }, who, at);
}
