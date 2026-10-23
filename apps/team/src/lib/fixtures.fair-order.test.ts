// The day's order of the round robin (lib/fixtures.ts fairOrder, ADR 0061): everyone gets the longest break the
// teams allow, nobody plays twice running unless it can't be helped, and the short breaks are shared out. Checked
// against every order there is, where that's quick enough.
import { describe, expect, it } from "vitest";
import { fairFixtures, fairness, fairOrder, rests, roundRobin } from "./fixtures";

const teamsOf = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const key = ([a, b]: [number, number]) => [a, b].sort((x, y) => x - y).join("-");
const games = (n: number) => roundRobin(teamsOf(n)).flat();

/** What fairOrder is judged on first: the shortest break, then how often any one team gets it, and in all. */
function judged(order: [number, number][], teams: number[]) {
  const gaps = [...rests(order, teams).values()];
  const shortest = Math.min(...gaps.flat());
  const short = gaps.map((g) => g.filter((r) => r === shortest).length);
  return { shortest, mostForOneTeam: Math.max(...short), inAll: short.reduce((x, y) => x + y, 0) };
}

/**
 * The best of every order of n teams' games where nobody's break is under `atLeast` (the first game fixed: teams are
 * alike), and how many there are.
 */
function everyOrder(n: number, atLeast: number) {
  const teams = teamsOf(n);
  const all = games(n);
  let count = 0;
  let best: ReturnType<typeof judged> | null = null;
  const go = (order: [number, number][], left: [number, number][]) => {
    if (!left.length) {
      count++;
      const j = judged(order, teams);
      if (
        !best ||
        j.mostForOneTeam < best.mostForOneTeam ||
        (j.mostForOneTeam === best.mostForOneTeam && j.inAll < best.inAll)
      )
        best = j;
      return;
    }
    left.forEach((g, i) => {
      if (atLeast && order.slice(-atLeast).some((h) => h.some((t) => g.includes(t)))) return;
      go([...order, g], [...left.slice(0, i), ...left.slice(i + 1)]);
    });
  };
  go([all[0]], all.slice(1));
  return { count, best: best as ReturnType<typeof judged> | null };
}

