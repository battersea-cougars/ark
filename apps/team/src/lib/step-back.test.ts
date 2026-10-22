import { describe, expect, it } from "vitest";
import { backFrom, type Stepping } from "./step-back";

const TODAY = "2026-12-08";
const draft = (o: Partial<Stepping> = {}): Stepping => ({
  kind: "draft",
  draftState: "scheduled",
  status: "open",
  signupClosesOn: null,
  teams: [{ pick: null }, { pick: null }],
  games: [],
  ...o,
});
const drawn = [{ pick: 1 }, { pick: 2 }];

describe("backFrom: the step a tournament's at, stepping back", () => {
  it("a draft, step by step from the day back to sign-up", () => {
    const played = [{ status: "done", homeGoals: 2 }];
    expect(backFrom(draft({ draftState: "closed", teams: drawn, games: played }), TODAY)).toBe("results");
    expect(
      backFrom(draft({ draftState: "closed", teams: drawn, games: [{ status: "live", homeGoals: 0 }] }), TODAY),
    ).toBe("results");
    expect(
      backFrom(draft({ draftState: "closed", teams: drawn, games: [{ status: "next", homeGoals: null }] }), TODAY),
    ).toBe("fixtures");
    expect(backFrom(draft({ draftState: "closed", teams: drawn }), TODAY)).toBe("teams");
    expect(backFrom(draft({ draftState: "open", teams: drawn }), TODAY)).toBe("draft");
    // The app reads a draft that's not open yet as scheduled; the Worker as none
    expect(backFrom(draft({ teams: drawn }), TODAY)).toBe("order");
    expect(backFrom(draft({ draftState: "none", teams: drawn }), TODAY)).toBe("order");
    expect(backFrom(draft({ signupClosesOn: "2026-12-05" }), TODAY)).toBe("signup");
    expect(backFrom(draft(), TODAY)).toBeNull();
  });

  it("sign-up open on its closing day is still open: nothing before it", () => {
    expect(backFrom(draft({ signupClosesOn: TODAY }), TODAY)).toBeNull();
  });

  it("teams that enter have no draft steps: the fight card, then sign-up", () => {
    const cup = (o: Partial<Stepping>) => draft({ kind: "teams", draftState: "none", teams: [{}, {}], ...o });
    expect(backFrom(cup({ games: [{ status: "next", homeGoals: null }] }), TODAY)).toBe("fixtures");
    expect(backFrom(cup({ signupClosesOn: "2026-12-05" }), TODAY)).toBe("signup");
    expect(backFrom(cup({}), TODAY)).toBeNull();
  });
});
