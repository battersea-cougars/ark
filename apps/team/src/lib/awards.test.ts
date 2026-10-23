// How each award's decided (ADR 0044): the stats we track, a draw, a vote counted, and awards saved before they said
// how. The tricky pure part; the routes that save, vote and reveal have their use cases in worker/tournaments.
import { describe, expect, it } from "vitest";
import {
  awardFromData,
  awardsToReveal,
  countVotes,
  decidedByOf,
  fromKey,
  keyOf,
  withDecidedBy,
  type Award,
  type Stat,
} from "./awards";

// Two teams: Ants (1, captain 10, goalie 12) and Bees (2, captain 20, goalie 22)
const teams = [
  { id: 1, captainMemberId: 10, players: [{ memberId: 11 }, { memberId: 12 }] },
  { id: 2, captainMemberId: 20, players: [{ memberId: 21 }, { memberId: 22 }] },
];
const positions: Record<number, string> = { 10: "F", 11: "D", 12: "G", 20: "F", 21: "D", 22: "G" };
const goal = (teamId: number, scorerId: number | null, assistId: number | null = null) => ({
  teamId,
  scorerId,
  assistId,
  atMs: 0,
  id: 0,
});
const sinBin = (memberId: number | null, minutes: number) => ({ memberId, minutes });
const game = (
  homeGoals: number,
  awayGoals: number,
  goals: ReturnType<typeof goal>[],
  penalties: ReturnType<typeof sinBin>[] = [],
) => ({
  stage: "group" as const,
  position: 1,
  homeTeamId: 1,
  awayTeamId: 2,
  homeGoals,
  awayGoals,
  status: "done",
  goals,
  penalties,
});
const t = {
  id: 7,
  teams,
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  games: [game(3, 1, [goal(1, 10), goal(1, 10), goal(1, 11), goal(2, 21)])],
};
const ctx = { positionOf: (id: number) => positions[id] };
const stat = (s: Stat, name = "Award"): Award => ({ name, about: "", decidedBy: { kind: "stat", stat: s } });
const ids = (r: ReturnType<typeof awardFromData>) => r?.winners.map((w) => w.memberId).sort();

