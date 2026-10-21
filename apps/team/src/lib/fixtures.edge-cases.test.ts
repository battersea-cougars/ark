// The fixtures' and the table's edges (lib/fixtures.ts, packages/shared/results.ts): a round robin of every size (the
// odd team out sitting a round out), a table level on everything, a tournament's own points, games that don't count,
// who keeps score with three teams, kick-offs past midnight, and which playoff game crowns the champions.
import { describe, expect, it } from "vitest";
import { champion, kickOff, roundRobin, scorekeepers, table } from "./fixtures";

const g = (
  homeTeamId: number,
  awayTeamId: number,
  homeGoals: number | null,
  awayGoals: number | null,
  status?: string,
) => ({
  homeTeamId,
  awayTeamId,
  homeGoals,
  awayGoals,
  ...(status ? { status } : {}),
});
const key = ([a, b]: [number, number]) => [a, b].sort((x, y) => x - y).join("-");

describe("a round robin, whatever the number of teams", () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 12])("%i teams: every pair once, nobody twice in a round, fewest rounds", (n) => {
    const teams = Array.from({ length: n }, (_, i) => i + 1);
    const rounds = roundRobin(teams);
    const pairs = rounds.flat();
    expect(pairs).toHaveLength((n * (n - 1)) / 2);
    expect(new Set(pairs.map(key)).size).toBe(pairs.length);
    for (const r of rounds) expect(new Set(r.flat()).size).toBe(r.flat().length);
    // An even number plays every team each round; an odd number, one team sits each round out, a different one each time
    expect(rounds).toHaveLength(n % 2 ? n : n - 1);
    if (n % 2) {
      const sitting = rounds.map((r) => teams.find((t) => !r.flat().includes(t)));
      expect(new Set(sitting).size).toBe(n);
    }
  });

  it("one team, or none, has no games", () => {
    expect(roundRobin([7]).flat()).toEqual([]);
    expect(roundRobin([]).flat()).toEqual([]);
  });
});

describe("the table's tie-breaks", () => {
  it("everyone level on everything stays in the order the teams were given (pick order, or as they entered)", () => {
    const rows = table([30, 10, 20], [g(30, 10, 1, 1), g(10, 20, 0, 0), g(20, 30, 2, 2)]);
    // Level on points (2) and GD (0); goals for split them: 30 has 3, 20 has 2, 10 has 1
    expect(rows.map((r) => r.teamId)).toEqual([30, 20, 10]);
    const all = table([30, 10, 20], [g(30, 10, 0, 0), g(10, 20, 0, 0), g(20, 30, 0, 0)]);
    expect(all.map((r) => r.teamId)).toEqual([30, 10, 20]);
    expect(all.every((r) => r.pts === 2 && r.gf === 0 && r.ga === 0)).toBe(true);
  });

  it("level on points, goal difference first; level on that, goals scored", () => {
    // 1 and 2 both win once and lose once: 1 by 5–0 and 0–1 (GD +4), 2 by 1–0 and 0–1 (GD 0)
    const rows = table([1, 2, 3], [g(1, 3, 5, 0), g(2, 1, 1, 0), g(3, 2, 1, 0)]);
    expect(rows.map((r) => r.teamId)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ pts: 3, gf: 5, ga: 1 });
    // Same GD (+1), more goals for first
    const gf = table([1, 2], [g(1, 9, 3, 2), g(2, 9, 1, 0)]);
    expect(gf.map((r) => r.teamId)).toEqual([1, 2]);
  });

  it("there's no head to head: level on points, GD and goals, the order given decides, not who beat whom", () => {
    // 2 beat 1; each also beat or lost to a team from elsewhere: both 3 points, 1 for, 1 against
    const level = table([1, 2], [g(2, 1, 1, 0), g(1, 9, 1, 0), g(2, 9, 0, 1)]);
    expect(level.map((r) => [r.teamId, r.pts, r.gf, r.ga])).toEqual([
      [1, 3, 1, 1],
      [2, 3, 1, 1],
    ]);
  });

  it("uses the tournament's points: 2 a win, 1 a draw, and points for a loss too", () => {
    const rows = table([1, 2, 3], [g(1, 2, 1, 0), g(2, 3, 1, 1), g(3, 1, 0, 0)], { win: 2, draw: 1, loss: 1 });
    expect(Object.fromEntries(rows.map((r) => [r.teamId, r.pts]))).toEqual({ 1: 3, 2: 2, 3: 2 });
  });

  it("only finished games count: one on now, one with a team not known yet, or a team not in this tournament", () => {
    const rows = table(
      [1, 2],
      [
        g(1, 2, 3, 0, "live"),
        { homeTeamId: null, awayTeamId: 2, homeGoals: 1, awayGoals: 0, status: "done" },
        g(1, 99, 4, 0, "done"),
      ],
    );
    // The game against 99 counts for 1 (99 isn't on the table); the live one and the unknown one don't
    expect(rows.find((r) => r.teamId === 1)).toMatchObject({ p: 1, w: 1, gf: 4, pts: 3 });
    expect(rows.find((r) => r.teamId === 2)).toMatchObject({ p: 0, pts: 0 });
    expect(rows.map((r) => r.teamId)).not.toContain(99);
  });

  it("with no teams, an empty table", () => {
    expect(table([], [g(1, 2, 1, 0)])).toEqual([]);
  });
});

