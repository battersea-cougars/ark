// A tournament's games (ADR 0061), shared by the Worker (making fixtures, filling the playoffs) and the app (the
// Games and Standings pages): a round robin by the circle method, played in the order fairest to everyone's breaks,
// kick-off times and who keeps score. The table and the champions are shared with the website
// (packages/shared/results.ts, ADR 0100).
import { londonTime } from "./dates";
export { champion, table, type Result, type TableRow } from "@cougars/shared/results";

/** How many teams a tournament's playoffs need: the lowest place they take (3rd v 4th needs 4); 0 for none. */
export const teamsForPlayoffs = (playoffs: { home: number; away: number }[]) =>
  Math.max(0, ...playoffs.flatMap((p) => [p.home, p.away]));

/** Every team plays every other once, in rounds where nobody plays twice (the circle method). */
export function roundRobin(teamIds: number[]): [number, number][][] {
  const ids = teamIds.length % 2 ? [...teamIds, -1] : [...teamIds];
  const rounds: [number, number][][] = [];
  for (let r = 0; r < ids.length - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < ids.length / 2; i++) {
      const a = ids[i];
      const b = ids[ids.length - 1 - i];
      if (a !== -1 && b !== -1) round.push([a, b]);
    }
    rounds.push(round);
    ids.splice(1, 0, ids.pop()!);
  }
  return rounds;
}

/**
 * Each team's breaks in a day's order: for every two of its games in a row, how many games are played in between (0:
 * twice running). In the teams' order.
 */
export function rests(order: [number, number][], teamIds: number[]): Map<number, number[]> {
  const out = new Map(teamIds.map((t) => [t, [] as number[]]));
  const last = new Map<number, number>();
  order.forEach((g, at) => {
    for (const t of g) {
      if (last.has(t)) out.get(t)?.push(at - last.get(t)! - 1);
      last.set(t, at);
    }
  });
  return out;
}

/**
 * How fair a day's order is, fairOrder's rules in turn (lower is fairer, compared rule by rule): minus the shortest
 * break, how often one team gets it and how often in all, the latest first game, the spread of teams' total rest,
 * minus the last game's teams' rest before it, the sum of the breaks' squares.
 */
export function fairness(order: [number, number][], teamIds: number[]): number[] {
  const byTeam = rests(order, teamIds);
  const gaps = [...byTeam.values()];
  const all = gaps.flat();
  const min = all.length ? Math.min(...all) : order.length;
  const short = gaps.map((g) => g.filter((r) => r === min).length);
  const rest = gaps.map((g) => g.reduce((x, y) => x + y, 0));
  return [
    -min,
    Math.max(...short),
    short.reduce((x, y) => x + y, 0),
    Math.max(...teamIds.map((t) => order.findIndex((g) => g.includes(t)))),
    Math.max(...rest) - Math.min(...rest),
    -Math.min(...(order.at(-1) ?? []).map((t) => byTeam.get(t)?.at(-1) ?? order.length)),
    all.reduce((x, r) => x + r * r, 0),
  ];
}

/** How hard fairOrder looks before it settles for the best order found so far (up to seven teams: every order). */
const FAIR_ORDER_STEPS = 200_000;

/**
 * The round robin's games in the fairest order for one pitch (ADR 0061), every pairing once, judged rule by rule:
 *
 * 1. the shortest break anyone gets (games in between) as long as it can be: with 3 or 4 teams someone has to play
 *    twice running, with 5 or 6 everyone gets a game off, 7 or 8 two, and so on (any longer needs more teams than a
 *    run of games holds, or with an even number, the same pairing to come round again);
 * 2. that shortest break as few times for any one team as can be, then as few times in all;
 * 3. nobody waiting long for their first game, then everyone's breaks adding up to about the same;
 * 4. the last group game's two teams, one of whom may well go straight into the first playoff, coming into it as
 *    rested as can be. Who's in the playoffs depends on the results, so that's all that can be known before;
 * 5. breaks as even as can be (the least sum of their squares).
 *
 * A search with pruning (branch and bound) from the better of the rounds in order and the greedy order (the most
 * rested pairing next), trying every order it must for up to seven teams; past that it stops after `steps` and keeps
 * the best found. Teams are alike to every rule, so the first game is the first pairing, and of the teams yet to play
 * only the first is tried. The same games always give the same order. Sides then take turns (evenSides).
 */
