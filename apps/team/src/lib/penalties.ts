// Penalties (ADR 0061), shared by the Worker and the app: what can be called, the penalty clock, and the minutes each
// player and team has spent in the box. The clock is worked out, never stored: a penalty runs in game time from when
// it was given, so it pauses when the game clock does, and a minor ends early at a power-play goal against its team.
// A double minor is one penalty of four minutes, served as two minors back to back: a power-play goal ends only the
// one running, and the second two minutes start fresh from the goal.

/**
 * What a penalty can be for, always said: a short list of the common ones, and Other. Stored by value. A player's
 * infraction needs who it's on; a bench one (`bench`) may be on nobody, a bench penalty, and some are always a minor
 * on the bench (`minorOnly`: the sheet starts them on Bench, at 2).
 */
export const INFRACTIONS = [
  { value: "tripping", label: "Tripping", bench: false, minorOnly: false },
  { value: "hooking", label: "Hooking", bench: false, minorOnly: false },
  { value: "high-stick", label: "High stick", bench: false, minorOnly: false },
  { value: "slashing", label: "Slashing", bench: false, minorOnly: false },
  { value: "interference", label: "Interference", bench: false, minorOnly: false },
  { value: "holding", label: "Holding", bench: false, minorOnly: false },
  { value: "roughing", label: "Roughing", bench: false, minorOnly: false },
  { value: "unsportsmanlike", label: "Unsportsmanlike", bench: false, minorOnly: false },
  { value: "too-many-players", label: "Too many players", bench: true, minorOnly: true },
  { value: "delay-of-game", label: "Delay of game", bench: true, minorOnly: false },
  { value: "bench-minor", label: "Bench minor", bench: true, minorOnly: true },
  { value: "other", label: "Other", bench: false, minorOnly: false },
] as const;
export type Infraction = (typeof INFRACTIONS)[number]["value"];
export const infractionOf = (value: string) => INFRACTIONS.find((i) => i.value === value);

/**
 * How a penalty's served, a series' setting each tournament copies (ADR 0061): a power play (the player in the box,
 * the team a player short, a power-play goal ending a minor), or a penalty shot for the other team (not recorded)
 * with the player sitting out for the length: nobody's short, and goals don't end it.
 */
export const PENALTY_RULES = [
  {
    value: "power_play",
    label: "Power play",
    hint: "In the box, the team plays short; a power-play goal ends a minor.",
  },
  {
    value: "sit_out",
    label: "Penalty shot",
    hint: "The other team takes a shot; the player sits out, nobody plays short.",
  },
] as const;
export type PenaltyRule = (typeof PENALTY_RULES)[number]["value"];
/** As a series' or tournament's setting shows them: a tap each, with what it means. */
export const PENALTY_RULE_OPTIONS = PENALTY_RULES.map((r) => ({
  value: r.value as PenaltyRule,
  label: r.label,
  hint: r.hint,
  icon: (r.value === "power_play" ? "clock" : "puck") as "clock" | "puck",
}));

/** A minor (2), a double minor (4: 2+2) or a major (5). */
export const PENALTY_MINUTES = [2, 4, 5] as const;
/** How the scorekeeper picks the minutes: the name and the length. */
export const PENALTY_KINDS = [
  { minutes: 2, name: "Minor", length: "2 min" },
  { minutes: 4, name: "Double minor", length: "2+2 min" },
  { minutes: 5, name: "Major", length: "5 min" },
] as const;
/** A minor or a double minor: a power-play goal cuts it short. A major is served in full. */
const isMinor = (minutes: number) => minutes === 2 || minutes === 4;

/** As a game's log says it: Tripping. */
export const infractionLabel = (value: string) => infractionOf(value)?.label ?? "";

/** Who it's on, then what for: "Dan · Tripping", or "Bench · Too many players" when it's on nobody. */
export const penaltyLine = (p: { memberId: number | null; infraction: string }, nameOf: (id: number) => string) =>
  [(p.memberId !== null && nameOf(p.memberId)) || "Bench", infractionLabel(p.infraction)].filter(Boolean).join(" · ");

interface PenaltyLike {
  id: number;
  teamId: number;
  memberId: number | null;
  minutes: number;
  /** When it was given, in game time; null when an admin added it after without a time. */
  atMs: number | null;
}
interface GoalLike {
  teamId: number;
  atMs: number | null;
}