describe("a stat we track", () => {
  it("no final: the top of the table are the champions", () => {
    expect(awardFromData(stat("table"), t, ctx)).toMatchObject({ winners: [{ teamId: 1 }], why: "Top of the table" });
  });

  it("with a final, the champions are its winner, even from second place", () => {
    // Ants top the table on the round robin; Bees win the final
    const final = { ...game(1, 2, [goal(1, 10), goal(2, 21), goal(2, 21)]), stage: "playoff" as const, position: 2 };
    const g = { ...t, games: [...t.games, final] };
    expect(awardFromData(stat("table"), g, ctx)).toMatchObject({ winners: [{ teamId: 2 }], why: "Won the final" });
  });

  it("most goals, and joint winners on a tie", () => {
    expect(awardFromData(stat("goals"), t, ctx)).toMatchObject({ winners: [{ memberId: 10 }], why: "2 goals" });
    const tied = { ...t, games: [game(1, 1, [goal(1, 10), goal(2, 21)])] };
    expect(ids(awardFromData(stat("goals"), tied, ctx))).toEqual([10, 21]);
  });

  it("most goals: level on goals, the most assists wins it", () => {
    const close = { ...t, games: [game(1, 1, [goal(1, 10), goal(2, 21, 22)]), game(1, 0, [goal(1, 11, 10)])] };
    // 10, 11 and 21 have a goal each; 10 also has an assist
    expect(awardFromData(stat("goals"), close, ctx)).toMatchObject({
      winners: [{ memberId: 10 }],
      why: "1 goal, 1 assist",
    });
  });

  it("most assists, level on assists the most goals", () => {
    const g = { ...t, games: [game(3, 1, [goal(1, 10, 11), goal(1, 11, 10), goal(1, 10, 12), goal(2, 21, 22)])] };
    // An assist each for 10, 11, 12 and 22; of them, 10 has two goals
    expect(awardFromData(stat("assists"), g, ctx)).toMatchObject({
      winners: [{ memberId: 10 }],
      why: "1 assist, 2 goals",
    });
  });

  it("most points, goals and assists together; level, the most goals", () => {
    const g = { ...t, games: [game(2, 1, [goal(1, 10, 11), goal(1, 11, 10), goal(2, 21, 22)])] };
    // 10 and 11 two points each (a goal and an assist), 21 and 22 one: still level, joint
    expect(ids(awardFromData(stat("points"), g, ctx))).toEqual([10, 11]);
    const more = { ...g, games: [...g.games, game(1, 0, [goal(1, 11)])] };
    expect(awardFromData(stat("points"), more, ctx)).toMatchObject({ winners: [{ memberId: 11 }], why: "3 points" });
  });

  it("fewest goals against a game: the goalie whose team let in fewest", () => {
    expect(awardFromData(stat("goalsAgainst"), t, ctx)).toMatchObject({
      winners: [{ memberId: 12 }],
      why: "1 against a game",
    });
  });

  it("most penalty minutes, bench penalties nobody's", () => {
    const g = {
      ...t,
      games: [game(1, 0, [goal(1, 10)], [sinBin(21, 2), sinBin(21, 2), sinBin(10, 2), sinBin(null, 5)])],
    };
    expect(awardFromData(stat("penaltyMinutes"), g, ctx)).toMatchObject({
      winners: [{ memberId: 21 }],
      why: "4 penalty minutes",
    });
    expect(awardFromData(stat("penaltyMinutes"), t, ctx)).toBeNull();
  });

  it("nothing played, nothing decided", () => {
    expect(awardFromData(stat("goals"), { ...t, games: [] }, ctx)).toBeNull();
  });
});

describe("drawn at random", () => {
  const dimMak: Award = { name: "Lucky dip", about: "", decidedBy: { kind: "random" } };
  it("a player who played, the same draw for the same seed", () => {
    const a = awardFromData(dimMak, t, { ...ctx, seed: 1 });
    expect(a?.random).toBe(true);
    expect([10, 11, 12, 20, 21, 22]).toContain(a?.winners[0].memberId);
    expect(awardFromData(dimMak, t, { ...ctx, seed: 1 })).toEqual(a);
  });

  it("Draw again: another seed draws again, and over a few draws more than one player comes up", () => {
    const drawn = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) => awardFromData(dimMak, t, { ...ctx, seed })?.winners[0].memberId),
    );
    expect(drawn.size).toBeGreaterThan(1);
  });
});

describe("a vote and a live call: decided at the reveal, not from the data", () => {
  it("nothing from the data for either", () => {
    expect(
      awardFromData({ name: "Best keeper", about: "", decidedBy: { kind: "vote", voters: "skaters" } }, t, ctx),
    ).toBeNull();
    expect(
      awardFromData({ name: "The Judges' Call", about: "", decidedBy: { kind: "live", options: [] } }, t, ctx),
    ).toBeNull();
  });
});

