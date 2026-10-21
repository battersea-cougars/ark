// The next date in a series, asked as a wizard (TournamentQuickCreate, ADR 0074): its steps, and what stops each one.
import { seasonEnd } from "@cougars/shared/seasons";
import type { QuickValues } from "./TournamentQuickCreate.svelte";

export type QuickStep = "When" | "Sign-up" | "Captains" | "Check";

/** When it is, when sign-up opens (and the draft's day), the captains (a draft series only), then a look over it. */
export const quickSteps = (draft: boolean): QuickStep[] =>
  draft ? ["When", "Sign-up", "Captains", "Check"] : ["When", "Sign-up", "Check"];

/** The day it sorts by: its own, else its season's last. */
export const quickDay = (v: QuickValues) => v.heldOn || seasonEnd(v.season, v.seasonYear);

/**
 * What stops a step, in a few words ("" when nothing does). Only the season is needed, and it always has one, so
 * what can stop it is an answer that doesn't fit: hours the wrong way round, sign-up or the draft after the day.
 */
export function quickProblem(step: QuickStep, v: QuickValues, draft: boolean): string {
  const day = quickDay(v);
  const after = v.heldOn ? "the day itself" : "the season ends";
  if (step === "When" && v.endTime <= v.startTime) return "It ends before it starts: check the hours.";
  if (step === "Sign-up") {
    if (!v.signupOpensOn) return "Say when sign-up opens.";
    if (v.signupOpensOn > day) return `Sign-up can't open after ${after}.`;
    if (draft && v.draftOn && v.draftOn > day) return `The draft can't be after ${after}.`;
  }
  return "";
}
