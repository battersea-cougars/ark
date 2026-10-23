// Names at the edges, for the avatar's initials, the name someone goes by, search and a team's initials: double
// spaces, a lone first name, accents, emoji, nothing at all. Pure logic, so unit tests (ADR 0031).
import { describe, expect, it } from "vitest";
import { initials } from "./initials";
import { goesBy, matchesName, nameOfTeam, shortName } from "./names";
import { teamInitials } from "./logo";

describe("a member's initials, on their avatar", () => {
  // #140: the first character was one UTF-16 unit, half an emoji, a broken character on the avatar
  it("a name that starts with an emoji keeps the emoji whole (#140)", () => {
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

  it("search finds a name with an accent typed without it (#118)", () => {
    expect(matchesName({ name: "Zoë Adams", webName: null }, "zoe")).toBe(true);
    expect(matchesName({ name: "Jo Bloggs", webName: "Seán" }, "sean")).toBe(true);
    expect(matchesName({ name: "Seán Byrne", webName: null }, "seán")).toBe(true);
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

describe("a team's initials, when it has no logo", () => {
  it.each([
    // A generic first word (Team, The, FC, Club) is skipped, so two "Team" sides don't share a crest
    ["Team Dan", "DA"],
    ["The Dim Maks", "DM"],
    ["the dim maks", "DM"],
    ["Clapham  Crushers United", "CC"],
    ["Cougars", "CO"],
    ["The", "TH"],
    ["   ", ""],
  ])("%j is %j", (name, expected) => {
    expect(teamInitials(name)).toBe(expected);
  });

  // #140: the same as a member's, an emoji was cut in half ("Team" is generic, so "Team 🦁" is known by its 🦁)
  it("a team named with an emoji keeps it whole (#140)", () => {
    expect(teamInitials("🦁 Pride")).toBe("🦁P");
    expect(teamInitials("Team 🦁")).toBe("🦁");
    expect(teamInitials("🦁🐯")).toBe("🦁🐯");
    expect(teamInitials("🦁 Pride", ["🦁 Pride", "🦁 Paws"])).toBe("🦁P");
  });
});
