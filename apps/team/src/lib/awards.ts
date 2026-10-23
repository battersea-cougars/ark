// A tournament's awards and how each is decided (ADR 0044). Every award says how (`decidedBy`), chosen by an admin
// in the series' editor or the tournament's own:
//   A stat we track, from the results: top of the table (the champions, a team); most goals (then most assists);
//     most assists (then most goals); most points, goals and assists (then most goals); fewest goals against a game
//     (a goalie, position G, by their team's games); most penalty minutes. Still level: joint winners.
//   A vote, at the after-party: everyone who played votes for anyone who played, or the skaters vote for a keeper,
//     from the last match till the awards are confirmed. Most votes wins; level, the award's tie-break stat among
//     the level ones, else the admin chooses among them.
//   The admin's call, live (the judges' call): as they confirm, they name it ("Most Dramatic Fall") and choose who.
//   Drawn at random: a player who played, the same for the same seed, drawn again on asking.
// Stats and draws are worked out here for the admin to check as they confirm; the votes are counted by the Worker
// as they confirm (worker/tournaments/awards.ts, with the same rules from here). Then the reveal, one at a time.
import { champion, table, type Result } from "@cougars/shared/results";

/** The stats we track that decide an award (ADR 0044). */
export const STATS = ["table", "goals", "assists", "points", "goalsAgainst", "penaltyMinutes"] as const;
export type Stat = (typeof STATS)[number];
/** A player's stat (any but the table's, which is a team's): what a vote's tie can be broken by. */
export type PlayerStat = Exclude<Stat, "table">;

/** How an award is decided (ADR 0044). */
export type DecidedBy =
  | { kind: "stat"; stat: Stat }
  | { kind: "vote"; voters: "players" | "skaters"; tieBreak?: PlayerStat }
  | { kind: "live"; options: string[] }
  | { kind: "random" };

export interface Award {
  name: string;
  about: string;
  decidedBy?: DecidedBy;
}

/** What an admin's live call is offered to name it, unless they type their own. */
export const LIVE_OPTIONS = [
  "Fastest Looking Skates",
  "Most Shoulder Fakes",
  "Most Crossbars",
  "Smoothest Crossovers",
  "Best Celly",
  "Most Dramatic Fall",
  "Loudest Stick Tap",
  "Most Calls Missed (the ref)",
  "Blindest Whistle (the ref)",
];

/**
 * How an award is decided: its own `decidedBy`, else (awards saved before it had one) a guess from its name, as the
 * app used to make every time: Champions the table, a scorer most goals, a goalie fewest against, a Dim Mak (or
 * anything random, lucky or fun) a draw. Anything else was the admin's to choose: now their live call, named as it is.
 */
export function decidedByOf(a: { name: string; decidedBy?: DecidedBy | null }): DecidedBy {
  if (a.decidedBy) return a.decidedBy;
  const name = a.name;
  if (/dim mak|random|lucky|fun/i.test(name)) return { kind: "random" };
  if (/champion/i.test(name)) return { kind: "stat", stat: "table" };
  if (/scor/i.test(name)) return { kind: "stat", stat: "goals" };
  if (/goalie|keeper|goaltend/i.test(name)) return { kind: "stat", stat: "goalsAgainst" };
  return { kind: "live", options: [] };
}

/** Awards as an editor loads them: each saying how it's decided, the old guess written in for one that didn't. */
export const withDecidedBy = (awards: Award[]): Award[] =>
  awards.map((a) => ({ ...a, decidedBy: structuredClone(decidedByOf(a)) }));

export interface AwardWinner {
  teamId: number | null;
  memberId: number | null;
}
export interface FromData {
  winners: AwardWinner[];
  /** Why, in a few words: "7 goals", "1.5 against a game", "Drawn at random". */
  why: string;
  random?: boolean;
}

export interface AwardsData {
  id: number;
  teams: { id?: number | null; captainMemberId: number | null; players: { memberId: number | null }[] }[];
  games?: (Result & {
    stage: "group" | "playoff";
    position: number;
    goals?: { scorerId: number | null; assistId?: number | null }[];
    penalties?: { memberId: number | null; minutes: number }[];
  })[];
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
}
export interface Positions {
  positionOf: (memberId: number) => string | undefined;
}

/** Everyone who played: each team's captain and players, once each. */
export const playersOf = (t: Pick<AwardsData, "teams">) => [
  ...new Set(
    t.teams.flatMap((x) => [x.captainMemberId, ...x.players.map((p) => p.memberId)]).filter((id): id is number => !!id),
  ),
];
/** A small seeded random: the same seed draws the same player. */
const draw = (n: number, seed: number) => {
  let x = (seed * 2654435761) % 2 ** 32;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507) >>> 0;
  return x % n;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Each player's figures for a stat, the first deciding and the next breaking a tie (higher is better), with the
 * words for them. Only players with something to count: a goal, an assist, a penalty, a goalie's games.
 */
