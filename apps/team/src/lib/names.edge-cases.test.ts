// Names at the edges, for the avatar's initials, the name someone goes by, search and a team's initials: double
// spaces, a lone first name, accents, emoji, nothing at all. Pure logic, so unit tests (ADR 0031).
import { describe, expect, it } from "vitest";
import { initials } from "./initials";
import { goesBy, matchesName, nameOfTeam, shortName } from "./names";
import { findPeople } from "./person-search";
import { teamInitials } from "./logo";

describe("a member's initials, on their avatar", () => {
  it.each([
    ["Jo Bloggs", "JB"],
    ["Jo  Bloggs", "JB"],
    ["Jean Paul Sartre", "JP"],
    ["Mary-Jane Watson", "MW"],
    ["Émile Zola", "ÉZ"],
    ["Cher", "C"],
    [" Jo", "J"],
    ["", ""],
  ])("%j is %j", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  // https://github.com/battersea-cougars/ark/issues/140
  // Known bug #140: the first character is taken as one UTF-16 unit, so an emoji (two) is cut in half
  // and the avatar shows a broken character
  it.fails("a name that starts with an emoji keeps the emoji whole (known bug #140)", () => {
    expect(initials("🦁 Leo")).toBe("🦁L");
  });
});

describe("the name someone goes by", () => {
  it("a chosen name of only spaces is no choice: their full name shows", () => {
    expect(goesBy({ name: "Jo Bloggs", webName: "   " })).toBe("Jo Bloggs");
    expect(shortName({ name: "Jo Bloggs", webName: "   " })).toBe("Jo");
  });

  it("a full name with spaces in front still gives their first name", () => {
    expect(shortName({ name: "  Jo Bloggs", webName: null })).toBe("Jo");
  });

  it("someone with no name at all is nothing, never undefined", () => {
    expect(shortName({ name: "" })).toBe("");
    expect(goesBy({ name: "" })).toBe("");
  });

  it("search ignores capitals and spaces round what's typed, in either name", () => {
    expect(matchesName({ name: "Jo Bloggs", webName: "Big Jo" }, "  BIG ")).toBe(true);
    expect(matchesName({ name: "Jo Bloggs", webName: null }, "BLOG")).toBe(true);
    expect(matchesName({ name: "Jo Bloggs", webName: null }, "")).toBe(true);
    expect(matchesName({ name: "Jo Bloggs", webName: null }, "zz")).toBe(false);
  });
});

describe("a team named for its captain", () => {
  const people = new Map([
    [1, { name: "Cher" }],
    [2, { name: "Cher" }],
    [3, { name: "Alex Brown" }],
  ]);
  const person = (id: number | null) => (id == null ? undefined : people.get(id));

  it("two captains with the same one-word name: each is their whole name, the same", () => {
    const teams = [
      { captainMemberId: 1, name: null },
      { captainMemberId: 2, name: null },
    ];
    expect(nameOfTeam(teams[0], teams, person)).toBe("Team Cher");
  });

  it("a team with no captain and no name is just Team; no team at all is nothing", () => {
    expect(nameOfTeam({ captainMemberId: null, name: null }, [], person)).toBe("Team");
    expect(nameOfTeam(undefined, [], person)).toBe("");
  });

  it("a captain who's left the club (not found) leaves the team as Team", () => {
    expect(nameOfTeam({ captainMemberId: 99, name: null }, [], person)).toBe("Team");
  });
});

describe("finding someone by typing", () => {
  const pool = [
    { id: 1, name: "Zed Adams" },
    { id: 2, name: "Adam Zed" },
    { id: 3, name: "Madam X" },
    { id: 4, name: "Bob" },
  ];

  it("names that start with it first, then a word that does, then any that has it", () => {
    expect(findPeople(pool, "adam").map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it("typing in capitals or with spaces round it finds the same", () => {
    expect(findPeople(pool, "  ADAM ").map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it("nothing typed is everyone, up to the limit; nothing matching is nobody", () => {
    expect(findPeople(pool, "")).toHaveLength(4);
    expect(findPeople(pool, "", 2)).toHaveLength(2);
    expect(findPeople(pool, "zz")).toEqual([]);
  });

  it("the limit keeps the best matches", () => {
    expect(findPeople(pool, "adam", 1).map((p) => p.id)).toEqual([2]);
  });

  it("an empty club finds nobody", () => {
    expect(findPeople([], "jo")).toEqual([]);
  });
});

describe("a team's initials, when it has no logo", () => {
  it.each([
    ["Team Dan", "TD"],
    ["The Dim Maks", "DM"],
    ["the dim maks", "DM"],
    ["Clapham  Crushers United", "CC"],
    ["Cougars", "C"],
    ["The", ""],
    ["   ", ""],
  ])("%j is %j", (name, expected) => {
    expect(teamInitials(name)).toBe(expected);
  });

  // https://github.com/battersea-cougars/ark/issues/140
  // Known bug #140: the same as a member's: an emoji is cut in half
  it.fails("a team named with an emoji keeps it whole (known bug #140)", () => {
    expect(teamInitials("Team 🦁")).toBe("T🦁");
  });
});
