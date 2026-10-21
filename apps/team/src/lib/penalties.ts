// Penalties (ADR 0061), shared by the Worker and the app: what can be called, the penalty clock, and the minutes each
// player and team has spent in the box. The clock is worked out, never stored: a penalty runs in game time from when
// it was given (or, a player's second, from when their first ends), so it pauses when the game clock does, and a
// minor ends early at a power-play goal against its team. Penalties called on both teams at once cancel out
// (coincidental): no man advantage, or four on four for one minor each.
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
/** The usual length, a series' setting each tournament copies (ADR 0061): the penalty sheet starts on it. */
export const PENALTY_LENGTH_OPTIONS = PENALTY_KINDS.map((k) => ({
  value: String(k.minutes),
  label: k.name,
  hint: k.length,
}));
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

/** When a penalty's served, in game time: from when it starts (a player's next waits for their last) to its end. */
export interface Served {
  startMs: number;
  endMs: number;
  /**
   * Called at the same time as one of the same length on the other team: the two cancel out, so neither counts for
   * the man advantage, and no goal ends it (it's served in full).
   */
  coincidental: boolean;
  /** One of a pair of coincidental minors with nothing else on: both teams play a player short, four on four. */
  fourOnFour: boolean;
}

/**
 * When each penalty is served, in game time, by id, and whether it counts for the man advantage. A penalty with no
 * time has none.
 *
 * - **One after another**: a player serves one penalty at a time, so one given while they're still serving another
 *   starts when that one ends (in both rules). A bench penalty is nobody's: it starts when it's given.
 * - **Coincidental**: penalties called on both teams at the same moment of game time (the same stoppage) cancel out
 *   in pairs of the same length (a minor with a minor, a double minor with a double, a major with a major); a major
 *   against a minor doesn't cancel. A cancelled pair is served in full, the players replaced on the ice: no man
 *   advantage, and no goal ends them. The exception is **one minor each with nothing else on the clock**: the teams
 *   play four on four (both a player short, so still no power play). The players come out at the next stoppage
 *   after their time's up; we don't record stoppages, so they're served when their time runs out.
 * - **A power-play goal** (a goal against a team with more players short than the scorers, counting only what
 *   doesn't cancel) ends the penalised team's earliest running minor that isn't coincidental; in a double minor, only
 *   the two minutes being served: in the first two, the second two start fresh from the goal. A major runs its five.
 * - **Sitting out**, nobody's short: no man advantage, nothing cancels, and no goal ends one.
 *
 * Worked out moment by moment, in time order: a goal's cut can move when a waiting penalty starts, which changes
 * who's on at the next goal, and whether a later pair is four on four.
 */
export function penaltyClock(penalties: PenaltyLike[], goals: GoalLike[], rule: PenaltyRule = "power_play") {
  const timed = penalties
    .filter((p) => p.atMs !== null)
    .sort((a, b) => a.atMs! - b.atMs! || a.id - b.id) as (PenaltyLike & { atMs: number })[];
  // What goals did: a penalty ended there, or a double minor's first two ended there (the second two from then)
  const endedAt = new Map<number, number>();
  const halfEndedAt = new Map<number, number>();
  const pairs = new Map<number, { coincidental: boolean; fourOnFour: boolean }>();

  const schedule = () => {
    const out = new Map<number, Served>();
    const lastEnd = new Map<string, number>();
    for (const p of timed) {
      const player = p.memberId === null ? null : `${p.teamId}:${p.memberId}`;
      const startMs = Math.max(p.atMs, player ? (lastEnd.get(player) ?? -Infinity) : -Infinity);
      const endMs =
        endedAt.get(p.id) ??
        (halfEndedAt.has(p.id) ? halfEndedAt.get(p.id)! + 2 * 60_000 : startMs + p.minutes * 60_000);
      if (player) lastEnd.set(player, endMs);
      out.set(p.id, { startMs, endMs, coincidental: false, fourOnFour: false, ...pairs.get(p.id) });
    }
    return out;
  };

  let served = schedule();
  if (rule === "sit_out") return served;
  // Counts for the man advantage: not cancelled out (or cancelled, but played four on four)
  const counts = (id: number) => !served.get(id)!.coincidental || served.get(id)!.fourOnFour;
  const goalTimes = goals.filter((x) => x.atMs !== null).map((x) => x.atMs!);
  const moments = [...new Set([...goalTimes, ...timed.map((p) => p.atMs)])].sort((a, b) => a - b);
  for (const t of moments) {
    // Goals first: a penalty called at the moment of a goal starts after it
    for (const g of goals.filter((x) => x.atMs === t)) {
      // Short at the goal: started before it, not yet served, and counting
      const short = (teamId: number) =>
        timed.filter(
          (p) => p.teamId === teamId && served.get(p.id)!.startMs < t && served.get(p.id)!.endMs > t && counts(p.id),
        );
      const scorers = short(g.teamId).length;
      // Two teams a game: whoever's against the scorers
      for (const team of new Set(timed.filter((p) => p.teamId !== g.teamId).map((p) => p.teamId))) {
        const theirs = short(team);
        if (theirs.length <= scorers) continue;
        const minor = theirs
          .filter((p) => isMinor(p.minutes) && !served.get(p.id)!.coincidental)
          .sort((a, b) => served.get(a.id)!.startMs - served.get(b.id)!.startMs || a.id - b.id)[0];
        if (!minor) continue;
        const { startMs } = served.get(minor.id)!;
        const halfEnd = halfEndedAt.get(minor.id) ?? startMs + 2 * 60_000;
        // A double minor's first two end; the second two are served in full from now. Else it's over
        if (minor.minutes === 4 && !halfEndedAt.has(minor.id) && t < halfEnd) halfEndedAt.set(minor.id, t);
        else endedAt.set(minor.id, t);
      }
      served = schedule();
    }
    // Then what's called now: pairs of the same length, one a team, cancel out
    const called = timed.filter((p) => p.atMs === t);
    const teams = [...new Set(called.map((p) => p.teamId))];
    if (teams.length !== 2) continue;
    const [a, b] = teams.map((team) => called.filter((p) => p.teamId === team));
    for (const minutes of PENALTY_MINUTES) {
      const ofA = a.filter((p) => p.minutes === minutes);
      const ofB = b.filter((p) => p.minutes === minutes);
      for (let i = 0; i < Math.min(ofA.length, ofB.length); i++)
        for (const p of [ofA[i], ofB[i]]) pairs.set(p.id, { coincidental: true, fourOnFour: false });
    }
    // One minor each, and nothing else on the clock (running or waiting): four on four
    const onAlready = timed.some((p) => p.atMs < t && served.get(p.id)!.endMs > t);
    if (a.length === 1 && b.length === 1 && a[0].minutes === 2 && b[0].minutes === 2 && !onAlready)
      for (const p of [a[0], b[0]]) pairs.set(p.id, { coincidental: true, fourOnFour: true });
    served = schedule();
  }
  return served;
}

