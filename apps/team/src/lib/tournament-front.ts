// A tournament's front page follows its stage (ADR 0074): a track at the top says which one it's at (sign-up, the
// draft, the teams, the fight card, the day), what happens next under it, then that stage's one thing. Sign-up: are
// you in. The draft on: the draft. The teams set: your team, and the fight card to come. The fixtures out: the first
// match. On the day: the match on now and the next (the page's own). The teams themselves live on their tab.
import type { Tournament, TournamentGame, TournamentType } from "../demo/model";
import { atAfters, editionState, stageOf } from "./edition";
import { revealOf } from "./afters";
import { signupOpen, signupOver } from "./signup";
import { orderDrawn } from "./draft";
import type { MotifKey } from "./motif";

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

/**
 * Where a tournament is, as a status (ADR 0074): "Fight Card is confusing if we think of the kumite in stages. It
 * should really be a status: Draft Open, Draft Completed, Fixtures Created, Kumite!" (the user, 2026-10-22). Its one
 * page shows the status it's at, or (from the track) one it's been through, read-only.
 */
export type Status = "signup" | "draft" | "teams" | "fixtures" | "day" | "afters";

/** Each status's address under its edition's page (lib/edition-address.ts); the one it's at is the page itself. */
export const STATUS_PATH: Record<Status, string> = {
  signup: "sign-up",
  draft: "draft",
  teams: "teams",
  fixtures: "schedule",
  day: "day",
  afters: "afters",
};

/**
 * The statuses it goes through, in order: a draft has the draft open; then, draft or not, the teams set; after the
 * day, the after-party (ADR 0074).
 */
export function statusList(t: Pick<Tournament, "kind">): Status[] {
  return t.kind === "draft"
    ? ["signup", "draft", "teams", "fixtures", "day", "afters"]
    : ["signup", "teams", "fixtures", "day", "afters"];
}

/**
 * A status in words, as the track says it, and shorter for a phone's narrow track. The after-party is its afterwards'
 * name ("The Anchor", "Anchor" on a phone), or Afters when it has none (`afterName`).
 */
export function statusLabel(
  s: Status,
  t: Pick<Tournament, "kind">,
  type: Pick<TournamentType, "shortName">,
  afterName?: string | null,
) {
  switch (s) {
    case "signup":
      return { label: "Sign-up open", short: "Sign-up" };
    case "draft":
      return { label: "Draft open", short: "Draft" };
    case "teams":
      // "Teams set", draft or not: it fits a phone's track whole (where "Teams finalised" wouldn't)
      return { label: "Teams set", short: "Teams" };
    case "fixtures":
      return { label: "Fixtures set", short: "Fixtures" };
    case "day":
      return { label: `${type.shortName}!`, short: `${type.shortName}!` };
    case "afters":
      return afterName
        ? { label: afterName, short: afterName.replace(/^the\s+/i, "") || afterName }
        : { label: "Afters", short: "Afters" };
  }
}

/**
 * The status it's at: sign-up until it closes (an admin's Close sign-up, or past its closing day) or, teams that
 * enter, a team's in; a captains' draft is then at Draft open, where the order's drawn and the draft opened; complete
 * (closed, or the teams in); the fixtures out; then, on its day or once a match has started, the day itself; the last
 * match played, the after-party (the page shows it that evening only: lib/edition.ts atAfters).
 */
export function statusOf(t: Tournament, today: string): Status {
  if (editionState(t) === "done") return "afters";
  const stage = stageOf(t);
  if (stage === "signup" && t.kind === "draft" && (signupOver(t, today) || orderDrawn(t.teams))) return "draft";
  if (stage !== "fixtures") return stage;
  const state = editionState(t);
  return state === "live" || state === "done" || (!t.season && t.heldOn === today) ? "day" : "fixtures";
}

/**
 * The track: every status it goes through, each done, the one it's at now, or still ahead. A status it's reached
 * (done or now) can be looked at; one still ahead can't. `afterName`: its afterwards' name, the last status's.
 */
export function statusesOf(
  t: Tournament,
  type: Pick<TournamentType, "shortName">,
  today: string,
  afterName?: string | null,
) {
  const list = statusList(t);
  const at = list.indexOf(statusOf(t, today));
  return list.map((status, i) => ({
    status,
    ...statusLabel(status, t, type, afterName),
    state: (i < at ? "done" : i === at ? "now" : "ahead") as "done" | "now" | "ahead",
  }));
}

