// The Kumite simulator (ADR 0123): a dev-only tool that plays a tournament forward from wherever it is to its
// after-party, so the after-party (ADR 0074) can be tried without scoring every match by hand. Every move is one the
// app's own use cases make, as an admin would: the draft drawn, opened, each pick for the team on the clock, closed
// with the fixtures; each match's scoresheet taken, its clock started, goals (with assists) and the odd penalty
// logged as the clock runs, its periods ended and full time called, the playoffs filled from the table. It stops
// with every match played and the awards still provisional: an admin confirms them and reveals them by hand.
//
// A move is one thing you'd see (a pick, a goal, a period's end), and says what it was and whether there's more
// (`done`): the app asks again, paced so each lands on the page before the next (lib/simulation.ts), so it can be
// watched, paused and stopped. A request makes one move, or at Spin kick a few (`simulateMoves`), as many as fit in
// an invocation's D1 queries (Workers Free stops one at 50) with room to spare. Every move is read from the
// tournament as it is, so a second run carries on where the first stopped, or says it's done.
// The dice are the Worker's crypto (draft.ts randomBelow), which the tests seed (testing.ts luck).
//
// On its own day (`onItsDay`, a Kumite dated in the past, past-day.ts): every clock is the evening's, not now, a match
// after the one before (on-its-day.ts), so it's played that evening and goes to history; and it goes on past the
// matches: the awards confirmed (the stats', a draw's, a vote's and the judges' call chosen at random) and each one
// revealed, so the Kumite has a whole evening behind it.
import { all, first } from "@cougars/shared/d1";
import { isDone } from "@cougars/shared/results";
import type { Action } from "../../src/access/actions";
import { MOST_MOVES, type MoveKind } from "../../src/lib/simulation";
import { INFRACTIONS } from "../../src/lib/penalties";
import { HttpError } from "../api/api.http";
import { drawOrder, finishDraft, goaliesFirst, isDrawn, openDraft, pick, randomBelow, shuffled } from "./draft";
import { listGames, makeFixtures, tournamentOf, type Game } from "./fixtures";
import { addGoal, addPenalty, clockGame, holdScoresheet } from "./scoring";
import { awardsMove, eveningClock, type Evening } from "./on-its-day";
import { londonToday } from "../../src/lib/dates";

/**
 * Whether the simulator exists on this Worker: only where the environment says, in so many words, that it isn't
 * production. A deploy says with SITE_ENV (scripts/ci/target.mjs: "dev" from main, "production" from release); your
 * own machine's server with TEAM_ENV "local" (vite.config.ts) and no SITE_ENV. Anything else (production, a missing
 * or unknown environment) is production here: fail closed. Elsewhere the route isn't there at all (api.ts).
 */
export const simulatorHere = (env: { SITE_ENV?: string; TEAM_ENV?: string }) =>
  env.SITE_ENV === "dev" || (env.TEAM_ENV === "local" && env.SITE_ENV === undefined);

export interface Simulated {
  /** Nothing left to play: it's at the after-party. */
  done: boolean;
  /** What the move was, so the app waits the right while before the next (a pick's turn change, a goal). */
  move: MoveKind;
  /** The move, in words: "Match 3: goal", "Match 3: full time, 3–2". */
  said: string;
}

interface Who {
  memberId: number;
  actions: Set<Action>;
}

/** A few moves in one request (Spin kick): how many were made, and the last. */
export interface SimulatedMoves extends Simulated {
  moves: number;
}

/**
 * The D1 queries a request's moves may use: 30. The request around them (who's asking, the limits, the audit's read
 * before and after and its entry, the version, the parts sent back) takes about 11 more, and the live hub one
 * subrequest, so even the worst request is about 42, well under Workers Free's 50 (the use-case test counts them).
 */
export const MOVES_QUERIES = 30;

/**
 * The most D1 queries one move can take, by what came before it: while the draft's on, the next may be a pick or the
 * draft closed with its fixtures (the dearest); in the matches, the dearest is full time. The use-case test checks
 * that no move takes more.
 */
export const MOVE_QUERIES = { draft: 24, match: 10 };

/** What the next move may be, from the last: the draft's, till it's closed. */
const nextIs = (last: MoveKind) => (last === "order" || last === "open" || last === "pick" ? "draft" : "match");

/**
 * Up to `asked` moves on (clamped to 1..MOST_MOVES), as `simulate`, stopping when it's done, when another move might
 * not fit in MOVES_QUERIES, or at a refusal after the first move (made moves stand; the next request meets it).
 */
