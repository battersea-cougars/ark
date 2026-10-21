// A tournament's front page follows its stage (ADR 0074): each stage leads with one thing, and what's had its day goes
// (it lives on in History). Sign-up: are you in. The draft on: the draft. The teams set: your team. The fixtures out:
// the fight card. The page draws the blocks in this order; the stamp in its header says the stage.
import type { Tournament, TournamentGame, TournamentType } from "../demo/model";
import { editionState, stageOf } from "./edition";
import { signupOpen } from "./signup";

/** One part of the front page, in the order it's drawn. */
export type FrontBlock =
  /** Are you in, the count, In / Out. */
  | "signup"
  /** Your sign-up, one small line: no buttons. */
  | "signup-line"
  /** The draft card: its day and captains, or who's picking. */
  | "draft"
  /** The draft, done: one line. */
  | "draft-done"
  /** You're on Team X: its crest, captain and teammates. */
  | "my-team"
  /** The teams (the others, under yours). */
  | "teams"
  /** The fight card: the games in order of play, yours marked and the next one up (fightCardOf). */
  | "fight-card"
  /** An admin's note: the fight card's to make. */
  | "make-fixtures";

/** Your team in it, as its captain or a player: its place in the teams, or -1. */
export const myTeamIndex = (t: Tournament, me: number) =>
  t.teams.findIndex((x) => x.captainMemberId === me || x.players.some((p) => p.memberId === me));

/** Your team's next game: the first in the day's order it's in that isn't over (a playoff on seeds isn't yours yet). */
export function nextFightOf(t: Tournament, me: number): TournamentGame | undefined {
  const id = t.teams[myTeamIndex(t, me)]?.id;
  if (!id) return undefined;
  return [...(t.games ?? [])]
    .sort((a, b) => a.position - b.position)
    .find((g) => g.status !== "done" && (g.homeTeamId === id || g.awayTeamId === id));
}

/** What the front page shows before the first game's started, in order (the day itself has its own, live). */
export function frontOf(t: Tournament, me: number, today: string): FrontBlock[] {
  const draft = t.kind === "draft";
  const mine = myTeamIndex(t, me) >= 0;
  switch (stageOf(t)) {
    case "signup":
      return draft ? ["signup", "draft"] : ["signup"];
    case "draft":
      return ["draft", "signup-line"];
    case "teams":
      return [
        ...(mine ? (["my-team"] as const) : []),
        "teams",
        // A draft's done in a line; teams that enter may still be coming, while sign-up's open
        ...(draft ? (["draft-done"] as const) : signupOpen(t, today) ? (["signup"] as const) : []),
        "make-fixtures",
      ];
    case "fixtures":
      return ["fight-card", "teams"];
  }
}

/** Up to this many games, the front page's fight card shows them all. */
const WHOLE_CARD = 6;

/**
 * The fight card on the front page: every game in order of play while there are a few; more, and it's your team's games
 * still to play, the one on and the next, the rest on the full fight card. Up next: the first not yet started.
 */
export function fightCardOf(t: Tournament, me: number) {
  const games = [...(t.games ?? [])].sort((a, b) => a.position - b.position);
  const upNext = games.find((g) => g.status === "next");
  const whole = games.length <= WHOLE_CARD;
  const id = t.teams[myTeamIndex(t, me)]?.id;
  const shown = whole
    ? games
    : games.filter(
        (g) =>
          g === upNext ||
          g.status === "live" ||
          (!!id && g.status !== "done" && (g.homeTeamId === id || g.awayTeamId === id)),
      );
  return { games: shown, upNext, whole };
}

export type BadgeTone = "open" | "live" | "set" | "done" | "quiet";

/**
 * The stamp in a tournament's header (every page of the series): its stage, in words. Sign-up open (or coming up), the
 * draft live, the teams set, the fixtures out, then on the day its own name shouted, KUMITE!; under way on another
 * day, on now; every game played, done.
 */
export function stageBadge(t: Tournament, type: Pick<TournamentType, "shortName">, today: string) {
  const state = editionState(t);
  const badge = (label: string, tone: BadgeTone) => ({ label, tone });
  if (state === "done") return badge("Done", "done");
  switch (stageOf(t)) {
    case "signup":
      return state === "open" ? badge("Sign-up open", "open") : badge("Coming up", "quiet");
    case "draft":
      return badge("Draft live", "live");
    case "teams":
      return badge("Teams set", "set");
    case "fixtures":
      if (!t.season && t.heldOn === today) return badge(`${type.shortName}!`, "live");
      if (state === "live") return badge("On now", "live");
      return badge("Fixtures out", "set");
  }
}