/** Whether it's been through this status (or is at it): only those can be looked at. */
export function reached(t: Tournament, today: string, s: Status) {
  const list = statusList(t);
  const i = list.indexOf(s);
  return i >= 0 && i <= list.indexOf(statusOf(t, today));
}

/**
 * Which status the page shows for the address it's at (`/tournaments/kumite/draft` → the draft): that status if it's
 * been reached, else (nothing after the page's address, an unknown one, or one still ahead) the status it's at.
 */
export function viewOf(t: Tournament, today: string, rest: string): Status {
  const asked = (Object.keys(STATUS_PATH) as Status[]).find((s) => STATUS_PATH[s] === rest);
  return asked && reached(t, today, asked) ? asked : statusOf(t, today);
}

/**
 * What the page's pane shows for a status: the draft is its captains' and whoever runs it (ADR 0060), everyone else
 * fights blind until it's done. Whoever runs it sees the draft before there are captains too: it asks them to name them.
 * Once it's all played, its draft is everyone's to look back on.
 */
export function paneOf(t: Tournament, view: Status, me: number, runsDraft: boolean): Status | "blind" {
  if (view !== "draft" || t.kind !== "draft") return view === "draft" ? "blind" : view;
  if (editionState(t) === "done") return "draft";
  return runsDraft || t.teams.some((x) => x.captainMemberId === me) ? "draft" : "blind";
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
  if (editionState(t) === "done") return undefined;
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

export type BadgeTone = "on" | "live" | "quiet" | "done";

/** Each status's kanji on its stamp (lib/motif.ts): open, the lots drawn, decided, the matches, the Kumite, the prize. */
export const STATUS_MARK: Record<Status, MotifKey> = {
  signup: "open",
  draft: "draw",
  teams: "sealed",
  fixtures: "fights",
  day: "onTheMat",
  afters: "awards",
};

/**
 * The stamp in a tournament's header (every page of the series): the status it's at, as the track says it, with the
 * status's kanji (ADR 0074). Every one the same ink stamp ("on"); before sign-up opens it's Coming up, faint; the day
 * (KUMITE!, or a match under way) the loudest; every match played, the after-party's name that evening, then Done.
 * `evening`: the evening it is now (lib/dates.ts londonEvening), which runs past midnight till 06:00 (#168).
 */
export function stageBadge(
  t: Tournament,
  type: Pick<TournamentType, "shortName">,
  today: string,
  afterName?: string | null,
  evening = today,
): { label: string; tone: BadgeTone; mark: MotifKey } {
  const status = statusOf(t, today);
  const mark = STATUS_MARK[status];
  const { label } = statusLabel(status, t, type, afterName);
  // At The Anchor until the last award's out: then Done, though its page stays its results that evening
  if (status === "afters")
    return afterMomentOf(t, evening) === "now" && !revealOf(t).all
      ? { label, tone: "done", mark }
      : { label: "Done", tone: "done", mark };
  if (status === "signup" && editionState(t) !== "open") return { label: "Coming up", tone: "quiet", mark };
  return { label, tone: status === "day" ? "live" : "on", mark };
}

/** When the afterwards shows on the front page (ADR 0074). */
export type AfterMoment =
  /** Before the day: a quiet line under what's next. */
  | "before"
  /** On the day, the last match on (or up next): it's what comes after it. */
  | "next"
  /** The last match played, that day: it's where everyone is now. */
  | "now";

/**
 * Where the afterwards goes on the front page: a quiet line before the day; nothing on the day while the matches are
 * what matters, until the last one's on, when it's next; then, the day done, it's now (that evening only, past midnight till 06:00: `evening`, lib/dates.ts londonEvening).
 */
export function afterMomentOf(t: Tournament, evening: string): AfterMoment | null {
  const state = editionState(t);
  if (state === "done") return atAfters(t, evening) ? "now" : null;
  if (state !== "live") return "before";
  return (t.games ?? []).filter((g) => g.status !== "done").length <= 1 ? "next" : null;
}

/** What it's for, in the middle of a line: "celebration and awards", but "BBQ" stays a BBQ. */
export function afterNoteWords(note: string) {
  const n = note.trim();
  return /^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n;
}

/**
 * The match the matches' carousel brings forward (ADR 0074): the one on now, else the next to be played (in the day's
 * order), else, every one played, the last (the final).
 */
export function currentMatchOf<G extends Pick<TournamentGame, "status" | "position">>(games: readonly G[]) {
  const ordered = [...games].sort((a, b) => a.position - b.position);
  return ordered.find((g) => g.status === "live") ?? ordered.find((g) => g.status !== "done") ?? ordered.at(-1);
}
