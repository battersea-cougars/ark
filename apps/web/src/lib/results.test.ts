// A tournament's result on the website (ADR 0100): the penalties the team app recorded, per game (penalty minutes a
// side) and per player (beside their goals and assists), from the snapshot's rows.
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
    expect(e.scorers).toEqual([
      { name: "Sam J.", team: "Ants", goals: 1, assists: 0, pim: 2 },
      { name: "Dee F.", team: "Bees", goals: 0, assists: 0, pim: 5 },
    ]);
  });

  it("an old snapshot without penalties still builds: none", () => {
    const old = rows([]) as Partial<ResultRows>;
    delete old.penalties;
    const [e] = editionsFrom(old as ResultRows);
    expect(e.games[0]).toMatchObject({ homePim: 0, awayPim: 0 });
  });
});
