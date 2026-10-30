// A tournament's result on the website (ADR 0100), as the team app shows a past one (lib/EditionResults): how the
// champions won it, the final, the fight card in order, the board, the leaders and the awards; and the penalties the
// team app recorded, per game (penalty minutes a side) and per player (beside their goals and assists), from the
// snapshot's rows.
import { describe, expect, it } from "vitest";
import { editionsFrom, type ResultRows } from "./results";

const rows = (penalties: ResultRows["penalties"]): ResultRows => ({
  tournaments: [
    {
      id: 1,
      name: "Summer Kumite",
      heldOn: "2026-09-12",
      status: "finished",
      season: null,
      awards: "[]",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      seriesSlug: null,
      seriesName: null,
    },
  ],
  games: [
    {
      id: 10,
      tournamentId: 1,
      stage: "group",
      name: "",
      position: 1,
      homeTeamId: 100,
      awayTeamId: 200,
      homeGoals: 1,
      awayGoals: 0,
      status: "done",
    },
  ],
  teams: [
    {
      id: 100,
      tournamentId: 1,
      name: "Ants",
      logo: null,
      captainName: "Sam Jones",
      captainWebName: null,
      outsideCaptain: "",
    },
    {
      id: 200,
      tournamentId: 1,
      name: "Bees",
      logo: null,
      captainName: "Dee Fence",
      captainWebName: null,
      outsideCaptain: "",
    },
  ],
  players: [],
  goals: [
    {
      tournamentId: 1,
      teamId: 100,
      scorerId: 7,
      scorerName: "Sam Jones",
      scorerWebName: null,
      assistId: null,
      assistName: null,
      assistWebName: null,
    },
  ],
  winners: [],
  penalties,
});
const pen = (gameId: number, teamId: number, memberId: number | null, name: string | null, minutes: number) => ({
  tournamentId: 1,
  gameId,
  teamId,
  memberId,
  memberName: name,
  memberWebName: null,
  minutes,
});

describe("penalties on a result", () => {
  it("each game says its penalty minutes a side", () => {
    const [e] = editionsFrom(
      rows([pen(10, 100, 7, "Sam Jones", 2), pen(10, 200, null, null, 2), pen(10, 200, 8, "Dee Fence", 5)]),
    );
    expect(e.games[0]).toMatchObject({ homePim: 2, awayPim: 7 });
  });

  it("each player's minutes go beside their goals and assists; someone with only penalties is there too", () => {
    const [e] = editionsFrom(rows([pen(10, 100, 7, "Sam Jones", 2), pen(10, 200, 8, "Dee Fence", 5)]));
    expect(e.leaders).toEqual([
      { name: "Sam J.", team: "Ants", goals: 1, assists: 0, points: 1, pim: 2 },
      { name: "Dee F.", team: "Bees", goals: 0, assists: 0, points: 0, pim: 5 },
    ]);
  });

  it("an old snapshot without penalties still builds: none", () => {
    const old = rows([]) as Partial<ResultRows>;
    delete old.penalties;
    const [e] = editionsFrom(old as ResultRows);
    expect(e.games[0]).toMatchObject({ homePim: 0, awayPim: 0 });
  });
});

