// Balanced teams for a training session (ADR 0102). A greedy deal to start, then every single move and every swap
// of two players is tried until none makes the teams more balanced. The old app's rules, from
// the old app's solver_lp.py (in git history): 3 to 7 a side, the Cougar players together on one team called "Cougars", a
// keeper and a defender on every team where there are enough, and ratings balanced.
import type { Player, Position } from "../demo/data";
import { goesBy } from "./names";

export interface Team {
  name: string;
  players: number[];
}

/** The fewest teams that gives each 3 to 7 players; failing that, as few as keep each at 7 or under. */
export function teamCount(n: number): number {
  for (let t = 2; t <= 10; t++) if (Math.floor(n / t) >= 3 && Math.ceil(n / t) <= 7) return t;
  return Math.max(2, Math.ceil(n / 7));
}

/**
 * How unbalanced a set of teams is, worst thing first. Compared in order: a lower first number wins whatever comes
 * after, so there are no weights to tune. Team 0 is the Cougars' team.
 */
export type Balance = [
  /** Most players on a team minus the fewest. */
  sizes: number,
  /** Cougar players not on the Cougars' team. */
  cougarsApart: number,
  /** Keepers: most on a team minus the fewest. */
  keepers: number,
  /** Defenders: most on a team minus the fewest. */
  defenders: number,
  /** Average rating: the strongest team minus the weakest. */
  rating: number,
  /** The same per position, added up, so one team doesn't get all the best defenders. */
  positions: number,
];

const POSITIONS: Position[] = ["G", "D", "F"];

export function balance(players: Player[], teamOf: number[], teams: number): Balance {
  // Plain loops and typed arrays: this runs for every move and swap tried, thousands of times a solve
  const size = new Int32Array(teams);
  const total = new Float64Array(teams);
  const count = { G: new Int32Array(teams), D: new Int32Array(teams), F: new Int32Array(teams) };
  const sum = { G: new Float64Array(teams), D: new Float64Array(teams), F: new Float64Array(teams) };
  let apart = 0;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const t = teamOf[i];
    size[t]++;
    total[t] += p.rating;
    count[p.position][t]++;
    sum[p.position][t] += p.rating;
    if (p.cougar && t !== 0) apart++;
  }
  let positions = 0;
  for (const pos of POSITIONS) positions += meanSpread(sum[pos], count[pos]);
  return [spread(size), apart, spread(count.G), spread(count.D), meanSpread(total, size), positions];
}

function spread(xs: Int32Array): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi - lo;
}

/** The highest average minus the lowest, over the teams that have any. */
function meanSpread(sums: Float64Array, counts: Int32Array): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t < sums.length; t++) {
    if (!counts[t]) continue;
    const m = sums[t] / counts[t];
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  return hi > lo ? hi - lo : 0;
}

/** Negative when a is more balanced than b. */
export function compare(a: Balance, b: Balance): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Make the teams. The same players give the same teams. */
export function makeTeams(players: Player[], names: string[]): Team[] {
  const teams = teamCount(players.length);
  let best = improve(players, deal(players, teams), teams);
  let bestBalance = balance(players, best, teams);
  // A dozen more starts from random deals, in case the first settled short of the best there is
  const random = mulberry32(players.reduce((s, p) => s + p.id, players.length));
  for (let k = 0; k < RESTARTS; k++) {
    const next = improve(players, randomDeal(players, teams, random), teams);
    const b = balance(players, next, teams);
    if (compare(b, bestBalance) < 0) {
      best = next;
      bestBalance = b;
    }
  }
  const hasCougars = players.some((p) => p.cougar);
  const colours = names.filter((x) => x !== "Cougars");
  return Array.from({ length: teams }, (_, t) => ({
    name: hasCougars && t === 0 ? "Cougars" : (colours[hasCougars ? t - 1 : t] ?? `Team ${t + 1}`),
    players: players.filter((_, i) => best[i] === t).map((p) => p.id),
  }));
}

const RESTARTS = 12;

/**
 * The greedy deal: the Cougars go together on team 0, best first, up to a full team; then keepers, defenders and
 * forwards, best first, each to the team with room that has the fewest of their position, then the fewest players,
 * then the lowest rating. Returns each player's team, by their index in `players`.
 */
function deal(players: Player[], teams: number): number[] {
  const cap = Math.ceil(players.length / teams);
  const teamOf = new Array<number>(players.length).fill(-1);
  const size = new Array<number>(teams).fill(0);
  const rating = new Array<number>(teams).fill(0);
  const count = new Array<number>(teams).fill(0);
  const put = (i: number, t: number) => {
    teamOf[i] = t;
    size[t]++;
    rating[t] += players[i].rating;
  };
  const byRating = (a: number, b: number) => players[b].rating - players[a].rating;

  const cougars = players.flatMap((p, i) => (p.cougar ? [i] : [])).sort(byRating);
  for (const i of cougars.slice(0, cap)) put(i, 0);

  for (const position of POSITIONS) {
    count.fill(0);
    players.forEach((p, i) => p.position === position && teamOf[i] >= 0 && count[teamOf[i]]++);
    const pool = players.flatMap((p, i) => (p.position === position && teamOf[i] < 0 ? [i] : [])).sort(byRating);
    for (const i of pool) {
      let best = -1;
      for (let t = 0; t < teams; t++) {
        if (size[t] >= cap) continue;
        const better =
          best < 0 ||
          count[t] < count[best] ||
          (count[t] === count[best] && (size[t] < size[best] || (size[t] === size[best] && rating[t] < rating[best])));
        if (better) best = t;
      }
      put(i, best);
      count[best]++;
    }
  }
  return teamOf;
}