export function fairOrder(
  games: [number, number][],
  teamIds: number[],
  opts: { steps?: number } = {},
): [number, number][] {
  const m = games.length;
  if (m < 2) return games.map(([h, a]) => [h, a]);
  const index = new Map(teamIds.map((t, i) => [t, i]));
  const pairs = games.map(([h, a]) => [index.get(h)!, index.get(a)!] as const);
  const n = teamIds.length;
  const total = new Array<number>(n).fill(0);
  for (const g of pairs) for (const t of g) total[t]++;

  // The search's state: the order so far, each team's last game and first game, its breaks so far
  const order: number[] = [];
  const used = new Array<boolean>(m).fill(false);
  const last = new Array<number>(n).fill(-1);
  const first = new Array<number>(n).fill(-1);
  const played = new Array<number>(n).fill(0);
  const gaps: number[][] = Array.from({ length: n }, () => []);

  /** fairness, from the search's own state (cheaper: it's run at every end of the search). */
  const cost = (): number[] => {
    const all = gaps.flat();
    const min = all.length ? Math.min(...all) : m;
    const short = gaps.map((g) => g.filter((r) => r === min).length);
    const rest = gaps.map((g) => g.reduce((x, y) => x + y, 0));
    return [
      -min,
      Math.max(...short),
      short.reduce((x, y) => x + y, 0),
      Math.max(...first),
      Math.max(...rest) - Math.min(...rest),
      -Math.min(...pairs[order[m - 1]].map((t) => gaps[t].at(-1) ?? m)),
      all.reduce((x, r) => x + r * r, 0),
    ];
  };
  const worse = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };

  /** Whether every way on from here is worse than the best: rule by rule, as far as what's fixed tells. */
  const hopeless = (best: number[]) => {
    const target = -best[0];
    const all = gaps.flat();
    const min = all.length ? Math.min(...all) : m;
    if (min < target) return true;
    // Each team's games still to play need the target's break between them, in the games left
    for (let t = 0; t < n; t++) {
      const left = total[t] - played[t];
      if (!left) continue;
      const from = last[t] < 0 ? order.length - (target + 1) : last[t];
      if (from + left * (target + 1) > m - 1) return true;
    }
    if (min > target) return false;
    const short = gaps.map((g) => g.filter((r) => r === target).length);
    const bound = [
      -target,
      Math.max(...short),
      short.reduce((x, y) => x + y, 0),
      Math.max(...first, played.includes(0) ? order.length : 0),
    ];
    for (let i = 0; i < bound.length; i++) if (bound[i] !== best[i]) return bound[i] > best[i];
    return false;
  };

  // Undoing needs each team's game before: kept on a stack as it's played
  const lastBefore: [number, number][] = [];
  const play = (g: number) => {
    const at = order.length;
    lastBefore.push([last[pairs[g][0]], last[pairs[g][1]]]);
    order.push(g);
    used[g] = true;
    for (const t of pairs[g]) {
      if (last[t] >= 0) gaps[t].push(at - last[t] - 1);
      else first[t] = at;
      last[t] = at;
      played[t]++;
    }
  };
  const undo = () => {
    const g = order.pop()!;
    used[g] = false;
    const before = lastBefore.pop()!;
    pairs[g].forEach((t, i) => {
      last[t] = before[i];
      played[t]--;
      if (before[i] >= 0) gaps[t].pop();
      else first[t] = -1;
    });
  };
  /**
   * The games still to play, most rested first (the greedy choice), then in the circle method's order. Teams yet to
   * play are alike, so of the games bringing one in, only those with the first of them (or the first two) are tried.
   */
  const next = () => {
    const rested = (t: number) => (last[t] < 0 ? m + total[t] : order.length - last[t] - 1);
    const fresh = [...Array(n).keys()].filter((t) => !played[t]);
    const alike = (g: number) => {
      const fresh_ = pairs[g].filter((t) => !played[t]);
      return fresh_.every((t) => fresh.indexOf(t) < fresh_.length);
    };
    return games
      .map((_, g) => g)
      .filter((g) => !used[g] && alike(g))
      .map((g) => ({ g, a: Math.min(...pairs[g].map(rested)), b: Math.max(...pairs[g].map(rested)) }))
      .sort((x, y) => y.a - x.a || y.b - x.b || x.g - y.g)
      .map((x) => x.g);
  };

  // The best so far: the circle method's order (the rounds one after another), or the greedy order if that's fairer
  pairs.forEach((_, g) => play(g));
  let best = cost();
  let bestOrder = [...order];
  while (order.length > 1) undo();
  while (order.length < m) play(next()[0]);
  if (worse(best, cost())) {
    best = cost();
    bestOrder = [...order];
  }
  while (order.length > 1) undo();

  let steps = opts.steps ?? FAIR_ORDER_STEPS;
  const search = () => {
    if (steps-- <= 0) return;
    if (order.length === m) {
      const c = cost();
      if (worse(best, c)) {
        best = c;
        bestOrder = [...order];
      }
      return;
    }
    if (hopeless(best)) return;
    for (const g of next()) {
      play(g);
      search();
      undo();
      if (steps <= 0) return;
    }
  };
  search();

  return evenSides(bestOrder.map((g) => games[g]));
}