describe("the day's order: the longest break for everyone", () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 10])("%i teams: every pairing exactly once, nothing added or lost", (n) => {
    for (const order of [fairOrder(games(n), teamsOf(n)), fairFixtures(teamsOf(n))]) {
      expect(order).toHaveLength((n * (n - 1)) / 2);
      expect(new Set(order.map(key))).toEqual(new Set(games(n).map(key)));
    }
  });

  // [teams, the longest shortest break, then the fewest times one team gets it, and in all], each the best of every
  // order there is: a longer break would need more teams than there are in a row of games (or, with an even number,
  // the same pairing to come round again). 6 teams has 706,560 orders with a break of 1: too slow to try here, but
  // tried once (2, 7)
  it.each([
    [3, 0, 1, 2],
    [4, 0, 1, 2],
    [5, 1, 3, 8],
    [6, 1, 2, 7],
    [7, 2, 5, 18],
  ])("%i teams: the shortest break is %i games, for one team at most %i times, %i in all", (n, b, most, inAll) => {
    const teams = teamsOf(n);
    expect(judged(fairOrder(games(n), teams), teams)).toEqual({ shortest: b, mostForOneTeam: most, inAll });
    if (n === 6) return;
    expect(everyOrder(n, b + 1).count).toBe(0);
    expect(everyOrder(n, b).best).toEqual({ shortest: b, mostForOneTeam: most, inAll });
  });

  it("3 teams: playing twice running can't be helped, but it's never the same team twice", () => {
    const teams = teamsOf(3);
    for (const gaps of rests(fairOrder(games(3), teams), teams).values())
      expect(gaps.filter((r) => r === 0).length).toBeLessThanOrEqual(1);
  });

  it("4 teams: only opposite pairings miss each other, so two back-to-backs, by two different teams", () => {
    const teams = teamsOf(4);
    const backToBack = [...rests(fairOrder(games(4), teams), teams)].filter(([, gaps]) => gaps.includes(0));
    expect(backToBack).toHaveLength(2);
  });

  it("is better than the rounds in order, which put a team out twice running at the turn of a round", () => {
    // 5 teams: a team twice running; 7: a break of only one game
    expect(judged(games(5), teamsOf(5)).shortest).toBe(0);
    expect(judged(fairOrder(games(5), teamsOf(5)), teamsOf(5)).shortest).toBe(1);
    expect(judged(games(7), teamsOf(7)).shortest).toBe(1);
    expect(judged(fairOrder(games(7), teamsOf(7)), teamsOf(7)).shortest).toBe(2);
    // With an even number the rounds in order already give the longest break, but more teams get it short
    expect(judged(games(6), teamsOf(6)).inAll).toBeGreaterThan(7);
  });

  it("nobody waits long for a first game: everyone's on within the first round's worth", () => {
    for (const n of [4, 5, 6, 7, 8]) {
      const order = fairOrder(games(n), teamsOf(n));
      const firsts = teamsOf(n).map((t) => order.findIndex((g) => g.includes(t)));
      expect(Math.max(...firsts)).toBeLessThan(Math.ceil(n / 2) + 1);
    }
  });

  it("the last group game's teams, one of whom may go straight into the first playoff, aren't coming off a game", () => {
    for (const n of [5, 6, 7, 8]) {
      const order = fairOrder(games(n), teamsOf(n));
      const gaps = rests(order, teamsOf(n));
      for (const t of order.at(-1)!) expect(gaps.get(t)!.at(-1)).toBeGreaterThan(0);
    }
  });

  it("the same teams always get the same order", () => {
    for (const n of [3, 4, 5, 6, 8]) expect(fairOrder(games(n), teamsOf(n))).toEqual(fairOrder(games(n), teamsOf(n)));
  });

  it("sides take turns: home and away even for every team, give or take one", () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const order = fairFixtures(teamsOf(n));
      for (const t of teamsOf(n)) {
        const home = order.filter(([h]) => h === t).length;
        const played = order.filter((g) => g.includes(t)).length;
        expect(Math.abs(2 * home - played)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("making the fixtures uses the search's answer, inside the Worker's 10 ms", () => {
  it.each([2, 3, 4, 5, 6, 7, 8])("%i teams: the table is what fairOrder finds, for any teams", (n) => {
    const ids = teamsOf(n).map((i) => 100 + i * 7);
    expect(fairFixtures(ids)).toEqual(fairOrder(roundRobin(ids).flat(), ids));
  });

  it("more teams than the table: a short look past the greedy order, still a game off for everyone", () => {
    fairFixtures(teamsOf(12));
    // The fastest of a few runs: what the code costs, not how busy the machine running the whole suite is
    let fastest = Infinity;
    let order: [number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      order = fairFixtures(teamsOf(12));
      fastest = Math.min(fastest, performance.now() - started);
    }
    expect(fastest).toBeLessThan(10);
    expect(judged(order, teamsOf(12)).shortest).toBeGreaterThanOrEqual(3);
  });
});

describe("making them again: another order just as fair", () => {
  const sides = (order: [number, number][], t: number) => order.filter(([h]) => h === t).length;

  it.each([2, 3, 4, 5, 6, 7, 8, 10])(
    "%i teams: every seed's order is as fair as the first, every pairing once",
    (n) => {
      const teams = teamsOf(n);
      const fairest = fairness(fairFixtures(teams), teams);
      for (let seed = 1; seed <= 40; seed++) {
        const order = fairFixtures(teams, seed);
        expect(fairness(order, teams)).toEqual(fairest);
        expect(order).toHaveLength(games(n).length);
        expect(new Set(order.map(key))).toEqual(new Set(games(n).map(key)));
        for (const t of teams) expect(Math.abs(2 * sides(order, t) - (n - 1))).toBeLessThanOrEqual(1);
      }
    },
  );

  it.each([3, 4, 5, 6, 7, 8])("%i teams: two seeds give two different orders; the same seed, the same", (n) => {
    const teams = teamsOf(n);
    expect(fairFixtures(teams, 1)).not.toEqual(fairFixtures(teams, 2));
    expect(fairFixtures(teams, 7)).toEqual(fairFixtures(teams, 7));
    const seen = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(fairFixtures(teams, s))));
    expect(seen.size).toBeGreaterThan(5);
  });

  it("stays inside the Worker's 10 ms", () => {
    fairFixtures(teamsOf(8), 1);
    const started = performance.now();
    fairFixtures(teamsOf(8), 2);
    expect(performance.now() - started).toBeLessThan(10);
  });
});
