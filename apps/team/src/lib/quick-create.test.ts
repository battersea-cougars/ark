import { describe, expect, it } from "vitest";
import { reachableStep } from "./wizard";
import { quickProblem, quickSteps, type QuickStep } from "./quick-create";
import type { QuickValues } from "./TournamentQuickCreate.svelte";

const answers = (v: Partial<QuickValues> = {}): QuickValues => ({
  season: "summer",
  seasonYear: 2027,
  heldOn: "",
  startTime: "19:30",
  endTime: "21:30",
  signupOpensOn: "2027-05-01",
  draftOn: "",
  captains: [],
  ...v,
});
const reach = (v: QuickValues, draft = true) => {
  const steps: QuickStep[] = quickSteps(draft);
  return steps[reachableStep(steps.map((s) => !quickProblem(s, v, draft)))];
};

describe("an admin schedules the next one step by step", () => {
  it("asks the captains only of a draft series", () => {
    expect(quickSteps(true)).toEqual(["When", "Sign-up", "Captains", "Check"]);
    expect(quickSteps(false)).toEqual(["When", "Sign-up", "Check"]);
  });

  it("with just its season, every step is open: the day, the draft's day and the captains can come later", () => {
    expect(reach(answers())).toBe("Check");
    expect(reach(answers(), false)).toBe("Check");
  });

  it("hours the wrong way round hold it at When", () => {
    expect(reach(answers({ startTime: "21:30", endTime: "19:30" }))).toBe("When");
    expect(quickProblem("When", answers({ endTime: "19:30" }), true)).toMatch(/ends before it starts/);
  });

  it("sign-up or the draft after the day hold it at Sign-up, saying which", () => {
    const late = answers({ heldOn: "2027-06-12", signupOpensOn: "2027-06-20" });
    expect(reach(late)).toBe("Sign-up");
    expect(quickProblem("Sign-up", late, true)).toBe("Sign-up can't open after the day itself.");
    const draft = answers({ draftOn: "2027-12-01" });
    expect(quickProblem("Sign-up", draft, true)).toBe("The draft can't be after the season ends.");
    // A series without a draft never asks for its day
    expect(quickProblem("Sign-up", draft, false)).toBe("");
    expect(quickProblem("Sign-up", answers({ signupOpensOn: "" }), true)).toBe("Say when sign-up opens.");
  });
});
