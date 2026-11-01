// A captains' draft's turn order (ADR 0030), shared by the Draft page and the Worker: snake order, so the teams
// pick 1, 2, … n, then n, … 2, 1, and round again.
import { ordinal } from "./dates";

/** A team has at least this many players, its captain included, so a draft only opens with enough to pick from. */
export const MIN_TEAM_SIZE = 3;
/** How many need to have signed up (not counting the captains) before a draft among `captains` can open. */
export const playersNeeded = (captains: number) => captains * (MIN_TEAM_SIZE - 1);

/** The index, in pick order, of the team on the clock after `made` picks among `teams` teams. */
export function onTheClock(teams: number, made: number): number {
  const round = Math.floor(made / teams);
  const slot = made % teams;
  return round % 2 ? teams - 1 - slot : slot;
}

/**
 * The draft's next `count` picks, each as its slot in the snake (0: round one's first pick), from the pick numbers
 * taken (1, 2, …). The turn follows the numbers, not how many there are (#125): a pick that came off (the player said
 * they're out, an admin took them off) leaves its number empty, and that's filled first, by the team whose pick it
 * was; then on from the last. With no gaps, the next slot is how many picks there are.
 */
export function nextSlots(taken: Iterable<number>, count: number): number[] {
  const have = new Set(taken);
  const out: number[] = [];
  for (let n = 1; out.length < count; n++) if (!have.has(n)) out.push(n - 1);
  return out;
}

/** Whether a draft's pick order is drawn (ADR 0060): every captain has their number. */
export const orderDrawn = (teams: { pick?: number | null }[]) =>
  teams.length > 0 && teams.every((t) => typeof t.pick === "number");

/**
 * How many picks until a team's next turn among `teams` teams in snake order, the picks to come being `slots`
 * (nextSlots, one for each player still to pick): 0 when it's on the clock, Infinity when the pool runs out first.
 */
export function picksUntil(teams: number, slots: readonly number[], team: number): number {
  const k = slots.findIndex((slot) => onTheClock(teams, slot) === team);
  return k < 0 ? Infinity : k;
}

/** A captain's place and how soon they pick: "You pick 2nd · next in 3", "· you're next", "· now", or just the place. */
export function myTurnLine(place: number, until: number): string {
  const said = `You pick ${ordinal(place)}`;
  if (until === 0) return `${said} · now`;
  if (until === 1) return `${said} · you're next`;
  return until === Infinity ? said : `${said} · next in ${until}`;
}

/** Enough of a tournament to say where its draft stands. */
interface Drafting {
  teams: { captainMemberId: number | null; players: { memberId: number | null; pick?: number | null }[] }[];
  going: number[];
}

/**
 * Where a draft stands: the picks made (as the server counts them: a player an admin put on by hand isn't one), how
 * many are left to pick, the slots of the picks to come (nextSlots: the turn follows the pick numbers, #125), and,
 * for a team, how many picks until its turn (0: now; Infinity: the pool runs out first).
 */
export function draftTurn(t: Drafting, team = -1) {
  const numbers = t.teams.flatMap((x) => x.players.flatMap((p) => (typeof p.pick === "number" ? [p.pick] : [])));
  const onTeams = new Set(t.teams.flatMap((x) => [x.captainMemberId, ...x.players.map((p) => p.memberId)]));
  const left = t.going.filter((id) => !onTeams.has(id)).length;
  const slots = nextSlots(numbers, left);
  const until = team >= 0 ? picksUntil(t.teams.length, slots, team) : Infinity;
  return { picks: numbers.length, left, slots, until };
}
