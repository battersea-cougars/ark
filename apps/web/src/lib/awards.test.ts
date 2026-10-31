import { describe, expect, it } from "vitest";
import { championsFirst, isChampions } from "./awards";

describe("the awards on the website", () => {
  it("start with the champions, the rest in the team app's order", () => {
    const awards = [
      { name: "The Judges' Call", decidedBy: { kind: "live" } },
      { name: "Top scorer", decidedBy: { kind: "stat", stat: "goals" } },
      { name: "Best keeper", decidedBy: { kind: "vote" } },
      { name: "Last team standing", decidedBy: { kind: "stat", stat: "table" } },
    ];
    expect(championsFirst(awards).map((a) => a.name)).toEqual([
      "Last team standing",
      "The Judges' Call",
      "Top scorer",
      "Best keeper",
    ]);
  });

  it("know the champions by the table that decides them, or, saved before awards said how, by the name", () => {
    expect(isChampions({ name: "Champions" })).toBe(true);
    expect(isChampions({ name: "Champions of fun", decidedBy: { kind: "random" } })).toBe(false);
    expect(isChampions({ name: "Top scorer" })).toBe(false);
  });
});
