// A team's roster, as a game, the team's page and the teams list show it: captain first, then the players in order,
// someone who's left kept in their place by "Someone who's left". Pure logic, so unit tests (ADR 0031).
import { describe, expect, it } from "vitest";
import { rosterOf } from "./team-roster";
import { team } from "./kumite.testing";

const people = [
  { id: 1, name: "Noel Bramble", webName: null, position: "F" as const },
  { id: 2, name: "Sam Jones", webName: "The Wall", position: "G" as const },
];
const person = (id: number | null) => people.find((p) => p.id === id);

describe("a team's roster", () => {
  it("is its captain first, then its players in order, each by the name they go by and their position", () => {
    expect(rosterOf(team(10, 1, [2]), person).map((r) => [r.name, r.position, r.captain])).toEqual([
      ["Noel Bramble", "F", true],
      ["The Wall", "G", false],
    ]);
  });

  it("keeps someone who's left on a past game's roster, as Someone who's left, in their place and with no position", () => {
    expect(rosterOf(team(10, 7, [1, 8, 2]), person).map((r) => [r.memberId, r.name, r.position, r.captain])).toEqual([
      [7, "Someone who's left", undefined, true],
      [1, "Noel Bramble", "F", false],
      [8, "Someone who's left", undefined, false],
      [2, "The Wall", "G", false],
    ]);
  });

  it("names a player from outside the club, and a captain from outside, by the name entered", () => {
    const entered = {
      ...team(10, 0, []),
      captainMemberId: null,
      captainName: "Kim Ross",
      players: [{ memberId: null, name: "Ringer Rick" }],
    };
    expect(rosterOf(entered, person).map((r) => [r.name, r.captain])).toEqual([
      ["Kim Ross", true],
      ["Ringer Rick", false],
    ]);
  });

  it("has no captain row for a team with no captain", () => {
    const captainless = { ...team(10, 0, [1]), captainMemberId: null };
    expect(rosterOf(captainless, person).map((r) => r.name)).toEqual(["Noel Bramble"]);
  });
});
