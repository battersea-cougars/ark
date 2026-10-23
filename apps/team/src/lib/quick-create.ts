// The next date in a series, asked as a wizard (TournamentQuickCreate, ADR 0074): its steps, and what stops each one.
// The steps are the full editor's tabs, by the same names (lib/TournamentDateEditor), then a look over it.
import { feePence, formDay, type TournamentForm } from "./tournament-form";

export type QuickStep = "Details" | "Sign-up" | "Teams" | "Rules" | "Check";
/** The fields only Advanced shows, each on its step: what the summary lines' "change it" opens. */
export type MoreField = "venue" | "fee" | "rules";

/**
 * Details (when, and in Advanced where and what it's called), Sign-up, Teams (a draft's day and captains; teams that
 * enter only in Advanced), Rules & awards (Advanced only), then a look over it.
 */
export function quickSteps(draft: boolean, advanced: boolean): QuickStep[] {
  const teams = draft || advanced ? (["Teams"] as const) : [];
  const rules = advanced ? (["Rules"] as const) : [];
  return ["Details", "Sign-up", ...teams, ...rules, "Check"];
}

/** Where an Advanced field is: its step. */
export const stepOf = (field: MoreField): QuickStep =>
  field === "venue" ? "Details" : field === "fee" ? "Sign-up" : "Rules";

/**
 * The step to be on once the steps change (Advanced on or off): the same one, else the look over it at the end.
 */
export function sameStep(from: readonly QuickStep[], to: readonly QuickStep[], step: number): number {
  const i = to.indexOf(from[step]!);
  return i === -1 ? to.length - 1 : i;
}

/**
 * What stops a step, in a few words ("" when nothing does). Only the season is needed, and it always has one, so
 * what can stop it is an answer that doesn't fit: hours the wrong way round, sign-up or the draft after the day; and
 * in Advanced, a name taken away, sign-up closing before it opens, a fee that isn't one, a team that entered unnamed.
 */
export function quickProblem(step: QuickStep, f: TournamentForm): string {
  const day = formDay(f);
  const after = f.heldOn ? "the day itself" : "the season ends";
  if (step === "Details") {
    if (f.endTime <= f.startTime) return "It ends before it starts: check the hours.";
    if (!f.name.trim()) return "Give it a name.";
  }
  if (step === "Sign-up") {
    if (!f.signupOpensOn) return "Say when sign-up opens.";
    if (f.signupOpensOn > day) return `Sign-up can't open after ${after}.`;
    if (f.signupClosesOn && f.signupClosesOn < f.signupOpensOn) return "Sign-up can't close before it opens.";
    if (f.signupClosesOn && f.signupClosesOn > day) return `Sign-up can't close after ${after}.`;
    if (f.capacity !== null && f.capacity < 0) return "Places can't be fewer than none.";
    if (Number.isNaN(feePence(f.fee))) return "The fee is a sum in pounds, like 10 or 12.50.";
  }
  if (step === "Teams") {
    if (f.kind === "draft" && f.draftOn && f.draftOn > day) return `The draft can't be after ${after}.`;
    if (f.kind === "teams" && f.teams.some((t) => !t.name.trim())) return "Each team that enters needs a name.";
  }
  return "";
}