function scores(stat: PlayerStat, t: AwardsData, { positionOf }: Positions) {
  const played = (t.games ?? []).filter((g) => g.status === "done");
  const out = new Map<number, { keys: number[]; why: string }>();
  if (stat === "goalsAgainst") {
    const rows = table(
      t.teams.flatMap((x) => (x.id ? [x.id] : [])),
      played,
    );
    for (const r of rows) {
      if (!r.p) continue;
      const team = t.teams.find((x) => x.id === r.teamId);
      const goalies = [team?.captainMemberId, ...(team?.players ?? []).map((p) => p.memberId)].filter(
        (id): id is number => !!id && positionOf(id) === "G",
      );
      const perGame = r.ga / r.p;
      for (const id of goalies) out.set(id, { keys: [-perGame], why: `${Number(perGame.toFixed(1))} against a game` });
    }
    return out;
  }
  const goals: Record<number, number> = {};
  const assists: Record<number, number> = {};
  const minutes: Record<number, number> = {};
  for (const g of played) {
    for (const x of g.goals ?? []) {
      if (x.scorerId) goals[x.scorerId] = (goals[x.scorerId] ?? 0) + 1;
      if (x.assistId) assists[x.assistId] = (assists[x.assistId] ?? 0) + 1;
    }
    for (const p of g.penalties ?? []) if (p.memberId) minutes[p.memberId] = (minutes[p.memberId] ?? 0) + p.minutes;
  }
  const ids = new Set([...Object.keys(goals), ...Object.keys(assists), ...Object.keys(minutes)].map(Number));
  for (const id of ids) {
    const [g, a, m] = [goals[id] ?? 0, assists[id] ?? 0, minutes[id] ?? 0];
    if (stat === "goals" && g) out.set(id, { keys: [g, a], why: plural(g, "goal") });
    if (stat === "assists" && a) out.set(id, { keys: [a, g], why: plural(a, "assist") });
    if (stat === "points" && g + a) out.set(id, { keys: [g + a, g], why: plural(g + a, "point") });
    if (stat === "penaltyMinutes" && m) out.set(id, { keys: [m], why: plural(m, "penalty minute") });
  }
  return out;
}
/** The words for a tie broken by the second figure: "1 goal, 1 assist". */
const brokenWhy = (stat: PlayerStat, keys: number[], why: string) =>
  stat === "goals" && keys[1]
    ? `${why}, ${plural(keys[1], "assist")}`
    : (stat === "assists" || stat === "points") && keys[1]
      ? `${why}, ${plural(keys[1], "goal")}`
      : why;

const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
  return 0;
};

/**
 * The best at a player's stat, among `among` if it's said (a vote's tie): the most on the first figure, then the
 * next; still level, all of them. Nobody with anything to count: none.
 */
export function bestAt(stat: PlayerStat, t: AwardsData, ctx: Positions, among?: number[]) {
  const all = [...scores(stat, t, ctx)].filter(([id]) => !among || among.includes(id));
  if (!all.length) return null;
  all.sort((a, b) => compare(a[1].keys, b[1].keys));
  const top = all[0][1];
  const first = all.filter(([, s]) => s.keys[0] === top.keys[0]);
  const level = first.filter(([, s]) => compare(s.keys, top.keys) === 0);
  return {
    ids: level.map(([id]) => id),
    why: first.length > 1 && level.length < first.length ? brokenWhy(stat, top.keys, top.why) : top.why,
  };
}

/** An award from the data, by how it's decided: a stat's winners, or a draw. A vote or the judges' call: null. */
export function awardFromData(
  award: Award,
  t: AwardsData,
  { positionOf, seed = t.id }: Positions & { seed?: number },
): FromData | null {
  const how = decidedByOf(award);
  if (how.kind === "random") {
    const everyone = playersOf(t);
    if (!everyone.length) return null;
    return {
      winners: [{ teamId: null, memberId: everyone[draw(everyone.length, seed)] }],
      why: "Drawn at random",
      random: true,
    };
  }
  if (how.kind !== "stat") return null;
  if (!(t.games ?? []).some((g) => g.status === "done")) return null;
  if (how.stat === "table") {
    const teamIds = t.teams.flatMap((x) => (x.id ? [x.id] : []));
    const id = champion(teamIds, t.games ?? [], { win: t.pointsWin, draw: t.pointsDraw, loss: t.pointsLoss });
    return id ? { winners: [{ teamId: id, memberId: null }], why: "From the results" } : null;
  }
  const best = bestAt(how.stat, t, { positionOf });
  return best ? { winners: best.ids.map((memberId) => ({ teamId: null, memberId })), why: best.why } : null;
}