/**
 * Sides in the day's order: each game keeps its home side unless that team has been home more than the other, then
 * where a team's still home two more than away (an odd number of teams), a run of games from it to one away two more
 * swaps round, so every team's home and away are even, give or take one.
 */
function evenSides(order: [number, number][]): [number, number][] {
  const net = new Map<number, number>();
  const at = (t: number) => net.get(t) ?? 0;
  const out = order.map(([h, a]): [number, number] => {
    if (at(h) > at(a)) [h, a] = [a, h];
    net.set(h, at(h) + 1).set(a, at(a) - 1);
    return [h, a];
  });
  for (
    let from = [...net.keys()].find((t) => at(t) > 1);
    from !== undefined;
    from = [...net.keys()].find((t) => at(t) > 1)
  ) {
    // The shortest run of games, home to away, from it to a team away too often (one is always there)
    const via = new Map<number, number>([[from, -1]]);
    const queue = [from];
    let to: number | undefined;
    while (queue.length && to === undefined) {
      const t = queue.shift()!;
      out.forEach(([h, a], g) => {
        if (h !== t || via.has(a) || to !== undefined) return;
        via.set(a, g);
        if (at(a) < -1) to = a;
        else queue.push(a);
      });
    }
    if (to === undefined) break;
    for (let t = to; t !== from;) {
      const g = via.get(t)!;
      out[g] = [out[g][1], out[g][0]];
      t = out[g][1];
    }
    net.set(from, at(from) - 2).set(to, at(to) + 2);
  }
  return out;
}

/**
 * fairOrder's answer for 2 to 8 teams, as places in the pick order (home-away), worked out once: the search takes up
 * to a fifth of a second, and the Worker has 10 ms (ADR 0003). fixtures.fair-order.test.ts checks it's still the answer.
 */
const FAIR_ORDERS: Record<number, string> = {
  2: "0-1",
  3: "1-2 2-0 0-1",
  4: "0-3 1-2 2-0 3-1 0-1 2-3",
  5: "1-4 0-2 1-3 4-0 2-3 0-1 4-2 3-0 2-1 3-4",
  6: "0-5 1-2 3-4 5-1 2-0 4-1 0-3 2-5 4-0 1-3 4-2 5-3 0-1 5-4 3-2",
  7: "1-6 0-2 3-4 1-5 6-0 2-3 4-5 0-1 3-6 2-5 1-4 0-3 5-6 4-2 3-1 5-0 6-4 2-1 5-3 4-0 6-2",
  8: "0-7 1-2 3-4 5-6 7-1 2-0 6-4 5-3 0-1 2-7 3-6 4-1 0-5 2-3 6-7 4-0 1-5 7-3 6-2 4-5 3-0 1-6 7-5 4-2 3-1 0-6 7-4 5-2",
};

/** For more teams, a short look past the greedy order: a few milliseconds. */
const QUICK_STEPS = 500;