describe("the champions", () => {
  const game = (
    stage: "group" | "playoff",
    position: number,
    homeTeamId: number | null,
    awayTeamId: number | null,
    homeGoals: number | null,
    awayGoals: number | null,
    status = homeGoals === null ? "next" : "done",
  ) => ({ stage, position, homeTeamId, awayTeamId, homeGoals, awayGoals, status });

  it("the last playoff game of the day decides, whatever it's called: a 3rd-place game after the Final crowns its winner", () => {
    // The app's preset puts the 3rd-place game first and the Final last (PlayoffsField); a list made by hand the other
    // way round crowns the 3rd-place winner
    const games = [game("group", 1, 1, 2, 1, 0), game("playoff", 2, 1, 2, 3, 0), game("playoff", 3, 3, 4, 0, 1)];
    expect(champion([1, 2, 3, 4], games)).toBe(4);
  });

  it("a Final being played, even with someone ahead, crowns nobody yet", () => {
    expect(champion([1, 2], [game("group", 1, 1, 2, 1, 0), game("playoff", 2, 1, 2, 2, 0, "live")])).toBeNull();
  });

  it("without playoffs, a table level at the top crowns the first in the order given", () => {
    expect(champion([2, 1], [game("group", 1, 1, 2, 1, 1)])).toBe(2);
  });

  it("the tournament's own points decide the top of the table", () => {
    // 1 wins one and loses one; 2 wins one and draws one. 3-1-0: 2 is top on 4 to 3. With 2 points for a loss and
    // none for a draw, 1 is: 5 to 3
    const games = [game("group", 1, 1, 3, 1, 0), game("group", 2, 1, 2, 0, 1), game("group", 3, 2, 3, 1, 1)];
    expect(champion([1, 2, 3], games)).toBe(2);
    expect(champion([1, 2, 3], games, { win: 3, draw: 0, loss: 2 })).toBe(1);
  });
});

describe("who keeps score", () => {
  it("with three teams, the team sitting it out keeps score: the only one free", () => {
    const games = roundRobin([1, 2, 3])
      .flat()
      .map(([homeTeamId, awayTeamId], i) => ({ id: i + 1, homeTeamId, awayTeamId }));
    const keepers = scorekeepers([1, 2, 3], games);
    for (const game of games)
      expect(keepers.get(game.id)).toBe([1, 2, 3].find((t) => t !== game.homeTeamId && t !== game.awayTeamId));
  });

  // Five teams is the exception: taking turns game by game, the last game's free teams have all kept score twice and
  // the team that hasn't is playing, so it ends 3, 2, 2, 2, 1 (a suggestion: anyone can take the scoresheet)
  it.each([4, 6, 7, 8])("over a day of %i teams, nobody keeps score more than one game more than another", (n) => {
    const teams = Array.from({ length: n }, (_, i) => i + 1);
    const games = roundRobin(teams)
      .flat()
      .map(([homeTeamId, awayTeamId], i) => ({ id: i + 1, homeTeamId, awayTeamId }));
    const counts = new Map<number, number>();
    for (const t of scorekeepers(teams, games).values()) counts.set(t, (counts.get(t) ?? 0) + 1);
    expect(counts.size).toBe(n);
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
    expect([...counts.values()].reduce((a, b) => a + b)).toBe(games.length);
  });
});

describe("kick-off times", () => {
  it("the first game is at the start; a day running past midnight wraps to the small hours", () => {
    expect(kickOff("22:30", 25, 1)).toBe("22:30");
    // 30 minutes a game with the break: the 4th at 00:00, the 5th at 00:30
    expect(kickOff("22:30", 25, 4)).toBe("00:00");
    expect(kickOff("22:30", 25, 5)).toBe("00:30");
  });

  it("with no break between games, back to back", () => {
    expect(kickOff("10:00", 12, 3, 0)).toBe("10:24");
  });
});
