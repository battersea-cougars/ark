import { describe, expect, it } from "vitest";
import { planMove, planWords, type Counts, type Moving } from "./move-to";

const TODAY = "2026-12-08";
const NONE: Counts = { picks: 0, results: 0, goals: 0, pool: 8 };
const drawn = [{ pick: 1 }, { pick: 2 }, { pick: 3 }];
const kumite = (o: Partial<Moving> = {}): Moving => ({
  kind: "draft",
  status: "open",
  draftState: "scheduled",
  heldOn: "2026-12-12",
  season: null,
  signupOpensOn: null,
  signupClosesOn: "2026-12-10",
  teams: [{ pick: null }, { pick: null }, { pick: null }],
  games: [],
  ...o,
});
const played = [
  { status: "done", homeGoals: 2 },
  { status: "next", homeGoals: null },
];

describe("planMove: what a move does, in words", () => {
  it("back from a match played to Draft open, in one sentence", () => {
    const plan = planMove(kumite({ draftState: "closed", teams: drawn, games: played }), TODAY, "draft", {
      ...NONE,
      results: 3,
      goals: 11,
    });
    expect(typeof plan !== "string" && planWords(plan)).toBe(
      "3 results and 11 goals deleted, the fixtures cleared, the draft reopened.",
    );
  });

  it("on its day, Fixtures set is KUMITE!: not one to move back to", () => {
    const t = kumite({ draftState: "closed", teams: drawn, games: played, heldOn: TODAY });
    expect(planMove(t, TODAY, "fixtures", NONE)).toBe(
      "It's the day itself: with the fixtures out, it's KUMITE! today.",
    );
    expect(typeof planMove(t, TODAY, "teams", NONE)).toBe("object");
  });

  it("forward with too few signed up says so, as opening the draft would", () => {
    expect(planMove(kumite(), TODAY, "teams", { ...NONE, pool: 2 })).toMatch(/^Not enough players yet/);
  });

  it("teams that enter don't move through a draft's statuses", () => {
    expect(planMove(kumite({ kind: "teams" }), TODAY, "fixtures", NONE)).toBe(
      "Only a captains' draft moves through its statuses.",
    );
  });
});
