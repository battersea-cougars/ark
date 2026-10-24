// When two captains' sides last met (the matchup page): past games where one was on each team, as captain or player.
// Teams are drafted afresh every time, so it's the people who carry over, not the teams.
import type { Season } from "@cougars/shared/seasons";

interface Side {
  id?: number | null;
  captainMemberId: number | null;
  players: { memberId: number | null }[];
}
interface Played {
  id: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  status: string;
  position: number;
}
interface Edition<T extends Side = Side, G extends Played = Played> {
  id: number;
  heldOn: string;
  teams: T[];
  games?: G[];
}

/** A past edition as the server sends it for a matchup (worker/tournaments/matchups.ts): where both captains played. */
export interface PastMeeting {
  id: number;
  heldOn: string;
  season: Season | null;
  name: string;
  startTime: string;
  endTime: string;
  teams: { id: number; name: string; captainMemberId: number | null; players: { memberId: number | null }[] }[];
  games: Played[];
}

const on = (t: Side | undefined, memberId: number) =>
  !!t && (t.captainMemberId === memberId || t.players.some((p) => p.memberId === memberId));

/** Past games (not `current`'s) where `a` was on one side and `b` the other, newest first; the score from a's side. */
export function meetings<E extends Edition>(editions: E[], current: { id: number }, a: number, b: number) {
  const out: { tournament: E; game: NonNullable<E["games"]>[number]; for: number; against: number }[] = [];
  for (const t of editions) {
    if (t.id === current.id) continue;
    const team = (id: number | null) => t.teams.find((x) => x.id === id);
    for (const g of t.games ?? []) {
      if (g.status !== "done" || g.homeGoals === null || g.awayGoals === null) continue;
      const home = team(g.homeTeamId);
      const away = team(g.awayTeamId);
      if (on(home, a) && on(away, b) && !on(home, b) && !on(away, a))
        out.push({ tournament: t, game: g, for: g.homeGoals, against: g.awayGoals });
      else if (on(away, a) && on(home, b) && !on(away, b) && !on(home, a))
        out.push({ tournament: t, game: g, for: g.awayGoals, against: g.homeGoals });
    }
  }
  return out.sort(
    (x, y) => y.tournament.heldOn.localeCompare(x.tournament.heldOn) || y.game.position - x.game.position,
  );
}
