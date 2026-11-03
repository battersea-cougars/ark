// A tournament's teams as every page shows them: each one's name (its own, else "Team {captain}", told apart among
// the others), crest names, logo and colour, found by the team's id, and whose team a player is on.
import { playerOf } from "../demo/data";
import { nameOfTeam, teamNamesOf } from "./names";
import { teamTone } from "./team-tones";

interface Named {
  name: string;
  webName?: string | null;
}

export interface ShownTeam {
  id?: number;
  name?: string | null;
  logo?: string | null;
  captainMemberId: number | null;
  players?: { memberId: number | null }[];
}

/** The teams, looked up by id. `person` finds a member (the club's, by default). */
export function teamsOf<T extends ShownTeam>(
  teams: readonly T[],
  person: (id: number | null) => Named | undefined = playerOf,
) {
  /** Every team's name, in their order: what each crest is told apart among (@cougars/shared/team-initials). */
  const names = teamNamesOf(teams, person);
  const indexOf = (id: number | null | undefined) => teams.findIndex((t) => t.id === id);
  return {
    names,
    indexOf,
    team: (id: number | null | undefined): T | undefined => teams[indexOf(id)],
    nameOf: (id: number | null | undefined) => names[indexOf(id)] ?? "",
    logoOf: (id: number | null | undefined) => teams[indexOf(id)]?.logo ?? null,
    toneOf: (id: number | null | undefined) => teamTone(indexOf(id)),
    /** What its crest needs (lib/TeamCrest): the names it's told apart among, its name, logo and colour. */
    crestOf: (id: number | null | undefined) => ({
      among: names,
      name: names[indexOf(id)] ?? "",
      logo: teams[indexOf(id)]?.logo ?? null,
      tone: teamTone(indexOf(id)),
    }),
    /** The name it'd have with none of its own ("Team Dan"): what its name field offers. */
    unnamed: (team: T) => nameOfTeam({ ...team, name: "" }, teams, person),
    /** The team a member captains or plays on, by its id; null for none. */
    teamOf: (memberId: number | null) =>
      teams.find((t) => t.captainMemberId === memberId || t.players?.some((p) => p.memberId === memberId))?.id ?? null,
  };
}
