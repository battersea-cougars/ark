// A captains' draft's turn order (ADR 0030), shared by the Draft page and the Worker: snake order, so the teams
// pick 1, 2, … n, then n, … 2, 1, and round again.

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

/** 1st, 2nd, 3rd, 4th…: a captain's place in the pick order, in words. */
export const nth = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
};

/** Whether a draft's pick order is drawn (ADR 0060): every captain has their number. */
export const orderDrawn = (teams: { pick?: number | null }[]) =>
  teams.length > 0 && teams.every((t) => typeof t.pick === "number");

/**
 * How many picks until a team's next turn, after `made` picks among `teams` teams in snake order, with `left` still
 * to pick: 0 when it's on the clock, Infinity when the pool runs out first.
 */
export function picksUntil(teams: number, made: number, team: number, left: number): number {
  for (let k = 0; k < left; k++) if (onTheClock(teams, made + k) === team) return k;
  return Infinity;
}

/** A captain's place and how soon they pick: "You pick 2nd · next in 3", "· you're next", "· now", or just the place. */
export function myTurnLine(place: number, until: number): string {
  const said = `You pick ${nth(place)}`;
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
 * many are left to pick, and, for a team, how many picks until its turn (0: now; Infinity: the pool runs out first).
 */
export function draftTurn(t: Drafting, team = -1) {
  const picks = t.teams.reduce((n, x) => n + x.players.filter((p) => typeof p.pick === "number").length, 0);
  const onTeams = new Set(t.teams.flatMap((x) => [x.captainMemberId, ...x.players.map((p) => p.memberId)]));
  const left = t.going.filter((id) => !onTeams.has(id)).length;
  let until = Infinity;
  if (team >= 0)
    for (let k = 0; k < left; k++)
      if (onTheClock(t.teams.length, picks + k) === team) {
        until = k;
        break;
      }
  return { picks, left, until };
}
