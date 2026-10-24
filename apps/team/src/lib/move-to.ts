// Moving a captains' draft to any of its statuses at once (ADR 0127): Sign-up open, Draft open, Teams set, Fixtures
// set, KUMITE!, The Anchor. Shared by the app (the list in Manage, what each move will do, in words) and the Worker
// (the same plan, then done). Back is the steps back (lib/step-back.ts) in order, as many as it takes; forward is the
// jobs in between, as an admin would do them by hand: sign-up closed, the order drawn, the draft opened, the rest
// chosen at random and the draft closed, the fixtures made, the day under way, then finished.
import type { Tournament } from "../demo/model";
import { orderDrawn, playersNeeded, MIN_TEAM_SIZE } from "./draft";
import { signupOpen, signupOver } from "./signup";
import { statusList, statusOf, type Status } from "./tournament-front";

/** One thing a move does, in the order it does it. */
export type MoveStep =
  // Back (the first seven are lib/step-back.ts's own)
  | "awards"
  | "results"
  | "fixtures"
  | "teams"
  | "draft"
  | "order"
  | "signup"
  /** The day back on: no longer finished, so the matches can be played (status live). */
  | "unfinish"
  /** The day no longer under way (status live or finished back to open). */
  | "offTheDay"
  // Forward
  | "closeSignup"
  | "draw"
  | "open"
  /** Everyone still to pick chosen at random, one keeper a team, and the draft closed: the teams set. */
  | "setTeams"
  | "makeFixtures"
  /** Marked under way (status live): the first match can start. */
  | "start"
  /** Marked finished: the after-party. */
  | "finish";

/** Enough of a tournament to plan a move. */
export interface Moving {
  kind: string;
  status: string;
  /** The app reads a draft not yet open as "scheduled", the Worker as "none". */
  draftState?: string | null;
  heldOn: string;
  season?: string | null;
  signupOpensOn: string | null;
  signupClosesOn: string | null;
  signupClosedAt?: string | null;
  awardsRevealed?: number;
  teams: { pick?: number | null }[];
  games?: { status: string; homeGoals: number | null }[];
}

/** What there is to undo or do, counted, for the words. */
export interface Counts {
  /** Players on the teams (picked). */
  picks: number;
  /** Matches with a result, and goals scored. */
  results: number;
  goals: number;
  /** Signed up and still to pick (not a captain, not on a team). */
  pool: number;
}

export interface MovePlan {
  from: Status;
  to: Status;
  back: boolean;
  steps: { step: MoveStep; said: string }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The status it's at, read as the page reads it (lib/tournament-front.ts statusOf). */
export const statusNow = (t: Moving, today: string) => statusOf(t as unknown as Tournament, today);

/**
 * What moving to `to` does, step by step, or why it can't (a string): its status now and `to` both on its track, a
 * captains' draft only. The Worker plans from what it reads; the app from what it has, so the words are what's done.
 */
export function planMove(t: Moving, today: string, to: Status, n: Counts): MovePlan | string {
  if (t.kind !== "draft") return "Only a captains' draft moves through its statuses.";
  const list = statusList({ kind: "draft" });
  const from = statusNow(t, today);
  const i = list.indexOf(from);
  const j = list.indexOf(to);
  if (j < 0) return "That's not one of its statuses.";
  if (i === j) return "It's here now.";
  const onItsDay = !t.season && t.heldOn === today;
  const games = t.games ?? [];
  const steps: MovePlan["steps"] = [];
  const say = (step: MoveStep, said: string) => steps.push({ step, said });
  const at = (s: Status) => list.indexOf(s);
  const state = t.draftState === "scheduled" ? "none" : (t.draftState ?? "none");

  if (j < i) {
    if (to === "fixtures" && onItsDay) return "It's the day itself: with the fixtures out, it's KUMITE! today.";
    const played = games.some((g) => g.status !== "next" || g.homeGoals !== null);
    const allPlayed = games.length > 0 && games.every((g) => g.status === "done");
    const counted = () => {
      const c = [n.results && plural(n.results, "result"), n.goals && plural(n.goals, "goal")].filter(Boolean);
      return c.length ? `${c.join(" and ")} deleted` : "the match under way reset, its scoresheet deleted";
    };
    if ((t.awardsRevealed ?? 0) > 0) say("awards", "every award face down again");
    if (to === "day") {
      // Off the after-party: every match played means the results go; marked finished, it's just no longer that
      if (allPlayed) say("results", `${counted()}, every match not started`);
      say("unfinish", "the day under way again");
    } else {
      if (played) say("results", counted());
      if (t.status === "live" || t.status === "finished") say("offTheDay", "the day no longer under way");
      if (j <= at("teams") && games.length) say("fixtures", "the fixtures cleared");
      if (j <= at("draft") && state === "closed") say("teams", "the draft reopened");
      if (j <= at("signup")) {
        if (state === "open" || state === "closed")
          say("draft", n.picks ? `${plural(n.picks, "choice")} off the teams` : "the draft no longer open");
        if (orderDrawn(t.teams)) say("order", "the order of choosing undrawn");
        if (signupOver(t, today)) say("signup", "sign-up open again");
      }
    }
    return { from, to, back: true, steps };
  }

  if (t.teams.length < 2) return "A draft needs at least two captains.";
  if (state === "none" && n.picks === 0 && n.pool < playersNeeded(t.teams.length))
    return `Not enough players yet: a team's at least ${MIN_TEAM_SIZE}, so the draft needs ${playersNeeded(t.teams.length)} signed up for ${t.teams.length} captains: ${n.pool} so far.`;
  if (i < at("teams")) {
    if (signupOpen(t, today)) say("closeSignup", "sign-up closed");
    if (state === "none" && !orderDrawn(t.teams)) say("draw", "the order of choosing drawn");
    if (to === "draft") say("open", "the draft opened (the captains hear it)");
    else
      say(
        "setTeams",
        n.pool
          ? `${plural(n.pool, "player")} still unchosen put on teams at random (one keeper a team), the draft closed`
          : "the draft closed",
      );
  }
  if (j >= at("fixtures") && !games.length) say("makeFixtures", "the fixtures made, in a fair order");
  if (to === "day" && t.status !== "live" && !onItsDay) say("start", "marked under way: the first match can start");
  if (to === "afters") say("finish", "marked finished: matches not played stay unplayed");
  return { from, to, back: false, steps };
}

/** A plan in one sentence: "3 results and 11 goals deleted, the fixtures cleared, the draft reopened." */
export const planWords = (p: MovePlan) => {
  const s = p.steps.map((x) => x.said).join(", ");
  return s ? `${s[0].toUpperCase()}${s.slice(1)}.` : "";
};
