// What a change sends down the live streams besides the names of the parts it changed, and who it goes to
// (ADR 0053): the one place that's decided.
import { id, type Ctx, type Route } from "../api/api.route";
import { readMatch } from "../api/api.club";
import { gamesFrom } from "../tournaments/fixtures";
import { REVEAL_PLACE } from "../tournaments/awards";
import { batch, statement } from "@cougars/shared/d1";
import { scribe } from "@cougars/shared/scribe";
import type { Pushed } from "./live";

const log = scribe.logger("live");

/**
 * The part a change sends with its names, and who to; null: names only. Never fails the change. A live match and the
 * after-party's drum are the same for every member, so they're built once and go to everyone: at the rink, where the
 * squad shares one wifi address, a goal is then no read at all. Anything someone's own, and the draft, stays names only.
 */
export async function pushedWith(c: Ctx, route: Route, changes: readonly string[]): Promise<Pushed | null> {
  // Only a change to nothing but a match, or the drum: what the phone puts in place is then all of the change
  const build = route.liveMatch ? matchPart : route.liveAwards ? awardsPart : null;
  if (!build || !c.env.LIVE || changes.join() !== "tournaments") return null;
  try {
    const part = await build(c, id(c));
    return part && { part, audience: "everyone" };
  } catch (e) {
    // A warning: the event goes with the names alone, and every phone reads the tournament as before
    log.warn("live.part.failed", { error: String(e) });
    return null;
  }
}

const matchPart = async (c: Ctx, tournamentId: number) => {
  const match = await liveMatch(c, tournamentId);
  return match && { match };
};

/**
 * The after-party's drum, as every member sees it on the evening: how many awards are out, whether it's rolled
 * on to the next, sealed, and the winners out, in the order listed (api.club.ts `winners`). A winner still sealed is
 * never in it (the tournament notes): whoever runs it holds those already, and keeps them (src/app/catch-up.ts withAwards).
 */
async function awardsPart(c: Ctx, tournamentId: number) {
  const [drum, winners] = (await batch(c.env.DB, [
    statement(c.env.DB, "SELECT awards_revealed awardsRevealed, awards_next awardsNext FROM tournaments WHERE id = ?", [
      tournamentId,
    ]),
    statement(
      c.env.DB,
      `SELECT w.award, w.team_id teamId, w.member_id memberId, w.title
       FROM tournament_award_winners w JOIN tournaments t ON t.id = w.tournament_id
       WHERE w.tournament_id = ? AND ${REVEAL_PLACE} < t.awards_revealed ORDER BY w.position`,
      [tournamentId],
    ),
  ])) as [D1Result<{ awardsRevealed: number; awardsNext: number }>, D1Result<Record<string, unknown>>];
  const at = drum.results[0];
  if (!at) return null;
  const awards = { tournamentId, awardsRevealed: at.awardsRevealed, awardsNext: Boolean(at.awardsNext) };
  return { awards: { ...awards, winners: winners.results } };
}

/** A tournament's games while it's on, as every member sees them; null once it's all played, or before it starts. */
async function liveMatch(c: Ctx, tournamentId: number) {
  const rows = await readMatch(c.env.DB, tournamentId);
  if (!rows) return null;
  const games = gamesFrom(rows.games, rows.goals, rows.teams, rows.penalties);
  return { tournamentId, games: games.map(({ tournamentId: _, ...g }) => g) };
}
