// Scoring a game as it's played (ADR 0130): the scoresheet, the clock and goals.
import { id, ok, rowOf, type Ctx, type Route } from "../api/api.route";
import { scoreGame } from "./fixtures";
import { body, int } from "../api/api.http";
import {
  addGoal,
  addPenalty,
  clockGame,
  holdScoresheet,
  overrideScoresheet,
  removeGoal,
  removePenalty,
  undoGoal,
  undoPenalty,
} from "./scoring";

/** The game in a path (its second number). */
const game = (c: Ctx) => Number(c.params[1]);
/** The goal or penalty an Undo names (`?goal=`, `?penalty=`), if it does. */
const named = (c: Ctx, key: string) => {
  const v = new URL(c.request.url).searchParams.get(key);
  return v === null ? null : int({ [key]: Number(v) }, key, { max: Number.MAX_SAFE_INTEGER });
};
/** A game's result as it's on the record: its score, and its penalty minutes. */
const RESULT = `SELECT id, home_goals homeGoals, away_goals awayGoals, status,
    (SELECT coalesce(sum(minutes), 0) FROM tournament_penalties WHERE game_id = g.id) penaltyMinutes
  FROM tournament_games g WHERE id = ?`;
/**
 * A game's result once it's over, else nothing (ADR 0095): goals, penalties and the clock aren't on the record tap by
 * tap, but as one game.scored when the game ends, and again for each edit after it's ended.
 */
const finalScore = async (c: Ctx) => {
  const g = (await rowOf(RESULT, game)(c)) as { status: string } | null;
  return g?.status === "done" ? g : null;
};

export const SCORING_ROUTES: Route[] = [
  {
    method: "PUT",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)$/,
    audit: {
      event: "game.scored",
      subject: rowOf(RESULT, game),
    },
    action: "score:Match",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // A game's final score; the last group result fills the playoffs
    handle: async (c) => (await scoreGame(c.env.DB, id(c), Number(c.params[1]), await body(c.request)), ok()),
  },
  // Scoring a game as it's played (ADR 0130): whoever holds the scoresheet
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/scorer$/,
    audit: { none: "taking or giving up the scoresheet: who holds it is on the game (keeper_member_id)" },
    action: "authenticated",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // { action: "claim" | "release" }: Start scoring, or let it go
    handle: async (c) => (await holdScoresheet(c.env.DB, id(c), Number(c.params[1]), await body(c.request), c), ok()),
  },
  // An admin's say over someone's scoresheet (#116): take it over, or free it. On the record, unlike holding your own
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/scorer\/admin$/,
    audit: {
      event: "game.keeper_changed",
      subject: rowOf(
        `SELECT g.position game, m.name keeper FROM tournament_games g
         LEFT JOIN members m ON m.id = g.keeper_member_id WHERE g.id = ?`,
        game,
      ),
    },
    action: "manage:Tournament",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // { action: "takeover" | "free", from: the keeper the admin's page saw, or null }
    handle: async (c) => (
      await overrideScoresheet(c.env.DB, id(c), Number(c.params[1]), await body(c.request), c),
      ok()
    ),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/clock$/,
    audit: { event: "game.scored", subject: finalScore },
    action: "authenticated",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // { action: "start" | "pause" | "end" }
    handle: async (c) => (
      await clockGame(c.env.DB, id(c), Number(c.params[1]), await body(c.request), c, new Date(c.now)),
      ok()
    ),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/goals$/,
    audit: { event: "game.scored", subject: finalScore },
    action: "authenticated",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // { teamId, scorerId?, assistId? }
    handle: async (c) => (
      await addGoal(c.env.DB, id(c), Number(c.params[1]), await body(c.request), c, new Date(c.now)),
      ok()
    ),
  },
  {
    method: "DELETE",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/goals\/last$/,
    audit: { event: "game.scored", subject: finalScore },
    action: "authenticated",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // ?goal=: the last goal the page shows, so Undo tapped twice takes it off once (#114)
    handle: async (c) => (await undoGoal(c.env.DB, id(c), Number(c.params[1]), c, named(c, "goal")), ok()),
  },
  {
    method: "DELETE",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/goals\/(\d+)$/,
    audit: { event: "game.scored", subject: finalScore },
    action: "authenticated",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // An admin takes any goal off a finished game (scoring.ts decides who)
    handle: async (c) => (await removeGoal(c.env.DB, id(c), Number(c.params[1]), Number(c.params[2]), c), ok()),
  },
  // Penalties, kept the way goals are
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/penalties$/,
    audit: { event: "game.scored", subject: finalScore },
    action: "authenticated",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // { teamId, memberId?, minutes?, infraction?, atMs? }
    handle: async (c) => (
      await addPenalty(c.env.DB, id(c), Number(c.params[1]), await body(c.request), c, new Date(c.now)),
      ok()
    ),
  },
  {
    method: "DELETE",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/penalties\/last$/,
    audit: { event: "game.scored", subject: finalScore },
    action: "authenticated",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // ?penalty=: the last penalty the page shows (#114)
    handle: async (c) => (await undoPenalty(c.env.DB, id(c), Number(c.params[1]), c, named(c, "penalty")), ok()),
  },
  {
    method: "DELETE",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/penalties\/(\d+)$/,
    audit: { event: "game.scored", subject: finalScore },
    action: "authenticated",
    changes: ["tournaments"],
    calendar: false,
    liveMatch: true,
    // An admin takes any penalty off a finished game (scoring.ts decides who)
    handle: async (c) => (await removePenalty(c.env.DB, id(c), Number(c.params[1]), Number(c.params[2]), c), ok()),
  },
];
