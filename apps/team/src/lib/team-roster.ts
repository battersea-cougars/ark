// A team's roster, as a game, the team's page and the teams list show it: its captain first, then its players in
// order. Someone who's left stays in their place, by "Someone who's left" and with no position (lib/names.ts).
import type { Position } from "../demo/data";
import type { TournamentTeam } from "../demo/model";
import { nameOfPlayer } from "./names";

interface Person {
  name: string;
  webName?: string | null;
  position: Position;
}

/** One line of a roster: who, by the name the viewer may see, and their position when the viewer's app holds them. */
export interface RosterRow {
  key: string;
  memberId: number | null;
  name: string;
  position: Position | undefined;
  captain: boolean;
  pick: number | null;
}

type Rostered = Pick<TournamentTeam, "captainMemberId" | "captainName" | "players">;

export function rosterOf(team: Rostered, person: (id: number) => Person | undefined): RosterRow[] {
  const row = (memberId: number | null, name: string, captain: boolean, pick: number | null, k: number): RosterRow => ({
    key: `${captain ? "c" : "p"}${memberId ?? name}${k}`,
    memberId,
    name: nameOfPlayer({ memberId, name }, person),
    position: memberId ? person(memberId)?.position : undefined,
    captain,
    pick,
  });
  const captain =
    team.captainMemberId || team.captainName ? [row(team.captainMemberId, team.captainName, true, null, 0)] : [];
  return [
    ...captain,
    ...team.players.map((p, k) => row(p.memberId, p.name, false, typeof p.pick === "number" ? p.pick : null, k)),
  ];
}
