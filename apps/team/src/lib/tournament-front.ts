// A tournament's front page follows its stage (ADR 0074): a track at the top says which one it's at (sign-up, the
// draft, the teams, the fight card, the day), what happens next under it, then that stage's one thing. Sign-up: are
// you in. The draft on: the draft. The teams set: your team, and the fight card to come. The fixtures out: the first
// match. On the day: the match on now and the next (the page's own). The teams themselves live on their tab.
import type { Tournament, TournamentGame, TournamentType } from "../demo/model";
import { editionState, stageOf } from "./edition";
import { signupOpen } from "./signup";

/** One part of the front page, before the first game's started, in the order it's drawn. */
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
  /** The first match, and your first if it's another (firstUpOf). */
  | "first-up"
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
      return ["signup"];
    case "draft":
      return ["draft", "signup-line"];
    case "teams":
      return [
        ...(mine ? (["my-team"] as const) : []),
        // A draft's done in a line; teams that enter may still be coming, while sign-up's open
        ...(draft ? (["draft-done"] as const) : signupOpen(t, today) ? (["signup"] as const) : []),
        "make-fixtures",
      ];
    case "fixtures":
      return ["first-up"];
  }
}

/** The steps a tournament goes through, as the track at the top of its front page names them. */
export type Step = "signup" | "draft" | "teams" | "fixtures" | "day";

/**
 * The track at the top of the front page: every step it goes through (no draft for teams that enter), each done, the
 * one it's at now, or still ahead. The fixtures out, it's at the fight card till the day; on the day (or once a game's
 * started), it's at the day, its own name shouted.
 */
export function stepsOf(t: Tournament, type: Pick<TournamentType, "shortName">, today: string) {
  const steps: { step: Step; label: string }[] = [
    { step: "signup", label: "Sign-up" },
    ...(t.kind === "draft" ? [{ step: "draft" as const, label: "Draft" }] : []),
    { step: "teams", label: "Teams" },
    { step: "fixtures", label: "Fight card" },
    { step: "day", label: `${type.shortName}!` },
  ];
  const stage = stageOf(t);
  const state = editionState(t);
  const onTheDay = stage === "fixtures" && (state === "live" || state === "done" || (!t.season && t.heldOn === today));
  const at = steps.findIndex((s) => s.step === (onTheDay ? "day" : stage));
  return steps.map((s, i) => ({
    ...s,
    state: (i < at || state === "done" ? "done" : i === at ? "now" : "ahead") as "done" | "now" | "ahead",
  }));
}

/** What happens next, under the track: what, its day (a YYYY-MM-DD) and time, or in words when it has no day. */
export interface Next {
  label: string;
  on: string | null;
  at?: string;
  /** In place of a day: "date to be set", "once the draft closes". */
  note?: string;
}

const TBC = "date to be set";

/**
 * The next thing to happen, before the day: sign-up opening, then closing; the draft's day; the fight card, still to
 * come; then the first match, on the day at its start. On the day, how far it's got (the matches are the page's).
 */
export function nextOf(t: Tournament, today: string): Next | undefined {
  const day: Next = t.season
    ? { label: "First match", on: null, note: TBC }
    : { label: "First match", on: t.heldOn, at: t.startTime };
  const games = t.games ?? [];
  switch (stageOf(t)) {
    case "signup":
      if (t.status === "planned" && t.signupOpensOn && today < t.signupOpensOn)
        return { label: "Sign-up opens", on: t.signupOpensOn };
      if (signupOpen(t, today) && t.signupClosesOn) return { label: "Sign-up closes", on: t.signupClosesOn };
      if (t.kind !== "draft") return day;
      return t.draftOn ? { label: "The draft", on: t.draftOn } : { label: "The draft", on: null, note: TBC };
    case "draft":
      return { label: "The teams", on: null, note: "once the draft closes" };
    case "teams":
      return day;
    case "fixtures": {
      const played = games.filter((g) => g.status === "done").length;
      if (editionState(t) === "live") return { label: `${played} of ${games.length} played`, on: null };
      return day;
    }
  }
}

/**
 * Before the first match: the match that opens the day, and yours if it's a later one (your team's first, marked).
 */
export function firstUpOf(t: Tournament, me: number) {
  const first = [...(t.games ?? [])].sort((a, b) => a.position - b.position).find((g) => g.status !== "done");
  const yours = nextFightOf(t, me);
  return { games: first ? (yours && yours !== first ? [first, yours] : [first]) : [], upNext: first };
}

/**
 * On the day: the match on now (or, between matches, the one up next) and the one after it. Your next, when it's
 * neither, is a line under them.
 */
export function onTheDayOf(t: Tournament, me: number) {
  const games = [...(t.games ?? [])].sort((a, b) => a.position - b.position);
  const live = games.find((g) => g.status === "live");
  const ahead = games.filter((g) => g.status === "next");
  const now = live ?? ahead[0];
  const after = live ? ahead[0] : ahead[1];
  const yours = nextFightOf(t, me);
  return { now, after, live: !!live, yours: yours && yours !== now && yours !== after ? yours : undefined };
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
