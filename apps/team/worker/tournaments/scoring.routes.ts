// Scoring a game as it's played (ADR 0061): the scoresheet, the clock and goals.
import { id, ok, rowOf, type Ctx, type Route } from "../api/api.route";
import { scoreGame } from "./fixtures";
import { body } from "../api/api.http";
import { addGoal, clockGame, holdScoresheet, removeGoal, undoGoal } from "./scoring";

/** The game in a path (its second number). */
const game = (c: Ctx) => Number(c.params[1]);
/**
 * A game's result once it's over, else nothing (ADR 0095): goals and the clock aren't on the record tap by tap, but as
 * one game.scored when the game ends, and again for each edit after it's ended.
 */
const finalScore = async (c: Ctx) => {
  const g = (await rowOf(
    "SELECT id, home_goals homeGoals, away_goals awayGoals, status FROM tournament_games WHERE id = ?",
    game,
  )(c)) as { status: string } | null;
  return g?.status === "done" ? g : null;
};

export const SCORING_ROUTES: Route[] = [
  {
    method: "PUT",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)$/,
    audit: {
      event: "game.scored",
      subject: rowOf(
        "SELECT id, home_goals homeGoals, away_goals awayGoals, status FROM tournament_games WHERE id = ?",
        game,
      ),
    },
    action: "score:Match",
    changes: ["tournaments"],
    // A game's final score; the last group result fills the playoffs
    handle: async (c) => (await scoreGame(c.env.DB, id(c), Number(c.params[1]), await body(c.request)), ok()),
  },
  // Scoring a game as it's played (ADR 0061): whoever holds the scoresheet
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/scorer$/,
    audit: { none: "taking or giving up the scoresheet: who holds it is on the game (keeper_member_id)" },
    action: "authenticated",
    changes: ["tournaments"],
    // { action: "claim" | "release" }: Start scoring, or let it go
    handle: async (c) => (await holdScoresheet(c.env.DB, id(c), Number(c.params[1]), await body(c.request), c), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/clock$/,
    audit: { event: "game.scored", subject: finalScore },
    action: "authenticated",
    changes: ["tournaments"],
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
    handle: async (c) => (await undoGoal(c.env.DB, id(c), Number(c.params[1]), c), ok()),
  },
  {
    method: "DELETE",
    path: /^\/api\/tournaments\/(\d+)\/games\/(\d+)\/goals\/(\d+)$/,
    audit: { event: "game.scored", subject: finalScore },
    action: "authenticated",
    changes: ["tournaments"],
    // An admin takes any goal off a finished game (scoring.ts decides who)
    handle: async (c) => (await removeGoal(c.env.DB, id(c), Number(c.params[1]), Number(c.params[2]), c), ok()),
  },
];
