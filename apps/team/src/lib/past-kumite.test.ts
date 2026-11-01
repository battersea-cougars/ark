// Recording a past Kumite's answers (lib/past-kumite.ts): the round robin keeps the scores put in, the final follows
// the table, the champions and top scorer come from the results, and the Worker is sent only what was said.
import { describe, expect, it } from "vitest";
import type { Award } from "./awards";
import { blankPast, championsOf, finalOf, pastBody, pastProblem, suggestedWinners, withMatches } from "./past-kumite";

const AWARDS: Award[] = [
  { name: "Champions", about: "", decidedBy: { kind: "stat", stat: "table" } },
  { name: "Top scorer", about: "", decidedBy: { kind: "stat", stat: "goals" } },
  { name: "Best keeper", about: "", decidedBy: { kind: "vote", voters: "skaters" } },
];

function threeTeams() {
  const v = blankPast();
  v.heldOn = "2026-04-17";
  v.teams = [
    { name: "A", captain: 1, players: [2] },
    { name: "B", captain: 3, players: [4] },
    { name: "C", captain: 5, players: [6] },
  ];
  return v;
}

describe("a past Kumite's answers", () => {
  it("each team against every other once, scores kept as teams come and go; the final between the top two", () => {
    const v = threeTeams();
    Object.assign(v, withMatches(v, true));
    expect(v.matches).toHaveLength(3);
    const cVsB = v.matches.find((m) => [m.home, m.away].sort().join() === "1,2")!;
    cVsB[cVsB.home === 2 ? "homeGoals" : "awayGoals"] = 5;
    Object.assign(v, withMatches(v, true));
    expect(v.matches.find((m) => [m.home, m.away].sort().join() === "1,2")).toBe(cVsB);
    // C top, B or A second: the final's C's
    v.final = finalOf(v);
    expect([v.final.home, v.final.away]).toContain(2);
    expect(pastProblem("Matches", v, "2026-10-06")).toMatch(/level/);
    v.final.homeGoals = 2;
    expect(pastProblem("Matches", v, "2026-10-06")).toBe("");
    expect(championsOf(v)).toBe(v.final.home);
  });

  it("the results' winners filled in, a vote left to choose; the body has the final last and only named scorers", () => {
    const v = threeTeams();
    Object.assign(v, withMatches(v, false));
    v.matches[0].homeGoals = 2;
    v.matches[0].scorers.home = [v.teams[v.matches[0].home].captain, null];
    v.winners = suggestedWinners(v, AWARDS, () => "F");
    expect(v.winners["Champions"].team).toBe(v.matches[0].home);
    expect(v.winners["Top scorer"].memberId).toBe(v.teams[v.matches[0].home].captain);
    expect(v.winners["Best keeper"]).toMatchObject({ team: null, memberId: null });
    const body = pastBody(1, "Kumite Spring 2026", v, AWARDS);
    expect(body.games).toHaveLength(3);
    expect(body.games[0].scorers.home).toEqual([v.teams[v.matches[0].home].captain, null]);
    expect(body.winners.map((w) => w.award)).toEqual(["Champions", "Top scorer"]);
  });

  it("a day gone by, two teams, every one with its captain and players", () => {
    const v = threeTeams();
    expect(pastProblem("When", { ...v, heldOn: "2026-10-06" }, "2026-10-06")).toMatch(/gone by/);
    expect(pastProblem("Teams", { ...v, teams: v.teams.slice(0, 1) }, "2026-10-06")).toMatch(/Two/);
    expect(pastProblem("Teams", { ...v, teams: [...v.teams, { name: "", captain: null, players: [] }] }, "")).toMatch(
      /captain/,
    );
  });
});
