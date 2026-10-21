// Each team's colour by its place in the pick order: six, then round again.
import { describe, expect, it } from "vitest";
import { teamHref, teamTone } from "./team-tones";

describe("a team's colour", () => {
  it("goes by its place, green and red last, and comes round again after six", () => {
    expect([0, 1, 2, 3, 4, 5].map(teamTone)).toEqual([
      "var(--tone-blue)",
      "var(--tone-amber)",
      "var(--tone-violet)",
      "var(--tone-teal)",
      "var(--tone-green)",
      "var(--tone-red)",
    ]);
    expect(teamTone(6)).toBe(teamTone(0));
    expect(teamTone(13)).toBe(teamTone(1));
  });

  it("is still a colour for a team not found (index -1)", () => {
    expect(teamTone(-1)).toBe("var(--tone-red)");
  });

  it("links to the team's own page", () => {
    expect(teamHref("kumite", 7)).toBe("/tournaments/kumite/teams/7");
  });
});
