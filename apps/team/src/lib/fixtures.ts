// A tournament's games (ADR 0061), shared by the Worker (making fixtures, filling the playoffs) and the app (the
// Games and Standings pages): a round robin by the circle method, kick-off times and who keeps score. The table and the
// champions are shared with the website (packages/shared/results.ts, ADR 0100).
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

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (mins: number) => {
  const at = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
};
const earliest = (day: string | null, today: string) => (day && day > today ? today : day);

/**
 * A game started on another day than its tournament's (asked first, on the game's clock): the tournament moves to
 * today, its hours shifted so this game kicks off now and the day as long as before, and its sign-up and draft days
 * no later than the new day (the Worker refuses them after it).
 */
export function startingNow<
  T extends {
    startTime: string;
    endTime: string;
    gameMinutes: number;
    periods?: number;
    breakMinutes?: number;
    signupOpensOn: string | null;
    signupClosesOn: string | null;
    draftOn: string | null;
  },
>(t: T, position: number, today: string, now: string) {
  const start = minutes(now) - (position - 1) * (slotMinutes(t) + BREAK_MINUTES);
  const length = minutes(t.endTime) - minutes(t.startTime);
  return {
    ...t,
    heldOn: today,
    startTime: hhmm(start),
    endTime: hhmm(start + length),
    season: null,
    signupOpensOn: earliest(t.signupOpensOn, today),
    signupClosesOn: earliest(t.signupClosesOn, today),
    draftOn: earliest(t.draftOn, today),
  };
}
