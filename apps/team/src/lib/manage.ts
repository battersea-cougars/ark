// A tournament's Manage menu (ADR 0065, 0074): which jobs it offers, by where the tournament stands and who's
// looking, so nothing's offered that makes no sense there. lib/TournamentHead.svelte wires each to what it does.
//
// Where it stands (manageStageOf): sign-up; the draft (the order drawn, the draft open); the teams set (a draft
// closed); the fixtures out, none started (on its day too); live (a match started or played); the after-party (every
// match played, or marked finished; afterwards, History).
//
// | Job                              | Sign-up | Draft | Teams set | Fixtures | Live | After-party | Who                       |
// | -------------------------------- | ------- | ----- | --------- | -------- | ---- | ----------- | ------------------------- |
// | The draft's jobs (draft-jobs.ts) | add     | yes   |           |          |      |             | as draftJobsOf says       |
// | Make the fixtures again          |         |       |           | yes      |      |             | admin                     |
// | Confirm / Change the awards      |         |       |           |          |      | till reveal | admin, with awards listed |
// | Play out the Kumite (dev only)   | yes     | yes   | yes       | yes      | yes  |             | admin                     |
// | Back to …                        | closed  | yes   | yes       | yes      | yes  | revealed    | admin; runner: draft's    |
// | Move to… (a captains' draft)     | yes     | yes   | yes       | yes      | yes  | yes         | admin                     |
// | Your team                        |         | yes   | yes       | yes      |      |             | its captain               |
// | Pick log (a captains' draft)     |         | open  | yes       | yes      |      |             | runner or a captain       |
// | Settings                         | yes     | yes   | yes       | yes      | yes  | yes         | admin                     |
// | Record a past one                | yes     | yes   | yes       | yes      | yes  | yes         | admin (nothing on too)    |
// | A Kumite on a past day (dev)     | yes     | yes   | yes       | yes      | yes  | yes         | admin (nothing on too)    |
//
// The last two are the series' history's, not this edition's (historyItemsOf): one from before the app recorded
// (ADR 0126), and on dev one played out on a day gone by (ADR 0123). With nothing on, they're Manage's only items.
//
// The awards are confirmed once every match is played, and can be changed till the reveal starts (the Worker refuses
// after: step back first); Confirm till they're confirmed, then Change. Your team and the pick log are the draft's:
// once a match is on, the teams are what they are, and the pick log stays on the draft's own page (the track's Draft
// open). Back a step is one item while there's a step before it (lib/step-back.ts), the draft's own steps for whoever
// runs the draft too. Close sign-up isn't Manage's: like each step's action (Shuffle, Open, Seal), it's on the
// sign-up view itself (pages/Games.svelte), for whoever runs it.
import type { Tournament, TournamentType } from "../demo/model";
import type { IconName } from "../app/shell/icons";
import { draftJobsOf, type DraftJob } from "./draft-jobs";
import { editionState } from "./edition";
import { statusOf } from "./tournament-front";
import { BACK_SAYS, DRAFT_STEPS, backFrom, backTo } from "./step-back";

/** Where it stands, for what Manage offers. */
export type ManageStage = "signup" | "draft" | "teams" | "fixtures" | "live" | "afters";

/** What a Manage item does, for the page to wire: a draft job carries which. */
export type ManageKey =
  "draftJob" | "remake" | "awards" | "simulate" | "back" | "move" | "team" | "log" | "settings" | "record" | "pastDay";

export interface ManageEntry {
  key: ManageKey;
  /** The draft's job, for a draftJob. */
  job?: DraftJob;
  icon: IconName;
  label: string;
  sub: string;
  /** Can't be taken back: said in red. */
  danger?: boolean;
}

/** Who's looking, by what they can do. */
export interface Manager {
  /** manage:Tournament */
  admin: boolean;
  /** run:Draft */
  runsDraft: boolean;
  /** update:Event: adds a player to the draft. */
  adds: boolean;
  /** Their member id: a captain's team. */
  me: number;
  /** The dev simulator's here and not already playing this one (ADR 0123). */
  simulator?: boolean;
}

/** Names for the draft's jobs (Undo the last pick names it). */
export interface ManageNames {
  player: (memberId: number | null, name?: string) => string;
  team: (index: number) => string;
}

