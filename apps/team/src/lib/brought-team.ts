// The team a captain brings to a new edition of a series (apps/team/worker/tournaments/README.md): the one they last
// captained in an earlier edition, its name and logo, shown in the editor before it's saved ("Brings: Reacher Rounds").
// The server has every edition, so it decides (worker/tournaments/team-name.ts), again as the team's made.
import { readTagged } from "../app/api";

export interface BroughtTeam {
  /** "" for the automatic "Team <name>". */
  name: string;
  logo: string | null;
}

/**
 * What each captain brings to the edition `edition` (its id if it's saved, its series and day; no day yet: after every
 * other), by member. Nobody in it: they've never captained in the series.
 */
export async function broughtTeams(edition: {
  id?: number;
  typeId: number | null;
  heldOn: string;
}): Promise<Record<number, BroughtTeam>> {
  const out: Record<number, BroughtTeam> = {};
  if (edition.typeId == null) return out;
  const query = [edition.heldOn ? `heldOn=${edition.heldOn}` : "", edition.id ? `tournament=${edition.id}` : ""];
  const { data } = await readTagged<{ brings: ({ memberId: number } & BroughtTeam)[] }>(
    `/api/tournament-types/${edition.typeId}/brings?${query.filter(Boolean).join("&")}`,
    null,
  );
  for (const b of data?.brings ?? []) out[b.memberId] = { name: b.name, logo: b.logo };
  return out;
}
