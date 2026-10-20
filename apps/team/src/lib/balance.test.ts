import { describe, expect, it } from "vitest";
import { TEAM_NAMES, type Player, type Position } from "../demo/data";
import { balance, compare, makeTeams, slotIn, teamCount, type Team } from "./balance";

// Made-up rosters. Ratings spread out; every third player a defender, every tenth a keeper; every fourth a Cougar.
function roster(n: number, tweak: (p: Player, i: number) => Player = (p) => p): Player[] {
  return Array.from({ length: n }, (_, i) =>
    tweak(
      {
        id: i + 1,
        name: `Player ${i + 1}`,
        position: i % 10 === 9 ? "G" : i % 3 === 0 ? "D" : "F",
        rating: 30 + ((i * 37) % 60),
        cougar: i % 4 === 0,
      },
      i,
    ),
  );
}

/** The old app's full-session fixture (its tests/solver.test.ts, in git history): 18 players, 6 defenders. */
const FULL_SESSION: Player[] = (
  [
    ["F", 80, false],
    ["F", 50, false],
    ["F", 75, false],
    ["D", 55, true],
    ["D", 65, false],
    ["F", 90, false],
    ["F", 40, true],
    ["F", 20, false],
    ["D", 65, true],
    ["D", 75, false],
    ["D", 70, false],
    ["D", 80, false],
    ["F", 65, true],
    ["F", 70, true],
    ["F", 70, false],
    ["F", 40, false],
    ["F", 50, true],
    ["F", 20, false],
  ] as [Position, number, boolean][]
).map(([position, rating, cougar], i) => ({ id: i + 1, name: `Player ${i + 1}`, position, rating, cougar }));

function check(players: Player[], teams: Team[]) {
  const byId = (id: number) => players.find((p) => p.id === id)!;
  const ids = teams.flatMap((t) => t.players);
  expect(new Set(ids).size, "everyone on a team once").toBe(players.length);
  expect(ids.length).toBe(players.length);
  const sizes = teams.map((t) => t.players.length);
  expect(Math.max(...sizes) - Math.min(...sizes), "sizes within one").toBeLessThanOrEqual(1);
  const cougars = players.filter((p) => p.cougar);
  if (cougars.length) {
    const team = teams.find((t) => t.name === "Cougars")!;
    const on = team.players.filter((id) => byId(id).cougar).length;
    expect(on, "as many Cougars together as fit").toBe(Math.min(cougars.length, Math.max(...sizes)));
  } else expect(teams.some((t) => t.name === "Cougars")).toBe(false);
  for (const position of ["G", "D"] as const) {
    const counts = teams.map((t) => t.players.filter((id) => byId(id).position === position).length);
    expect(Math.max(...counts) - Math.min(...counts), `${position} spread evenly`).toBeLessThanOrEqual(1);
  }
  const means = teams.map((t) => t.players.reduce((s, id) => s + byId(id).rating, 0) / t.players.length);
  return { sizes, means, spread: Math.max(...means) - Math.min(...means) };
}

describe("teamCount", () => {
  it("matches the archived solver's team sizes (3 to 7 a side)", () => {
    expect(teamCount(6)).toBe(2);
    expect(teamCount(14)).toBe(2);
    expect(teamCount(15)).toBe(3);
    expect(teamCount(21)).toBe(3);
    expect(teamCount(22)).toBe(4);
    expect(teamCount(30)).toBe(5);
  });
});