/** Try every move of one player and every swap of two; take the best; repeat until nothing is better. */
function improve(players: Player[], start: number[], teams: number): number[] {
  const teamOf = [...start];
  let current = balance(players, teamOf, teams);
  for (;;) {
    let bestBalance = current;
    let move: [i: number, j: number] | null = null; // j < 0: player i moves to team -(j + 1); else i and j swap
    const consider = (i: number, j: number) => {
      const b = balance(players, teamOf, teams);
      if (compare(b, bestBalance) < 0) {
        bestBalance = b;
        move = [i, j];
      }
    };
    for (let i = 0; i < players.length; i++) {
      const from = teamOf[i];
      for (let t = 0; t < teams; t++) {
        if (t === from) continue;
        teamOf[i] = t;
        consider(i, -(t + 1));
      }
      teamOf[i] = from;
      for (let j = i + 1; j < players.length; j++) {
        if (teamOf[j] === from) continue;
        const other = teamOf[j];
        teamOf[i] = other;
        teamOf[j] = from;
        consider(i, j);
        teamOf[i] = from;
        teamOf[j] = other;
      }
    }
    if (!move) return teamOf;
    const [i, j] = move as [number, number];
    if (j < 0) teamOf[i] = -(j + 1);
    else [teamOf[i], teamOf[j]] = [teamOf[j], teamOf[i]];
    current = bestBalance;
  }
}

/**
 * Late sign-ups onto teams already made, leaving everyone else where they are: best first, a Cougar to the Cougars,
 * anyone else to the team with fewest players, then fewest in their position, then the lowest rating.
 */
export function slotIn(teams: Team[], late: Player[], byId: (id: number) => Player | undefined): Team[] {
  const out = teams.map((t) => ({ name: t.name, players: [...t.players] }));
  const rating = (t: Team) => t.players.reduce((s, id) => s + (byId(id)?.rating ?? 0), 0);
  const count = (t: Team, position: string) => t.players.filter((id) => byId(id)?.position === position).length;
  for (const p of [...late].sort((a, b) => b.rating - a.rating)) {
    const cougars = p.cougar ? out.find((t) => t.name === "Cougars") : undefined;
    const best =
      cougars ??
      [...out].sort(
        (a, b) =>
          a.players.length - b.players.length || count(a, p.position) - count(b, p.position) || rating(a) - rating(b),
      )[0];
    best.players.push(p.id);
  }
  return out;
}

/** The order a team is shown in: forwards, then defence, keepers last. */
const LINE: Record<Position, number> = { F: 0, D: 1, G: 2 };

/**
 * How a team reads, top to bottom: by position (keepers last), then, for the team maker who sees ratings, best first;
 * for everyone else by name, so the order gives no ratings away. Worked out each time it's shown, so a player moved
 * onto a team takes their place in it and every saved team reads the same way (ADR 0076).
 */
export function lineUp(ids: number[], byId: (id: number) => Player | undefined, byRating: boolean): number[] {
  const known = ids.flatMap((id) => {
    const p = byId(id);
    return p ? [p] : [];
  });
  return known
    .sort(
      (a, b) =>
        LINE[a.position] - LINE[b.position] ||
        (byRating ? b.rating - a.rating : 0) ||
        goesBy(a).localeCompare(goesBy(b)) ||
        a.id - b.id,
    )
    .map((p) => p.id);
}

/** A team's head for the team maker: how many, and their average rating (what the teams are balanced on), rounded. */
export function strength(
  ids: number[],
  byId: (id: number) => Player | undefined,
): { players: number; total: number; average: number | null } {
  const total = ids.reduce((s, id) => s + (byId(id)?.rating ?? 0), 0);
  return { players: ids.length, total, average: ids.length ? Math.round(total / ids.length) : null };
}

/** A random deal: the Cougars on team 0 up to a full team, everyone else round the teams in a shuffled order. */
function randomDeal(players: Player[], teams: number, random: () => number): number[] {
  const cap = Math.ceil(players.length / teams);
  const order = players.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const teamOf = new Array<number>(players.length).fill(-1);
  const size = new Array<number>(teams).fill(0);
  for (const i of order) {
    if (players[i].cougar && size[0] < cap) {
      teamOf[i] = 0;
      size[0]++;
    }
  }
  let t = 0;
  for (const i of order) {
    if (teamOf[i] >= 0) continue;
    while (size[t] >= cap) t = (t + 1) % teams;
    teamOf[i] = t;
    size[t]++;
    t = (t + 1) % teams;
  }
  return teamOf;
}

/** A small seeded random, so the same players always get the same teams. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
