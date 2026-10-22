// Fixtures, results and playoffs (ADR 0061): once a tournament's teams are set (a draft closed, or the teams that
// entered), an admin has the app make the fixtures: a round robin, every team playing every other once, then the
// playoff games its settings ask for (a Final of 1st v 2nd; maybe 3rd v 4th), filled in from the table once the last
// group game has a result. Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fairFixtures, fairness } from "../../src/lib/fixtures";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const FINAL_AND_THIRD = [
  { name: "Final", home: 1, away: 2 },
  { name: "3rd place", home: 3, away: 4 },
];

async function people() {
  const dana = await w.signedIn("dana@example.com");
  const reg = await w.signedIn("reg@example.com");
  const sees = async () => (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = async (name: string) => (await sees()).members.find((m: Json) => m.name === name).id as number;
  return { dana, reg, sees, idOf };
}

/** A cup that four teams entered (or the names given), with a Final and a 3rd-place game. */
async function cup(names = ["Ants", "Bees", "Cats", "Dogs"]) {
  const p = await people();
  const res = await p.dana.call("POST", "/api/tournaments", {
    name: "Summer Cup",
    location: "Battersea Park",
    heldOn: "2026-11-14",
    startTime: "10:00",
    endTime: "15:00",
    status: "planned",
    feePence: 0,
    kind: "teams",
    playoffs: FINAL_AND_THIRD,
    teams: names.map((name) => ({ name, logo: null, captainMemberId: null, players: [] })),
  });
  expect(res.status).toBe(201);
  const id = res.body.id as number;
  const tournament = async () => (await p.sees()).tournaments.find((t: Json) => t.id === id);
  const teamId = async (name: string) => (await tournament()).teams.find((t: Json) => t.name === name).id as number;
  const make = (as = p.dana) => as.call("POST", `/api/tournaments/${id}/fixtures`);
  const score = (gameId: number, homeGoals: number, awayGoals: number, as = p.dana) =>
    as.call("PUT", `/api/tournaments/${id}/games/${gameId}`, { homeGoals, awayGoals });
  return { ...p, id, tournament, teamId, make, score };
}

describe("fixtures", () => {
  it("an admin has the app make a round robin: every team plays every other once, then the playoff games", async () => {
    const { make, tournament } = await cup();
    expect((await make()).status).toBe(200);
    const { games, teams } = await tournament();
    const group = games.filter((g: Json) => g.stage === "group");
    expect(group).toHaveLength(6);
    const pairs = new Set(group.map((g: Json) => [g.homeTeamId, g.awayTeamId].sort().join("-")));
    expect(pairs.size).toBe(6);
    // Each game its own round, in the day's order
    expect(group.map((g: Json) => g.round)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(teams.every((t: Json) => group.some((g: Json) => [g.homeTeamId, g.awayTeamId].includes(t.id)))).toBe(true);
    // The playoffs wait for the table
    expect(games.filter((g: Json) => g.stage === "playoff")).toEqual([
      expect.objectContaining({ name: "Final", homeSeed: 1, awaySeed: 2, homeTeamId: null, awayTeamId: null }),
      expect.objectContaining({ name: "3rd place", homeSeed: 3, awaySeed: 4, homeTeamId: null, awayTeamId: null }),
    ]);
  });

  it("the order gives everyone the longest break it can: with five teams, nobody plays twice running", async () => {
    // In rounds, one after another, a team would play the last game of a round and the first of the next
    const { make, tournament } = await cup(["Ants", "Bees", "Cats", "Dogs", "Eels"]);
    expect((await make()).status).toBe(200);
    const { games, teams } = await tournament();
    const group = games.filter((g: Json) => g.stage === "group");
    expect(group).toHaveLength(10);
    const teamIds = teams.map((t: Json) => t.id);
    expect(group.map((g: Json) => [g.homeTeamId, g.awayTeamId])).toEqual(fairFixtures(teamIds));
    group.slice(1).forEach((g: Json, i: number) => {
      const before = [group[i].homeTeamId, group[i].awayTeamId];
      expect(before).not.toContain(g.homeTeamId);
      expect(before).not.toContain(g.awayTeamId);
    });
    // The playoffs after, a round of their own
    expect(games.filter((g: Json) => g.stage === "playoff").map((g: Json) => g.round)).toEqual([11, 11]);
  });

  it("the last group result fills the playoffs from the table", async () => {
    const { make, score, tournament, teamId } = await cup();
    await make();
    const ids = {
      Ants: await teamId("Ants"),
      Bees: await teamId("Bees"),
      Cats: await teamId("Cats"),
      Dogs: await teamId("Dogs"),
    };
    // Ants win everything, Bees beat Cats and Dogs, Cats beat Dogs
    const rank = [ids.Ants, ids.Bees, ids.Cats, ids.Dogs];
    const group = (await tournament()).games.filter((g: Json) => g.stage === "group");
    for (const g of group) {
      const homeBetter = rank.indexOf(g.homeTeamId) < rank.indexOf(g.awayTeamId);
      expect((await score(g.id, homeBetter ? 2 : 0, homeBetter ? 0 : 2)).status).toBe(200);
    }
    const playoffs = (await tournament()).games.filter((g: Json) => g.stage === "playoff");
    expect(playoffs.map((g: Json) => [g.name, g.homeTeamId, g.awayTeamId])).toEqual([
      ["Final", ids.Ants, ids.Bees],
      ["3rd place", ids.Cats, ids.Dogs],
    ]);
  });

  it("can be made again until a game has a result, then they're locked", async () => {
    const { make, score, tournament } = await cup();
    await make();
    expect((await make()).status).toBe(200);
    expect((await tournament()).games.filter((g: Json) => g.stage === "group")).toHaveLength(6);
    const first = (await tournament()).games[0];
    await score(first.id, 1, 1);
    expect((await make()).status).toBe(409);
  });

  it("made again, the fixtures come in another order just as fair, never the one there was", async () => {
    const { make, tournament } = await cup(["Ants", "Bees", "Cats", "Dogs", "Eels"]);
    const order = async () =>
      (await tournament()).games
        .filter((g: Json) => g.stage === "group")
        .map((g: Json) => [g.homeTeamId, g.awayTeamId] as [number, number]);
    await make();
    const teamIds = (await tournament()).teams.map((t: Json) => t.id);
    const first = await order();
    // The first time, the fairest order itself
    expect(first).toEqual(fairFixtures(teamIds));
    const seen = [first];
    for (let i = 0; i < 3; i++) {
      expect((await make()).status).toBe(200);
      const again = await order();
      expect(again).not.toEqual(seen.at(-1));
      expect(fairness(again, teamIds)).toEqual(fairness(first, teamIds));
      expect(new Set(again.map((g: [number, number]) => [...g].sort().join("-")))).toEqual(
        new Set(first.map((g: [number, number]) => [...g].sort().join("-"))),
      );
      seen.push(again);
    }
    // The playoffs still wait at the end
    expect((await tournament()).games.filter((g: Json) => g.stage === "playoff").map((g: Json) => g.round)).toEqual([
      11, 11,
    ]);
  });

  it("members can't make fixtures or enter results", async () => {
    const { reg, make, score, tournament, dana } = await cup();
    expect((await make(reg)).status).toBe(403);
    await make(dana);
    expect((await score((await tournament()).games[0].id, 1, 0, reg)).status).toBe(403);
  });

  it("a captains' draft gets its fixtures as soon as it has its captains: the draft can come before or after", async () => {
    const { dana, sees, idOf } = await people();
    const res = await dana.call("POST", "/api/tournaments", {
      name: "The Kumite",
      location: "Battersea",
      heldOn: "2026-12-12",
      startTime: "11:00",
      endTime: "16:00",
      status: "open",
      feePence: 0,
      kind: "draft",
      draftOn: "2026-12-08",
      playoffs: [{ name: "Final", home: 1, away: 2 }],
      teams: [await idOf("Cara Captain"), await idOf("Cole Captain")].map((captainMemberId) => ({
        name: "",
        logo: null,
        captainMemberId,
        players: [],
      })),
    });
    const id = res.body.id;
    // Not opened yet: the teams are their captains, and that's enough to play each other
    expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
    // The draft opening and closing leaves them be
    await dana.call("POST", `/api/tournaments/${id}/draft/draw`, {});
    await dana.call("POST", `/api/tournaments/${id}/draft/open`, {});
    await dana.call("POST", `/api/tournaments/${id}/draft/close`, { leaveOut: true });
    const games = (await sees()).tournaments.find((t: Json) => t.id === id).games;
    expect(games.map((g: Json) => [g.stage, g.name])).toEqual([
      ["group", ""],
      ["playoff", "Final"],
    ]);
  });
});