/** A run of numbers from a seed (mulberry32): the same seed, the same run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The round robin of these teams (in pick order) in the day's order: fairOrder's, from its table up to 8 teams. With
 * a `seed` (making them again), another order just as fair: the table's order or one of its turns (backwards,
 * or started part way round) that scores the same on every rule, the teams dealt into its places at random, and
 * maybe every side swapped. Teams are alike to every rule, so each of these is exactly as fair.
 */
export function fairFixtures(teamIds: number[], seed?: number): [number, number][] {
  const places = teamIds.map((_, i) => i);
  const known = FAIR_ORDERS[teamIds.length];
  const best: [number, number][] = known
    ? known.split(" ").map((g) => g.split("-").map(Number) as [number, number])
    : fairOrder(roundRobin(places).flat(), places, { steps: QUICK_STEPS });
  if (seed === undefined) return best.map(([h, a]) => [teamIds[h], teamIds[a]]);

  const random = seeded(seed);
  const score = fairness(best, places).join();
  const turns = [best, [...best].reverse()]
    .flatMap((o) => o.map((_, k) => [...o.slice(k), ...o.slice(0, k)]))
    .filter((o) => fairness(o, places).join() === score);
  const order = turns[Math.floor(random() * turns.length)];
  const dealt = [...teamIds];
  for (let i = dealt.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [dealt[i], dealt[j]] = [dealt[j], dealt[i]];
  }
  const swap = random() < 0.5;
  return order.map(([h, a]) => (swap ? [dealt[a], dealt[h]] : [dealt[h], dealt[a]]));
}

/** The changeover between games, in minutes. */
export const BREAK_MINUTES = 5;

/**
 * A game's length on the day: its periods (1 unless said) times the minutes in each, and the breaks between them
 * (ADR 0061).
 */
export const slotMinutes = (t: { gameMinutes: number; periods?: number; breakMinutes?: number }) =>
  t.gameMinutes * (t.periods ?? 1) + (t.breakMinutes ?? 0) * ((t.periods ?? 1) - 1);

/**
 * When a game kicks off: one pitch, games in order from the tournament's start, each its length (`slotMinutes`: a
 * tournament's periods times their minutes) plus the break before the next (ADR 0061). "HH:MM", London time like the start; a day that runs past midnight wraps.
 */
export function kickOff(startTime: string, gameMinutes: number, position: number, breakMinutes = BREAK_MINUTES) {
  const [h, m] = startTime.split(":").map(Number);
  const at = (h * 60 + m + (position - 1) * (gameMinutes + breakMinutes)) % (24 * 60);
  return `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
}

/**
 * A match's time on the card, "HH:MM" London: when it actually kicked off once it has (`startedAt`, the first Start of
 * its clock), else when it's set to (`kickOff`). The tournament's own hours never move for it (ADR 0061).
 */
export const matchTime = (
  t: { startTime: string; gameMinutes: number; periods?: number; breakMinutes?: number },
  g: { position: number; startedAt?: string | null },
) => (g.startedAt ? londonTime(g.startedAt) : kickOff(t.startTime, slotMinutes(t), g.position));

/**
 * Who keeps score (ADR 0061): each game goes to a team sitting it out, in the day's order, taking turns evenly: the
 * one that's scored fewest so far, then the one that's waited longest, then the first in the pick order. A game whose
 * teams aren't known yet (a playoff waiting on the table) gets none, nor does any game when there's no third team.
 */
export function scorekeepers(
  teamIds: number[],
  games: { id: number; homeTeamId: number | null; awayTeamId: number | null }[],
): Map<number, number> {
  const count = new Map(teamIds.map((t) => [t, 0]));
  const lastAt = new Map(teamIds.map((t) => [t, -1]));
  const out = new Map<number, number>();
  games.forEach((g, at) => {
    if (g.homeTeamId === null || g.awayTeamId === null) return;
    const free = teamIds.filter((t) => t !== g.homeTeamId && t !== g.awayTeamId);
    if (!free.length) return;
    const pick = free.reduce((best, t) =>
      count.get(t)! < count.get(best)! || (count.get(t) === count.get(best) && lastAt.get(t)! < lastAt.get(best)!)
        ? t
        : best,
    );
    out.set(g.id, pick);
    count.set(pick, count.get(pick)! + 1);
    lastAt.set(pick, at);
  });
  return out;
}
