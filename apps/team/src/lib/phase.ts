// Past, on or next (ADR 0074, #182): "status decides whether an event or game is past, on or next, never its date or
// time" (the user, 2026-10-25). Done is past, whatever its date; live is on, even running late; not started, its time
// gone by, is still next until it's played, closed or cancelled. The date is for showing and sorting. One place says
// it for each kind of thing, and Home, the calendar and the series' pages all ask here.
import type { Tournament, TournamentGame } from "../demo/model";
import { editionState } from "./edition";
import { registerClosed } from "./register-closes";

export type Phase = "past" | "on" | "next";

/** A tournament's, by its games (lib/edition.ts editionState): done is past, under way is on, the rest next. */
export function tournamentPhase(t: Tournament): Phase {
  const state = editionState(t);
  if (state === "done") return "past";
  return state === "live" ? "on" : "next";
}

/** A game's, by its status: the one set for 1:00 that starts at 1:45 is on then, and the one after stays next. */
export function gamePhase(game: Pick<TournamentGame, "status">): Phase {
  if (game.status === "done") return "past";
  return game.status === "live" ? "on" : "next";
}

/**
 * A training night's: held once its register closes (06:00 the morning after, lib/register-closes.ts, or its record
 * says it closed), on from its start till then, next before.
 */
export function nightPhase(
  night: { heldOn: string; startsAt: string; registerClosedAt?: string | null },
  now = new Date(),
): Phase {
  if (night.registerClosedAt || registerClosed(night.heldOn, now)) return "past";
  return now.getTime() >= Date.parse(night.startsAt) ? "on" : "next";
}

/** Something with no status of its own (a social): its time is all there is to go by. */
export function timedPhase(startsAt: string, endsAt: string, now = new Date()): Phase {
  if (now.getTime() >= Date.parse(endsAt)) return "past";
  return now.getTime() >= Date.parse(startsAt) ? "on" : "next";
}