/** Who votes for a voted award: everyone who played, or the skaters (not a goalie, position G) who played. */
export function votersOf(award: Award, t: Pick<AwardsData, "teams">, { positionOf }: Positions) {
  const how = decidedByOf(award);
  if (how.kind !== "vote") return [];
  const everyone = playersOf(t);
  return how.voters === "skaters" ? everyone.filter((id) => positionOf(id) !== "G") : everyone;
}

/** Who can be voted for: anyone who played, or (the skaters voting) a goalie who played. Never the voter. */
export function candidatesOf(award: Award, t: Pick<AwardsData, "teams">, { positionOf }: Positions, voter?: number) {
  const how = decidedByOf(award);
  if (how.kind !== "vote") return [];
  const everyone = playersOf(t);
  return (how.voters === "skaters" ? everyone.filter((id) => positionOf(id) === "G") : everyone).filter(
    (id) => id !== voter,
  );
}

/**
 * A vote counted (ADR 0044): the most votes wins. Level (none cast, everyone's level at nought), the award's
 * tie-break stat among the level ones; still level, or no tie-break, `tied` says who the admin chooses among.
 */
export function countVotes(
  award: Award,
  votes: number[],
  t: AwardsData,
  ctx: Positions,
): { winners: number[]; tied: number[] } {
  const how = decidedByOf(award);
  const candidates = candidatesOf(award, t, ctx);
  const n = new Map(candidates.map((id) => [id, 0]));
  for (const id of votes) if (n.has(id)) n.set(id, n.get(id)! + 1);
  const most = Math.max(0, ...n.values());
  // Nobody voted: it's the admin's to choose among everyone eligible, not the tie-break's
  if (most === 0) return candidates.length > 1 ? { winners: [], tied: candidates } : { winners: candidates, tied: [] };
  const level = candidates.filter((id) => n.get(id) === most);
  if (level.length <= 1) return { winners: level, tied: [] };
  const broken = how.kind === "vote" && how.tieBreak ? bestAt(how.tieBreak, t, ctx, level) : null;
  if (broken?.ids.length === 1) return { winners: broken.ids, tied: [] };
  return { winners: [], tied: broken?.ids.length ? broken.ids : level };
}

/** In the editors: how an award's decided, as one choice (lib/Select's value), and back. */
export const DECIDED_BY_OPTIONS = [
  { value: "stat:table", label: "Top of the table (a team)" },
  { value: "stat:goals", label: "Most goals" },
  { value: "stat:assists", label: "Most assists" },
  { value: "stat:points", label: "Most points (goals + assists)" },
  { value: "stat:goalsAgainst", label: "Fewest goals against a game (keepers)" },
  { value: "stat:penaltyMinutes", label: "Most penalty minutes" },
  { value: "vote:players", label: "A vote: everyone who played" },
  { value: "vote:skaters", label: "A vote: the skaters, for a keeper" },
  { value: "live", label: "The judges' call (the admin's, on the night)" },
  { value: "random", label: "Drawn at random" },
] as const;
export type DecidedByKey = (typeof DECIDED_BY_OPTIONS)[number]["value"];
export const TIE_BREAK_OPTIONS = [
  { value: "", label: "None: the admin chooses" },
  { value: "goals", label: "Most goals" },
  { value: "assists", label: "Most assists" },
  { value: "points", label: "Most points" },
  { value: "goalsAgainst", label: "Fewest goals against a game" },
  { value: "penaltyMinutes", label: "Most penalty minutes" },
] as const;

export const keyOf = (d: DecidedBy): DecidedByKey =>
  d.kind === "stat" ? `stat:${d.stat}` : d.kind === "vote" ? `vote:${d.voters}` : d.kind;

/** A choice made in the editor, keeping what it can of what it was (a vote's tie-break, a live call's names). */
export function fromKey(key: DecidedByKey, was?: DecidedBy): DecidedBy {
  if (key.startsWith("stat:")) return { kind: "stat", stat: key.slice(5) as Stat };
  if (key.startsWith("vote:")) {
    const voters = key.slice(5) as "players" | "skaters";
    const tieBreak = was?.kind === "vote" ? was.tieBreak : voters === "skaters" ? "goalsAgainst" : undefined;
    return tieBreak ? { kind: "vote", voters, tieBreak } : { kind: "vote", voters };
  }
  if (key === "live") return { kind: "live", options: was?.kind === "live" ? was.options : [...LIVE_OPTIONS] };
  return { kind: "random" };
}