describe("makeTeams", () => {
  it.each([6, 14, 15, 21, 22, 30])("%i players: everyone placed, even sizes, Cougars together, ratings close", (n) => {
    const players = roster(n);
    const { spread } = check(players, makeTeams(players, TEAM_NAMES));
    expect(spread, "average ratings within a few points").toBeLessThanOrEqual(3);
  });

  it("balances the old app's full session as far as the Cougars allow", () => {
    const teams = makeTeams(FULL_SESSION, TEAM_NAMES);
    const { sizes, spread } = check(FULL_SESSION, teams);
    expect(sizes).toEqual([6, 6, 6]);
    // The six Cougars average 57.5 together, so the other two teams can't average under 61.25
    expect(spread).toBeLessThanOrEqual(4.2);
    expect(teams.map((t) => t.name)).toEqual(["Cougars", "White", "Black"]);
  });

  it("finds the best teams there are (checked against every split of a small roster)", () => {
    const players = roster(12, (p) => ({ ...p, position: p.position === "G" ? "F" : p.position }));
    const teams = makeTeams(players, TEAM_NAMES);
    const teamOf = players.map((p) => teams.findIndex((t) => t.players.includes(p.id)));
    const found = balance(players, teamOf, 2);
    // Every way of putting 12 players into two teams: team 0 is the set bits
    let best = found;
    for (let bits = 0; bits < 1 << 12; bits++) {
      const split = players.map((_, i) => ((bits >> i) & 1 ? 0 : 1));
      const b = balance(players, split, 2);
      if (compare(b, best) < 0) best = b;
    }
    expect(found).toEqual(best);
  });

  it("with more Cougars than a team holds, keeps a full team of them and balances the rest", () => {
    const players = roster(14, (p, i) => ({ ...p, cougar: i < 10 }));
    const teams = makeTeams(players, TEAM_NAMES);
    check(players, teams);
    expect(teams[0].name).toBe("Cougars");
    expect(teams[0].players.length).toBe(7);
  });

  it("with fewer defenders than teams, gives each defender their own team", () => {
    const players = roster(15, (p, i) => ({ ...p, position: i < 2 ? "D" : "F" }));
    const teams = makeTeams(players, TEAM_NAMES);
    check(players, teams);
    const withD = teams.filter((t) => t.players.some((id) => players[id - 1].position === "D"));
    expect(withD.length).toBe(2);
  });

  it("gives every team a keeper when there are enough", () => {
    const players = roster(21, (p, i) => ({ ...p, position: i < 3 ? "G" : p.position === "G" ? "F" : p.position }));
    const teams = makeTeams(players, TEAM_NAMES);
    check(players, teams);
    for (const t of teams) expect(t.players.filter((id) => players[id - 1].position === "G").length).toBe(1);
  });

  it("names the teams by colour when nobody is a Cougar", () => {
    const players = roster(8, (p) => ({ ...p, cougar: false }));
    expect(makeTeams(players, TEAM_NAMES).map((t) => t.name)).toEqual(["White", "Black"]);
  });

  it("gives the same players the same teams", () => {
    const players = roster(20);
    expect(makeTeams(players, TEAM_NAMES)).toEqual(makeTeams(players, TEAM_NAMES));
  });

  it("is quick enough for a phone: 30 players well under a second", () => {
    const players = roster(30);
    const t0 = performance.now();
    makeTeams(players, TEAM_NAMES);
    // A second, as it says: a phone does this in tens of ms; a tighter bound failed whenever the machine was busy
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("slotIn", () => {
  const p = (id: number, rating: number, position: Position = "F", cougar = false): Player => ({
    id,
    name: `P${id}`,
    position,
    rating,
    cougar,
  });
  const all = [p(1, 60, "F", true), p(2, 50), p(3, 20), p(4, 80, "F", true), p(5, 70), p(6, 30)];
  const by = (id: number) => all.find((x) => x.id === id)!;

  it("keeps the teams and adds late sign-ups to the weaker side, best first", () => {
    const teams = [
      { name: "Black", players: [2] },
      { name: "White", players: [3] },
    ];
    const out = slotIn(teams, [by(5), by(6)], by);
    expect(out[0].players.slice(0, 1)).toEqual([2]);
    expect(out[1].players).toEqual([3, 5]);
    expect(out[0].players).toEqual([2, 6]);
  });

  it("puts a Cougar on the Cougars", () => {
    const teams = [
      { name: "Cougars", players: [1] },
      { name: "White", players: [3] },
    ];
    expect(slotIn(teams, [by(4)], by)[0].players).toEqual([1, 4]);
  });

  it("evens out the numbers before the ratings", () => {
    const teams = [
      { name: "Black", players: [5, 2] },
      { name: "White", players: [4] },
    ];
    expect(slotIn(teams, [by(3)], by)[1].players).toEqual([4, 3]);
  });
});
