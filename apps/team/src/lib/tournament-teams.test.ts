import { describe, expect, it } from "vitest";
import { teamsOf } from "./tournament-teams";
import { teamTone } from "./team-tones";

const people: Record<number, { name: string; webName?: string | null }> = {
  1: { name: "Alex Brown" },
  2: { name: "Alex Smith" },
  3: { name: "Jo King", webName: "The Joker" },
};
const person = (id: number | null) => (id ? people[id] : undefined);
const teams = [
  { id: 10, name: "", logo: null, captainMemberId: 1, players: [{ memberId: 4 }] },
  { id: 11, name: "", logo: "data:x", captainMemberId: 2, players: [] },
  { id: 12, name: "Ice Breakers", logo: null, captainMemberId: 3, players: [{ memberId: 5 }] },
];

describe("a tournament's teams, by id", () => {
  const t = teamsOf(teams, person);

  it("names each as the app does everywhere: its own name, else its captain's, two Alexes told apart", () => {
    expect(t.names).toEqual(["Team Alex B", "Team Alex S", "Ice Breakers"]);
    expect(t.nameOf(11)).toBe("Team Alex S");
    expect(t.nameOf(99)).toBe("");
  });

  it("gives each its logo and its colour by its place", () => {
    expect(t.logoOf(11)).toBe("data:x");
    expect(t.logoOf(10)).toBeNull();
    expect(t.toneOf(12)).toBe(teamTone(2));
  });

  it("finds whose team a member is on, captain or player", () => {
    expect(t.teamOf(3)).toBe(12);
    expect(t.teamOf(4)).toBe(10);
    expect(t.teamOf(9)).toBeNull();
  });
});