export async function simulateMoves(
  db: D1Database,
  tournamentId: number,
  who: Who,
  now: Date,
  asked: number,
  onItsDay = false,
): Promise<SimulatedMoves> {
  const most = Math.min(MOST_MOVES, Math.max(1, Math.floor(Number(asked)) || 1));
  const counted = countingQueries(db);
  let last = await simulate(counted.db, tournamentId, who, now, onItsDay);
  let moves = last.done ? 0 : 1;
  while (!last.done && moves < most && counted.used() + MOVE_QUERIES[nextIs(last.move)] <= MOVES_QUERIES) {
    try {
      const next = await simulate(counted.db, tournamentId, who, now, onItsDay);
      if (next.done) break;
      last = next;
      moves++;
    } catch (e) {
      if (e instanceof HttpError) break;
      throw e;
    }
  }
  return { ...last, moves };
}

/**
 * The database, counting the queries sent through it: each `first`, `all`, `run` or `raw` one, a `batch` one (a
 * round trip, as the tests' D1 counts them).
 */
function countingQueries(db: D1Database) {
  let used = 0;
  const real = new WeakMap<object, D1PreparedStatement>();
  const counted = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(stmt, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key === "bind") return (...params: unknown[]) => counted(value.apply(target, params));
        if (key === "first" || key === "all" || key === "run" || key === "raw")
          return (...args: unknown[]) => {
            used++;
            return value.apply(target, args);
          };
        return value.bind(target);
      },
    });
    real.set(wrapped, stmt);
    return wrapped;
  };
  const wrapped = new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "prepare") return (sql: string) => counted(target.prepare(sql));
      if (key === "batch")
        return (statements: D1PreparedStatement[]) => {
          used++;
          return target.batch(statements.map((s) => real.get(s) ?? s));
        };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: wrapped, used: () => used };
}

const DONE_SAID = "Every match played: on to the after-party. Confirm the awards, then reveal them.";

/**
 * One move on from where it is, as `who` (an admin), at `now`: one change of the app's own (one guarded write). On its
 * own day (`onItsDay`), at the evening's time instead, and on through the awards.
 */
export async function simulate(
  db: D1Database,
  tournamentId: number,
  who: Who,
  now: Date,
  onItsDay = false,
): Promise<Simulated> {
  const t = await first<{ kind: string; draftState: string; status: string } & Evening>(
    db,
    `SELECT kind, draft_state draftState, status, held_on heldOn, start_time startTime, game_minutes gameMinutes,
            periods, break_minutes breakMinutes, awards_revealed revealed, awards_next next
     FROM tournaments WHERE id = ?`,
    [tournamentId],
  );
  if (!t) throw new HttpError(404, "No such tournament.");
  if (onItsDay && t.heldOn >= londonToday(now))
    throw new HttpError(409, "Its day hasn't gone by: play it out as it is, tonight.");
  const games = await listGames(db, tournamentId);
  if (onItsDay) now = eveningClock(t, games);
  if (games.length && isDone(t.status, games))
    return onItsDay ? awardsMove(db, tournamentId, t, now) : { done: true, move: "done", said: DONE_SAID };
  // The draft first, whatever's been made: its teams are the fixtures' teams
  if (t.kind === "draft" && t.draftState !== "closed") return draftMove(db, tournamentId, t.draftState, who);
  if (!games.length) {
    await makeFixtures(db, tournamentId);
    return { done: false, move: "fixtures", said: "The fixtures are out" };
  }
  return gameMove(db, tournamentId, games, who, now);
}

/** Who's still to pick: in, not a captain, not on a team (draft.ts POOL). */
const POOL = `SELECT e.member_id id, m.name, m.position = 'G' goalie FROM tournament_entries e
              JOIN members m ON m.id = e.member_id
              WHERE e.tournament_id = ? AND e.signup = 'in'
                AND e.member_id NOT IN (SELECT captain_member_id FROM tournament_teams
                                        WHERE tournament_id = ? AND captain_member_id IS NOT NULL)
                AND e.member_id NOT IN (SELECT p.member_id FROM tournament_team_players p
                                        JOIN tournament_teams t ON t.id = p.team_id
                                        WHERE t.tournament_id = ? AND p.member_id IS NOT NULL)
              ORDER BY e.member_id`;

/**
 * The draft's next move: the order drawn, then the draft opened (refused, as an admin's tap would be, while too few
 * have signed up: the simulator never signs anyone up), then a pick at random for the team on the clock, then closed
 * with the fixtures. A goalie first, while there's one and the team on the clock has none (every team wants one;
 * pick refuses a second); someone no team can take (a goalie too many) is left out once nobody else is left.
 */