/** Game time gone (ms) on a clock now: the full length less the time left. */
export function gameTime(
  g: { clockLeftMs?: number | null; clockStartedAt?: string | null },
  fullMs: number,
  nowMs: number,
) {
  const since = g.clockStartedAt ? nowMs - Date.parse(g.clockStartedAt) : 0;
  const left = Math.max(0, (g.clockLeftMs ?? fullMs) - since);
  return Math.min(fullMs, Math.max(0, fullMs - left));
}

/**
 * When each penalty ends, in game time, by id: its minutes after it was given, or a minor sooner, at a power-play goal
 * (a goal against its team while that team has more players in the box than the scorers). That goal ends the
 * penalised team's earliest running minor; in a double minor, only the two minutes being served: in the first two,
 * the second two start fresh from the goal. A penalty with no time has no end.
 */
export function penaltyEnds(penalties: PenaltyLike[], goals: GoalLike[], rule: PenaltyRule = "power_play") {
  const ends = new Map<number, number>();
  // A double minor's first two minutes end here (moved to the goal that ended them)
  const firstHalf = new Map<number, number>();
  const timed = penalties.filter((p) => p.atMs !== null);
  for (const p of timed) {
    ends.set(p.id, p.atMs! + p.minutes * 60_000);
    if (p.minutes === 4) firstHalf.set(p.id, p.atMs! + 2 * 60_000);
  }
  // Sitting out: nobody's short, so no goal ends one
  if (rule === "sit_out") return ends;
  const on = (p: PenaltyLike, t: number) => p.atMs! < t && ends.get(p.id)! > t;
  for (const g of goals.filter((x) => x.atMs !== null).sort((a, b) => a.atMs! - b.atMs!)) {
    const t = g.atMs!;
    const boxed = (teamId: number) => timed.filter((p) => p.teamId === teamId && on(p, t));
    const scorers = boxed(g.teamId).length;
    // Two teams a game: whoever's against the scorers
    const teams = new Set(timed.filter((p) => p.teamId !== g.teamId && on(p, t)).map((p) => p.teamId));
    for (const team of teams) {
      const theirs = boxed(team);
      if (theirs.length <= scorers) continue;
      const minor = theirs.filter((p) => isMinor(p.minutes)).sort((a, b) => a.atMs! - b.atMs! || a.id - b.id)[0];
      if (!minor) continue;
      const half = firstHalf.get(minor.id);
      if (half !== undefined && t < half) {
        // The first two end; the second two are served in full from now
        firstHalf.set(minor.id, t);
        ends.set(minor.id, t + 2 * 60_000);
      } else ends.set(minor.id, t);
    }
  }
  return ends;
}

/**
 * The penalties being served at `elapsedMs` of game time, in the order given, each with the time left (a double
 * minor's both halves, so 4:00 counting down) and whether it's a double minor (shown 2+2). Sitting out, a bench
 * penalty has nobody to sit out: no clock.
 */
export function running<P extends PenaltyLike>(
  penalties: P[],
  goals: GoalLike[],
  elapsedMs: number,
  rule: PenaltyRule = "power_play",
) {
  const ends = penaltyEnds(penalties, goals, rule);
  return penalties
    .filter((p) => rule === "power_play" || p.memberId !== null)
    .filter((p) => p.atMs !== null && p.atMs <= elapsedMs && ends.get(p.id)! > elapsedMs)
    .sort((a, b) => a.atMs! - b.atMs! || a.id - b.id)
    .map((penalty) => ({ penalty, leftMs: ends.get(penalty.id)! - elapsedMs, double: penalty.minutes === 4 }));
}

/** Penalty minutes, per player and per team, over these games (the leaderboards' PIM, #47). */
export function penaltyMinutes(games: { penalties?: PenaltyLike[] }[]) {
  const byMember = new Map<number, number>();
  const byTeam = new Map<number, number>();
  for (const p of games.flatMap((g) => g.penalties ?? [])) {
    if (p.memberId !== null) byMember.set(p.memberId, (byMember.get(p.memberId) ?? 0) + p.minutes);
    byTeam.set(p.teamId, (byTeam.get(p.teamId) ?? 0) + p.minutes);
  }
  return { byMember, byTeam };
}