/**
 * How many players each team is short at `elapsedMs` of game time, by team (only those short): its penalties being
 * served that count for the man advantage (penaltyClock). Sitting out, nobody's ever short.
 */
export function playersShort(
  penalties: PenaltyLike[],
  goals: GoalLike[],
  elapsedMs: number,
  rule: PenaltyRule = "power_play",
) {
  const out = new Map<number, number>();
  if (rule === "sit_out") return out;
  const served = penaltyClock(penalties, goals, rule);
  for (const p of penalties) {
    const s = served.get(p.id);
    if (!s || s.startMs > elapsedMs || s.endMs <= elapsedMs || (s.coincidental && !s.fourOnFour)) continue;
    out.set(p.teamId, (out.get(p.teamId) ?? 0) + 1);
  }
  return out;
}

/**
 * The strength on the ice, as hockey says it, this team first: "5 on 4", "4 on 4"; nothing at full strength. Five
 * skaters a side, never fewer than three.
 */
export const manpower = (ours: number, theirs: number) =>
  ours || theirs ? `${Math.max(3, 5 - ours)} on ${Math.max(3, 5 - theirs)}` : "";

/** When each penalty ends, in game time, by id (penaltyClock). */
export const penaltyEnds = (penalties: PenaltyLike[], goals: GoalLike[], rule: PenaltyRule = "power_play") =>
  new Map([...penaltyClock(penalties, goals, rule)].map(([id, s]) => [id, s.endMs]));

/**
 * The penalties on the clock at `elapsedMs` of game time, in the order they're served, each with the time left (a
 * double minor's both halves, so 4:00 counting down) and whether it's a double minor (shown 2+2). One waiting for the
 * player's last to end is there too (`waiting`), its whole length left: "then 2:00". Sitting out, a bench penalty has
 * nobody to sit out: no clock.
 */
export function running<P extends PenaltyLike>(
  penalties: P[],
  goals: GoalLike[],
  elapsedMs: number,
  rule: PenaltyRule = "power_play",
) {
  const served = penaltyClock(penalties, goals, rule);
  return penalties
    .filter((p) => rule === "power_play" || p.memberId !== null)
    .filter((p) => p.atMs !== null && p.atMs <= elapsedMs && served.get(p.id)!.endMs > elapsedMs)
    .map((penalty) => ({ penalty, ...served.get(penalty.id)! }))
    .sort((a, b) => a.startMs - b.startMs || a.penalty.id - b.penalty.id)
    .map(({ penalty, startMs, endMs }) => ({
      penalty,
      leftMs: endMs - Math.max(startMs, elapsedMs),
      double: penalty.minutes === 4,
      waiting: startMs > elapsedMs,
    }));
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