async function draftMove(db: D1Database, tournamentId: number, state: string, who: Who): Promise<Simulated> {
  if (state === "none") {
    if (!(await isDrawn(db, tournamentId))) {
      await drawOrder(db, tournamentId);
      return { done: false, move: "order", said: "The pick order's drawn" };
    }
    await openDraft(db, tournamentId);
    return { done: false, move: "open", said: "The draft's open" };
  }
  const pool = await all<{ id: number; name: string; goalie: number }>(db, POOL, [
    tournamentId,
    tournamentId,
    tournamentId,
  ]);
  for (const { id, name } of goaliesFirst(pool)) {
    try {
      await pick(db, tournamentId, id, who);
      return { done: false, move: "pick", said: `Picked: ${name}` };
    } catch (e) {
      // Not for this team (a second goalie): someone else
      if (!(e instanceof HttpError) || e.status !== 409) throw e;
    }
  }
  await finishDraft(db, tournamentId, pool.length > 0);
  return { done: false, move: "close", said: "The draft's closed, the fixtures are out" };
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
 * The next move in the match up next. The scoresheet freed (from whoever had it, as an admin may) and taken, the
 * clock started, then as it runs, at random: a goal for either side, the odd penalty, or the period's end (full time
 * in the last, a golden goal first, its own move, if a playoff's level). Each at a time on the clock: a clock the simulator starts is started
 * a period ago, so its period runs out now and nothing is timed in the future.
 */
async function gameMove(db: D1Database, tournamentId: number, games: Game[], who: Who, now: Date): Promise<Simulated> {
  const game = games.find((g) => g.status !== "done")!;
  const match = `Match ${game.position}`;
  const home = game.homeTeamId;
  const away = game.awayTeamId;
  if (home === null || away === null) throw new HttpError(409, `${match}'s teams aren't known yet.`);
  if (game.keeperId && game.keeperId !== who.memberId) {
    await holdScoresheet(db, tournamentId, game.id, { action: "release" }, who);
    return { done: false, move: "scoresheet", said: `${match}: scoresheet freed` };
  }
  if (game.keeperId !== who.memberId) {
    await holdScoresheet(db, tournamentId, game.id, { action: "claim" }, who);
    return { done: false, move: "scoresheet", said: `${match}: scoresheet taken` };
  }
  const t = await tournamentOf(db, tournamentId);
  const full = t.gameMinutes * 60_000;
  if (game.status === "next" || !game.clockStartedAt) {
    const left = game.status === "next" ? full : (game.clockLeftMs ?? full);
    await clockGame(db, tournamentId, game.id, { action: "start" }, who, new Date(now.getTime() - left));
    return { done: false, move: "clock", said: `${match}: the clock's running` };
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
      return { done: false, move: "period", said: `${match}: end of the period` };
    }
    const { homeGoals, awayGoals } = game;
    // A playoff needs a winner: level, the next goal wins (at the buzzer, so the move after is full time)
    if (game.stage === "playoff" && (homeGoals ?? 0) === (awayGoals ?? 0)) {
      await goal(db, tournamentId, game.id, randomBelow(2) ? home : away, who, at);
      return { done: false, move: "goal", said: `${match}: golden goal` };
    }
    await clockGame(db, tournamentId, game.id, { action: "end" }, who, at);
    return { done: false, move: "fulltime", said: `${match}: full time, ${homeGoals ?? 0}–${awayGoals ?? 0}` };
  }
  const at = new Date(Math.min(ends, last + 30_000 + randomBelow(Math.max(1, Math.floor((ends - last) / 2)))));
  if (roll < 60) {
    await goal(db, tournamentId, game.id, roll < 30 ? home : away, who, at);
    return { done: false, move: "goal", said: `${match}: goal` };
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
  return { done: false, move: "penalty", said: `${match}: penalty` };
}

/** A goal for a side: someone on it scored, and most of the time someone else on it assisted. */
async function goal(db: D1Database, tournamentId: number, gameId: number, teamId: number, who: Who, at: Date) {
  const roster = shuffled(await rosterOf(db, teamId));
  const scorerId = roster[0] ?? null;
  const assistId = roster.length > 1 && randomBelow(10) < 7 ? roster[1] : null;
  await addGoal(db, tournamentId, gameId, { teamId, scorerId, assistId }, who, at);
}
