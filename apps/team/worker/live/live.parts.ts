// What a change sends down the live streams besides the names of the parts it changed (ADR 0072, #161), and who it
// goes to: the one place that's decided. A live match, a tournament's games on its day, is the same for every member
// (nothing in a game is anyone's own), so it's built once and goes to everyone: at the rink, where the whole squad
// shares one wifi address, a goal is then no read at all on the phones following it. Everything else stays names only,
// each phone reading its own view: what's someone's own (dues, sign-ups, members, roles) and the draft, whose picks
// only its captains and whoever runs it see (ADR 0060; the draft's own stream is #162).
import { id, type Ctx, type Route } from "../api/api.route";
import { readMatch } from "../api/api.club";
import { gamesFrom } from "../tournaments/fixtures";
import { scribe } from "@cougars/shared/scribe";
import type { Pushed } from "./live";

const log = scribe.logger("live");

/** The part a change sends with its names, and who to; null: names only. Never fails the change. */
export async function pushedWith(c: Ctx, route: Route, changes: readonly string[]): Promise<Pushed | null> {
  // Only a change to nothing but a match: what the phone puts in place is then all of the change
  if (!route.liveMatch || !c.env.LIVE || changes.join() !== "tournaments") return null;
  try {
    const match = await liveMatch(c, id(c));
    return match && { part: { match }, audience: "everyone" };
  } catch (e) {
    // A warning: the event goes with the names alone, and every phone reads the game as before
    log.warn("live.match.failed", { error: String(e) });
    return null;
  }
}

/** A tournament's games on its day, as every member sees them; null on any other day. */
async function liveMatch(c: Ctx, tournamentId: number) {
  const rows = await readMatch(c.env.DB, tournamentId, c.today);
  if (!rows) return null;
  const games = gamesFrom(rows.games, rows.goals, rows.teams, rows.penalties);
  return { tournamentId, games: games.map(({ tournamentId: _, ...g }) => g) };
}
