// Stepping a tournament back one step of its workflow (ADR 0074, 0060), shared by the app (what Manage offers, and
// what it'll cost) and the Worker (which step it's at, so a tap from a page that's out of date is refused). The steps
// are the tournament's statuses (Sign-up open, Draft open, Teams set, Fixtures set, the day, the after-party's awards
// revealed) and the draft's own (the order drawn, the draft open); teams that enter skip the draft's. Each step back
// undoes the step before it, and no more.
import { signupOver } from "./signup";

/** The step a tournament is at, by what stepping back from it undoes. */
export type BackFrom =
  /** Awards revealed at the after-party: every one face down again (the results and the winners stay). */
  | "awards"
  /** A match started or has a result: back to the fight card, not started (results, goals and all go). */
  | "results"
  /** The fight card out, nothing played: back to the teams (the fixtures go; they can be made again). */
  | "fixtures"
  /** A draft closed, the teams set: back to the draft, open again (nothing goes). */
  | "teams"
  /** The draft open: back to the order drawn (the picks so far go). */
  | "draft"
  /** The order drawn: back to before the draw (the order goes; the next draw is a new one). */
  | "order"
  /** Sign-up closed by an admin or past its closing day: back to sign-up open (a closing day gone by goes). */
  | "signup";

export const BACK_FROM: readonly BackFrom[] = ["awards", "results", "fixtures", "teams", "draft", "order", "signup"];

/** Enough of a tournament to say where it is. */
export interface Stepping {
  kind: string;
  /** The app's draft state: none reads as "scheduled" there. */
  draftState?: string | null;
  status: string;
  signupClosesOn: string | null;
  signupClosedAt?: string | null;
  teams: { pick?: number | null }[];
  games?: { status: string; homeGoals: number | null }[];
  /** How many awards are out at the after-party. */
  awardsRevealed?: number;
}

/** Which step it's at, stepping back (null: nothing before it). */
export function backFrom(t: Stepping, today: string): BackFrom | null {
  const games = t.games ?? [];
  if ((t.awardsRevealed ?? 0) > 0) return "awards";
  if (games.some((g) => g.status !== "next" || g.homeGoals !== null)) return "results";
  if (games.length) return "fixtures";
  if (t.kind === "draft") {
    if (t.draftState === "closed") return "teams";
    if (t.draftState === "open") return "draft";
    if (t.teams.length && t.teams.every((x) => typeof x.pick === "number")) return "order";
  }
  return signupOver(t, today) ? "signup" : null;
}

/**
 * "Back to …": the status it goes back to, as the track names it (ADR 0074), and within a status the draft's own steps
 * (the order drawn, before the draw).
 */
export const BACK_TO: Record<BackFrom, string> = {
  awards: "Back to before the awards",
  results: "Back to Fixtures set, unplayed",
  fixtures: "Back to Teams set",
  teams: "Back to Draft open",
  draft: "Back to the drawn order",
  order: "Back to before the draw",
  signup: "Back to Sign-up open",
};

/** "Back to …" for this tournament (the same whether it's a draft or teams enter). */
export const backTo = (from: BackFrom, _kind: string) => BACK_TO[from];

/** What it does, under the Manage item. */
export const BACK_SAYS: Record<BackFrom, string> = {
  awards: "Every award face down again; the results stay",
  results: "Every result and goal deleted, the matches kept",
  fixtures: "The fixtures come off, to be made again",
  teams: "Open again, every pick kept",
  draft: "The picks so far come off; the order stays",
  order: "The order comes off; the next draw is new",
  signup: "Members can say they're in again",
};

/** Steps the draft's own: whoever runs the draft takes those back too (the rest are an admin's). */
export const DRAFT_STEPS: readonly BackFrom[] = ["teams", "draft", "order"];