describe("counting a vote", () => {
  const goalie: Award = {
    name: "Best keeper",
    about: "",
    decidedBy: { kind: "vote", voters: "skaters", tieBreak: "goalsAgainst" },
  };
  const mvp: Award = { name: "MVP", about: "", decidedBy: { kind: "vote", voters: "players" } };

  it("the most votes wins", () => {
    expect(countVotes(mvp, [21, 21, 10], t, ctx)).toEqual({ winners: [21], tied: [] });
  });

  it("level on votes, the tie-break decides: fewest goals against a game", () => {
    // 12 (Ants let in 1) and 22 (Bees let in 3), a vote each
    expect(countVotes(goalie, [12, 22], t, ctx)).toEqual({ winners: [12], tied: [] });
  });

  it("level with no tie-break: the admin chooses among the level ones", () => {
    expect(countVotes(mvp, [10, 21], t, ctx)).toEqual({ winners: [], tied: [10, 21] });
  });

  it("level after the tie-break too: the admin chooses", () => {
    const even = { ...t, games: [game(1, 1, [goal(1, 10), goal(2, 21)])] };
    expect(countVotes(goalie, [12, 22], even, ctx).tied.sort()).toEqual([12, 22]);
  });

  it("nobody voted: the admin chooses among everyone eligible (no tie-break deciding it for them)", () => {
    expect(countVotes(goalie, [], t, ctx)).toEqual({ winners: [], tied: [12, 22] });
    expect(countVotes(mvp, [], t, ctx).tied).toHaveLength(6);
  });

  it("a vote for someone who can't win it doesn't count (a skater, for the goalie's)", () => {
    expect(countVotes(goalie, [10, 10, 22], t, ctx)).toEqual({ winners: [22], tied: [] });
  });
});

describe("awards saved before they said how: the old guess from the name, once", () => {
  it("Champions the table, a scorer most goals, a goalie fewest against, the Dim Mak a draw, anything else live", () => {
    expect(decidedByOf({ name: "Champions" })).toEqual({ kind: "stat", stat: "table" });
    expect(decidedByOf({ name: "Top scorer" })).toEqual({ kind: "stat", stat: "goals" });
    expect(decidedByOf({ name: "Best keeper" })).toEqual({ kind: "stat", stat: "goalsAgainst" });
    expect(decidedByOf({ name: "The Dim Mak" })).toEqual({ kind: "random" });
    expect(decidedByOf({ name: "Best hair" })).toEqual({ kind: "live", options: [] });
  });

  it("an old award still works from the data as it used to", () => {
    expect(awardFromData({ name: "Top scorer", about: "" }, t, ctx)).toMatchObject({ winners: [{ memberId: 10 }] });
    expect(awardFromData({ name: "Best hair", about: "" }, t, ctx)).toBeNull();
  });

  it("an editor writes the guess in, and what's said already stays as said", () => {
    const [old, said] = withDecidedBy([
      { name: "Top scorer", about: "" },
      { name: "Top scorer?", about: "", decidedBy: { kind: "stat", stat: "points" } },
    ]);
    expect(old.decidedBy).toEqual({ kind: "stat", stat: "goals" });
    expect(said.decidedBy).toEqual({ kind: "stat", stat: "points" });
  });

  it("the editor's one choice and back keeps a vote's tie-break", () => {
    const was = { kind: "vote", voters: "players", tieBreak: "points" } as const;
    expect(keyOf(was)).toBe("vote:players");
    expect(fromKey("vote:skaters", was)).toEqual({ kind: "vote", voters: "skaters", tieBreak: "points" });
    expect(fromKey("vote:skaters")).toEqual({ kind: "vote", voters: "skaters", tieBreak: "goalsAgainst" });
  });
});

describe("the awards revealed: a judges' call left out isn't one", () => {
  const awards: Award[] = [
    { name: "The Judges' Call", about: "", decidedBy: { kind: "live", options: [] } },
    { name: "Top scorer", about: "", decidedBy: { kind: "stat", stat: "goals" } },
    { name: "Most penalty minutes", about: "", decidedBy: { kind: "stat", stat: "penaltyMinutes" } },
    { name: "Champions", about: "", decidedBy: { kind: "stat", stat: "table" } },
  ];

  it("every award in the admin's order, the judges' call too once it's given", () => {
    const given = ["The Judges' Call", "Top scorer", "Champions"];
    expect(awardsToReveal(awards, given).map((a) => a.name)).toEqual(awards.map((a) => a.name));
  });

  it("the judges' call nobody was given is left out; a stat nobody won stays (Nobody this time)", () => {
    expect(awardsToReveal(awards, ["Top scorer", "Champions"]).map((a) => a.name)).toEqual([
      "Top scorer",
      "Most penalty minutes",
      "Champions",
    ]);
  });
});