// A Kumite of three teams: a round robin, then a final between the top two
type GameRow = ResultRows["games"][number];
const game = (id: number, stage: GameRow["stage"], home: number, away: number, hg: number, ag: number): GameRow => ({
  id,
  tournamentId: 1,
  stage,
  name: stage === "playoff" ? "Final" : "",
  position: id,
  homeTeamId: home,
  awayTeamId: away,
  homeGoals: hg,
  awayGoals: ag,
  status: "done",
});
const goal = (teamId: number, scorer: [number, string] | null, assist: [number, string] | null = null) => ({
  tournamentId: 1,
  teamId,
  scorerId: scorer?.[0] ?? null,
  scorerName: scorer?.[1] ?? null,
  scorerWebName: null,
  assistId: assist?.[0] ?? null,
  assistName: assist?.[1] ?? null,
  assistWebName: null,
});
const team = (id: number, name: string, captainName: string) => ({
  id,
  tournamentId: 1,
  name,
  logo: null,
  captainName,
  captainWebName: null,
  outsideCaptain: "",
});
const kumite = (games: GameRow[], winners: ResultRows["winners"] = []): ResultRows => ({
  ...rows([]),
  tournaments: [
    {
      ...rows([]).tournaments[0],
      awards: JSON.stringify([
        { name: "Champions", decidedBy: { kind: "stat", stat: "table" } },
        { name: "Top scorer", about: "Most goals" },
      ]),
      seriesSlug: "kumite",
      seriesName: "The Cougars Kumite",
    },
  ],
  // Fed in out of order, as the snapshot may have them
  games: [...games].reverse(),
  teams: [team(100, "Ants", "Sam Jones"), team(200, "Bees", "Dee Fence"), team(300, "", "Cal Mason")],
  goals: [
    goal(100, [7, "Sam Jones"]),
    goal(100, [7, "Sam Jones"]),
    goal(200, [8, "Dee Fence"], [9, "Ivy Hart"]),
    goal(200, [9, "Ivy Hart"], [8, "Dee Fence"]),
    goal(200, null, [9, "Ivy Hart"]),
  ],
  winners,
});
const roundRobin = [
  game(1, "group", 100, 200, 2, 1),
  game(2, "group", 200, 300, 3, 0),
  game(3, "group", 300, 100, 1, 1),
];

describe("a past Kumite's results, as the team app shows them", () => {
  it("the champions say how they won it: the final's score, from their side", () => {
    const [e] = editionsFrom(kumite([...roundRobin, game(4, "playoff", 100, 200, 1, 3)]));
    expect(e).toMatchObject({ champions: "Bees", championsId: 200, championsHow: "Beat Ants 3–1 in the final" });
  });

  it("without playoffs, the top of the table, with their points and games", () => {
    const [e] = editionsFrom(kumite(roundRobin));
    expect(e).toMatchObject({ champions: "Ants", championsHow: "Top of the table, 4 points from 2" });
  });

  it("the final is the last playoff; the fight card is every game in the order they were played", () => {
    const [e] = editionsFrom(kumite([...roundRobin, game(4, "playoff", 100, 200, 1, 3)]));
    expect(e.final).toMatchObject({ id: 4, homeId: 100, awayId: 200, home: "Ants", away: "Bees" });
    expect(e.games.map((g) => g.id)).toEqual([1, 2, 3, 4]);
  });

  it("no playoffs, no final", () => {
    expect(editionsFrom(kumite(roundRobin))[0].final).toBeNull();
  });

  it("the board counts the group games only: the final decides the champions, not the places", () => {
    const [e] = editionsFrom(kumite([...roundRobin, game(4, "playoff", 100, 200, 1, 3)]));
    expect(e.table.map((r) => [r.name, r.p, r.pts])).toEqual([
      ["Ants", 2, 4],
      ["Bees", 2, 3],
      ["Team Cal", 2, 1],
    ]);
  });

  it("the leaders: most points (goals and assists together) first, then most goals", () => {
    const [e] = editionsFrom(kumite(roundRobin));
    expect(e.leaders.map((l) => [l.name, l.goals, l.assists, l.points])).toEqual([
      ["Ivy H.", 1, 2, 3],
      ["Sam J.", 2, 0, 2],
      ["Dee F.", 1, 1, 2],
    ]);
  });

  it("a team without a logo has initials for its crest, no two alike", () => {
    const [e] = editionsFrom(kumite(roundRobin));
    expect(e.teams.map((t) => [t.name, t.crest, t.initials])).toEqual([
      ["Ants", null, "AN"],
      ["Bees", null, "BE"],
      ["Team Cal", null, "CA"],
    ]);
  });

  it("an award won by a team carries the team, for its crest; one won by a player names only them", () => {
    const winner = (award: string, teamId: number | null, memberName: string | null) => ({
      tournamentId: 1,
      award,
      teamId,
      memberName,
      memberWebName: null,
    });
    const [e] = editionsFrom(
      kumite(roundRobin, [winner("Champions", 100, null), winner("Top scorer", null, "Sam Jones")]),
    );
    expect(e.awards).toEqual([
      { name: "Champions", about: "", winners: [{ name: "Ants", teamId: 100 }] },
      { name: "Top scorer", about: "Most goals", winners: [{ name: "Sam J.", teamId: null }] },
    ]);
  });
});
