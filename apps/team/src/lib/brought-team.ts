// The team a captain brings to a new edition of a series (ADR 0060, worker/tournaments/team-name.ts, which decides
// it): the one they last captained in an earlier edition of the same series, its name and logo. The editor shows it
// before it's saved ("Brings: Reacher Rounds"); the server works it out again as the team's made.
import type { Tournament } from "../demo/model";

export interface BroughtTeam {
  /** "" for the automatic "Team <name>". */
  name: string;
  logo: string | null;
}

/**
 * What `memberId` brings to the edition `edition` (its id if it's saved, its series and day; no day yet: after every
 * other), from the club's tournaments. Null: they've never captained in the series, or it has none.
 */
export function broughtTeam(
  tournaments: readonly Tournament[],
  edition: { id?: number; typeId: number | null; heldOn: string },
  memberId: number | null,
): BroughtTeam | null {
  if (edition.typeId == null || memberId == null) return null;
  const before = (t: Tournament) =>
    !edition.heldOn ||
    t.heldOn < edition.heldOn ||
    (t.heldOn === edition.heldOn && edition.id !== undefined && t.id < edition.id);
  const last = tournaments
    .filter((t) => t.typeId === edition.typeId && t.id !== edition.id && before(t))
    .filter((t) => t.teams.some((x) => x.captainMemberId === memberId))
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn) || b.id - a.id)[0];
  const team = last?.teams.find((x) => x.captainMemberId === memberId);
  return team ? { name: team.name, logo: team.logo } : null;
}
