// Periods (ADR 0061), shared by the Worker and the app: a game is 1 to 3 periods of the tournament's game minutes,
// the clock running per period. Goals and penalties keep their period and the time into it; game time runs on across
// the breaks, so a penalty given late in one period carries into the next. The box score is the goals per period.

/** How many periods a game can have, as a series' setting shows them. */
export const PERIOD_OPTIONS = [
  { value: "1", label: "1", hint: "One run of the clock" },
  { value: "2", label: "2", hint: "Halves" },
  { value: "3", label: "3", hint: "Thirds, as in the NHL" },
];

/** How long a game is, in words: "12-minute games", or "games of 3 × 12-minute periods". */
export const gameLength = (t: { gameMinutes: number; periods?: number }) =>
  (t.periods ?? 1) > 1 ? `games of ${t.periods} × ${t.gameMinutes}-minute periods` : `${t.gameMinutes}-minute games`;

/** 1st, 2nd, 3rd. */
export const periodName = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/** Time into the whole game: the periods before, then the time into this one. Null when nobody timed it. */
export const inGameTime = (period: number | null | undefined, atMs: number | null, periodMs: number) =>
  atMs === null ? null : ((period ?? 1) - 1) * periodMs + atMs;

/**
 * The box score: each team's goals per period (none shown for a one-period game) and in all. A goal nobody timed
 * (a result typed in) counts in the total only.
 */
export function boxScore(goals: { teamId: number; period?: number | null }[], teamIds: number[], periods: number) {
  const shown = periods > 1 ? periods : 0;
  return {
    columns: Array.from({ length: shown }, (_, i) => periodName(i + 1)),
    rows: teamIds.map((teamId) => {
      const theirs = goals.filter((g) => g.teamId === teamId);
      return {
        teamId,
        byPeriod: Array.from({ length: shown }, (_, i) => theirs.filter((g) => g.period === i + 1).length),
        total: theirs.length,
      };
    }),
  };
}
