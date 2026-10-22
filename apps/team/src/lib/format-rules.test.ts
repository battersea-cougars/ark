import { describe, expect, it } from "vitest";
import { formatAndRules } from "./format-rules";

const kumite = {
  kind: "draft" as const,
  playoffs: [{ name: "Final", home: 1, away: 2 }],
  gameMinutes: 12,
  periods: 1,
  breakMinutes: 0,
  startTime: "19:30",
  season: null,
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  penaltyRule: "sit_out" as const,
  defaultPenaltyMinutes: 2,
};

describe("formatAndRules: a tournament's format and rules, from what it stores", () => {
  it("sign-up: who, the places, when it opens and closes, the fee, as set", () => {
    expect(
      formatAndRules({
        ...kumite,
        capacity: 24,
        signupOpensOn: "2026-11-02",
        signupClosesOn: "2026-11-09",
        feePence: 1000,
      })[0],
    ).toEqual({
      title: "Sign-up",
      lines: [
        "Members say they're in; the captains draft them into teams.",
        "24 places; after that, a waiting list in the order people said they're in.",
        "Sign-up opens Mon 2 Nov.",
        "It closes at the end of Mon 9 Nov.",
        "£10 to play.",
      ],
    });
    expect(formatAndRules({ ...kumite, kind: "teams" })[0].lines).toEqual([
      "Teams enter with their captain and players.",
      "It stays open up to the day.",
    ]);
  });

  it("the draft: the rules it enforces, for a draft only", () => {
    expect(formatAndRules(kumite)[1].title).toBe("The draft");
    expect(formatAndRules(kumite)[1].lines).toContain(
      "One goalie a team: once a team has one, the rest are off the menu.",
    );
    expect(formatAndRules({ ...kumite, kind: "teams" }).map((s) => s.title)).not.toContain("The draft");
  });

  it("the format: the draft, the round robin and its final, its fair order, the match length and gap, the first match", () => {
    expect(formatAndRules(kumite).find((x) => x.title === "Format")).toEqual({
      title: "Format",
      lines: [
        "A round robin: every team plays every other once, then the Final (1st v 2nd).",
        "The order gives everyone the longest break it can: nobody plays twice running unless it can't be helped.",
        "12-minute games, 5 minutes between matches.",
        "The first match at 7:30pm.",
      ],
    });
  });

  it("periods and breaks when it has them; teams that enter; no first match while it's just a season", () => {
    const format = formatAndRules({
      ...kumite,
      kind: "teams",
      playoffs: [],
      periods: 3,
      breakMinutes: 2,
      season: "summer",
    }).find((x) => x.title === "Format")!;
    expect(format.lines).toEqual([
      "A round robin: every team plays every other once.",
      "The order gives everyone the longest break it can: nobody plays twice running unless it can't be helped.",
      "Games of 3 × 12-minute periods, 2-minute breaks, 5 minutes between matches.",
    ]);
  });

  it("points as set, ranked as the board ranks them; the penalty rule and usual length", () => {
    const [, , , points, penalties] = formatAndRules({ ...kumite, pointsDraw: 0 });
    expect(points.lines).toEqual([
      "3 points for a win, 0 points for a draw, 0 points for a loss.",
      "Level on points: goal difference, then goals scored.",
    ]);
    expect(penalties.lines).toEqual([
      "Penalty shot: the other team takes a shot; the player sits out, nobody plays short.",
      "Usually a minor (2 min).",
    ]);
  });

  it("house rules a line each, blank lines dropped; none written, no section", () => {
    expect(formatAndRules(kumite, "No slapshots.\n\n  Helmets on.  ").at(-1)).toEqual({
      title: "House rules",
      lines: ["No slapshots.", "Helmets on."],
    });
    expect(formatAndRules(kumite, "  ").map((s) => s.title)).toEqual([
      "Sign-up",
      "The draft",
      "Format",
      "Points",
      "Penalties",
    ]);
  });
});