const NO_NAMES: ManageNames = { player: (_id, name) => name ?? "", team: (i) => `Team ${i + 1}` };

/** Where it stands: its status, with the day split into before a match starts (the fixtures) and after (live). */
export function manageStageOf(t: Tournament, today: string): ManageStage {
  const state = editionState(t);
  if (state === "done") return "afters";
  if (state === "live") return "live";
  const status = statusOf(t, today);
  return status === "day" ? "fixtures" : status === "afters" ? "afters" : status;
}

/**
 * The Manage menu's items, in the order they're needed: the step it's at (the draft's jobs, the fixtures made again,
 * the awards), the dev simulator, Back a step and Move to…, a captain's own (Your team, the pick log), the settings
 * last. Empty: no gear.
 */
export function manageItemsOf(
  t: Tournament,
  type: Pick<TournamentType, "shortName"> & Partial<Pick<TournamentType, "kind">>,
  who: Manager,
  today: string,
  names: ManageNames = NO_NAMES,
): ManageEntry[] {
  const stage = manageStageOf(t, today);
  const before = stage !== "live" && stage !== "afters";
  const items: ManageEntry[] = draftJobsOf(t, { runs: who.runsDraft, adds: who.adds }, names).map((j) => ({
    key: "draftJob" as const,
    ...j,
  }));
  if (who.admin && stage === "fixtures")
    items.push({
      key: "remake",
      icon: "refresh",
      label: "Make the fixtures again",
      sub: "A new order of play, the same teams",
    });
  if (who.admin && stage === "afters" && t.awards.length && !(t.awardsRevealed ?? 0))
    items.push({
      key: "awards",
      icon: "medal",
      label: t.awardsConfirmedAt ? "Change the awards" : "Confirm the awards",
      sub: t.awardsConfirmedAt
        ? "Till the reveal starts: the winners, the judges' call"
        : "The stats, the votes, the judges' call; then the reveal",
    });
  if (who.admin && who.simulator && stage !== "afters")
    items.push({
      key: "simulate",
      icon: "play",
      label: `Play out the ${type.shortName}`,
      sub: "Dev only: the rest at random, to the after-party",
    });
  const from = backFrom(t, today);
  if (from && (who.admin || (who.runsDraft && DRAFT_STEPS.includes(from))))
    items.push({ key: "back", icon: "undo", label: backTo(from, t.kind), sub: BACK_SAYS[from] });
  if (who.admin && t.kind === "draft")
    items.push({
      key: "move",
      icon: "flag",
      label: "Move to…",
      sub: "Any status, back or on: the steps between done for you",
    });
  const captain = t.teams.some((x) => x.id && x.captainMemberId === who.me);
  if (before && captain) items.push({ key: "team", icon: "teams", label: "Your team", sub: "Its name and crest" });
  if (
    before &&
    t.kind === "draft" &&
    (t.draftState === "open" || t.draftState === "closed") &&
    (who.runsDraft || t.teams.some((x) => x.captainMemberId === who.me))
  )
    items.push({ key: "log", icon: "list", label: "Pick log", sub: "Every pick, round by round" });
  if (who.admin)
    items.push({
      key: "settings",
      icon: "settings",
      label: `${type.shortName} settings`,
      sub:
        t.kind === "draft"
          ? "Day, sign-up, captains and draft day, rules, awards"
          : "Day, sign-up, teams, rules, awards",
    });
  return [...items, ...historyItemsOf(type, who)];
}

/**
 * The series' history's jobs, an admin's, whatever's on (and with nothing on, Manage's only ones): a past one
 * recorded (ADR 0126); on dev, one played out on a day gone by (ADR 0123), a captains' draft's only.
 */
export function historyItemsOf(
  type: Pick<TournamentType, "shortName"> & Partial<Pick<TournamentType, "kind">>,
  who: Pick<Manager, "admin" | "simulator">,
): ManageEntry[] {
  if (!who.admin) return [];
  const items: ManageEntry[] = [
    {
      key: "record",
      icon: "plus",
      label: `Record a past ${type.shortName}`,
      sub: "One from before the app: its day, teams, results and awards",
    },
  ];
  if (who.simulator && type.kind === "draft")
    items.push({
      key: "pastDay",
      icon: "play",
      label: `A ${type.shortName} on a past day`,
      sub: "Dev only: a whole evening at random, straight into history",
    });
  return items;
}
