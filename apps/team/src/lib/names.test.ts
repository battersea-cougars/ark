import { describe, expect, it } from "vitest";
import { shortName, goesBy, matchesName, nameOfMember, nameOfPlayer, nameOfTeam } from "./names";

const adrian = { name: "Adrian Kaczmarczyk", webName: null };
const wall = { name: "Sam Jones", webName: "The Wall" };

describe("the name a member goes by", () => {
  it("is the name they chose on their profile, everywhere in the app", () => {
    expect(goesBy(wall)).toBe("The Wall");
    expect(goesBy({ name: "Dana Smith", webName: "Dana S." })).toBe("Dana S.");
  });

  it("is their full name when they haven't chosen one", () => {
    expect(goesBy(adrian)).toBe("Adrian Kaczmarczyk");
    expect(goesBy({ name: "Ethan", webName: "  " })).toBe("Ethan");
  });

  it("uses a chosen name whole where the app says just a first name (the card, greetings), and otherwise their first name", () => {
    expect(shortName(wall)).toBe("The Wall");
    expect(shortName(adrian)).toBe("Adrian");
    expect(shortName({ name: "Dana Smith", webName: "Dana S." })).toBe("Dana S.");
  });

  it("finds them by either name when searching", () => {
    expect(matchesName(wall, "wall")).toBe(true);
    expect(matchesName(wall, "sam")).toBe(true);
    expect(matchesName(adrian, "kacz")).toBe(true);
    expect(matchesName(adrian, "wall")).toBe(false);
  });
});

describe("a team's name", () => {
  const people = [
    { id: 1, name: "Alex Brown", webName: null },
    { id: 2, name: "Alex Smith", webName: null },
    { id: 3, name: "Jo Kerr", webName: null },
    { id: 4, name: "Alex Bell", webName: null },
  ];
  const person = (id: number | null) => people.find((p) => p.id === id);
  const team = (captainMemberId: number, name = "") => ({ name, captainMemberId });

  it("is its own name, else its captain's", () => {
    const teams = [team(1, "Red Lions"), team(3)];
    expect(teams.map((t) => nameOfTeam(t, teams, person))).toEqual(["Red Lions", "Team Jo"]);
  });

  it("adds a surname initial when two captains share a first name, so the fight card never reads Alex v Alex", () => {
    const teams = [team(1), team(2), team(3)];
    expect(teams.map((t) => nameOfTeam(t, teams, person))).toEqual(["Team Alex B", "Team Alex S", "Team Jo"]);
  });

  it("uses the full name when the initials match too, and leaves a team with its own name out of it", () => {
    const teams = [team(1), team(4), team(2, "Smithy's")];
    expect(teams.map((t) => nameOfTeam(t, teams, person))).toEqual(["Team Alex Brown", "Team Alex Bell", "Smithy's"]);
  });
});

describe("someone who's left, in the club's history", () => {
  // A plain member's app holds only the members still in the club (ADR 0029): one made inactive or erased isn't there
  const people = [{ id: 1, name: "Noel Bramble", webName: null }];
  const person = (id: number | null) => people.find((p) => p.id === id);

  it("a past goal, assist, penalty or award by someone the viewer can't see reads Someone who's left, never a blank", () => {
    expect(nameOfMember(7, person)).toBe("Someone who's left");
    expect(`Assist · ${nameOfMember(7, person)}`).toBe("Assist · Someone who's left");
  });

  it("someone still in the club, or an admin's view of who left, is their name as ever", () => {
    expect(nameOfMember(1, person)).toBe("Noel Bramble");
    expect(nameOfMember(9, () => ({ name: "Former member" }))).toBe("Former member");
  });

  it("nobody (no assist, no scorer given) is still nothing", () => {
    expect(nameOfMember(null, person)).toBe("");
    expect(nameOfMember(undefined, person)).toBe("");
  });

  it("a player on a team is the member by name, someone who's left, or a player from outside by the name entered", () => {
    expect(nameOfPlayer({ memberId: 1, name: "" }, person)).toBe("Noel Bramble");
    expect(nameOfPlayer({ memberId: 7, name: "" }, person)).toBe("Someone who's left");
    expect(nameOfPlayer({ memberId: null, name: "Ringer Rick" }, person)).toBe("Ringer Rick");
  });
});
