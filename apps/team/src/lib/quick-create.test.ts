import { describe, expect, it } from "vitest";
import { reachableStep } from "./wizard";
import { quickProblem, quickSteps, sameStep, stepOf, type QuickStep } from "./quick-create";
import { blankForm, type TournamentForm } from "./tournament-form";

const answers = (v: Partial<TournamentForm> = {}): TournamentForm => ({
  ...blankForm("2027-04-01"),
  name: "The Cougars Kumite",
  kind: "draft",
  startTime: "19:30",
  endTime: "21:30",
  signupOpensOn: "2027-05-01",
  ...v,
});
const reach = (v: TournamentForm, advanced = false) => {
  const steps: QuickStep[] = quickSteps(v.kind === "draft", advanced);
  return steps[reachableStep(steps.map((s) => !quickProblem(s, v)))];
};

describe("an admin schedules the next one step by step", () => {
  it("has the editor's tabs as its steps: Teams only for a draft, unless Advanced, which adds Rules", () => {
    expect(quickSteps(true, false)).toEqual(["Details", "Sign-up", "Teams", "Check"]);
    expect(quickSteps(false, false)).toEqual(["Details", "Sign-up", "Check"]);
    expect(quickSteps(true, true)).toEqual(["Details", "Sign-up", "Teams", "Rules", "Check"]);
    expect(quickSteps(false, true)).toEqual(["Details", "Sign-up", "Teams", "Rules", "Check"]);
  });

  it("with just its season, every step is open: the day, the draft's day and the captains can come later", () => {
    expect(reach(answers())).toBe("Check");
    expect(reach(answers({ kind: "teams" }))).toBe("Check");
    expect(reach(answers(), true)).toBe("Check");
  });

  it("hours the wrong way round hold it at Details", () => {
    expect(reach(answers({ startTime: "21:30", endTime: "19:30" }))).toBe("Details");
    expect(quickProblem("Details", answers({ endTime: "19:30" }))).toMatch(/ends before it starts/);
  });

  it("sign-up after the day holds it at Sign-up, the draft after it at Teams, saying which", () => {
    const late = answers({ heldOn: "2027-06-12", signupOpensOn: "2027-06-20" });
    expect(reach(late)).toBe("Sign-up");
    expect(quickProblem("Sign-up", late)).toBe("Sign-up can't open after the day itself.");
    const draft = answers({ draftOn: "2027-12-01" });
    expect(reach(draft)).toBe("Teams");
    expect(quickProblem("Teams", draft)).toBe("The draft can't be after the season ends.");
    // Teams that enter have no draft's day to check
    expect(quickProblem("Teams", answers({ kind: "teams", draftOn: "2027-12-01" }))).toBe("");
    expect(quickProblem("Sign-up", answers({ signupOpensOn: "" }))).toBe("Say when sign-up opens.");
  });

  it("in Advanced, what doesn't fit holds its step: no name, sign-up closing wrong, a fee that isn't one", () => {
    expect(quickProblem("Details", answers({ name: " " }))).toBe("Give it a name.");
    expect(quickProblem("Sign-up", answers({ signupClosesOn: "2027-04-20" }))).toBe(
      "Sign-up can't close before it opens.",
    );
    expect(quickProblem("Sign-up", answers({ heldOn: "2027-06-12", signupClosesOn: "2027-06-13" }))).toBe(
      "Sign-up can't close after the day itself.",
    );
    expect(quickProblem("Sign-up", answers({ fee: "ten" }))).toMatch(/sum in pounds/);
    expect(quickProblem("Sign-up", answers({ fee: "12.50" }))).toBe("");
    const unnamed = { name: "", logo: null, captainMemberId: 1, captainName: "", contact: "", players: [] };
    expect(quickProblem("Teams", answers({ kind: "teams", teams: [unnamed] }))).toBe(
      "Each team that enters needs a name.",
    );
  });

  it("turning Advanced on or off keeps the step in view, or goes to Check when it's gone", () => {
    const simple = quickSteps(false, false);
    const advanced = quickSteps(false, true);
    expect(advanced[sameStep(simple, advanced, simple.indexOf("Check"))]).toBe("Check");
    expect(advanced[sameStep(simple, advanced, simple.indexOf("Sign-up"))]).toBe("Sign-up");
    expect(simple[sameStep(advanced, simple, advanced.indexOf("Rules"))]).toBe("Check");
  });

  it("each summary line's change it goes to its field's step", () => {
    expect(stepOf("venue")).toBe("Details");
    expect(stepOf("fee")).toBe("Sign-up");
    expect(stepOf("rules")).toBe("Rules");
  });
});
