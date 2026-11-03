// A captain brings their team to the next edition of a series (apps/team/worker/tournaments/README.md): the name and
// logo of the team they last captained in it, worked out from the editions, nothing kept on the member.
import { text } from "../api/api.http";
import { LOGO_SENT } from "../api/api.club";
import { logoAddress } from "./tournaments";

/** Team names are up to 40 characters, trimmed (the team's look and the editor say the same). */
export const teamNameOf = (o: Record<string, unknown>, key = "name") =>
  text(o, key, { optional: true, max: 40 }).trim();

/**
 * SQL for the team (its id) member `m` last captained in an earlier edition of tournament `edition`'s series (SQL: a
 * `?`): by day, and of editions on the same day the one made first. Null: none, so the automatic name and initials.
 * Each edition keeps its own team's name and logo, so a rename changes only that one; an erased member brings nothing.
 */
export const broughtTeam = (edition = "?") => `CASE WHEN m.status != 'erased' THEN
    (SELECT tt.id FROM tournaments this JOIN tournaments t ON t.type_id = this.type_id
       JOIN tournament_teams tt ON tt.tournament_id = t.id
     WHERE this.id = ${edition} AND tt.captain_member_id = m.id
       AND (t.held_on < this.held_on OR (t.held_on = this.held_on AND t.id < this.id))
     ORDER BY t.held_on DESC, t.id DESC LIMIT 1) END`;

/** A team in a tournament as it's being named: the name its captain brings (null: it isn't bringing one, it keeps `name`). */
export interface Naming {
  carried: string | null;
  name: string;
  /** Its automatic name, "Team <captain's short name>", as the app shows it (names.ts); null: no captain. */
  automatic: string | null;
}

/**
 * The names new captains' teams start with: each the name they bring, unless another team in the tournament goes by
 * it, case aside, when it's the automatic name (""). Going by it: a team keeping its name, or an unnamed one its
 * automatic name; a team bringing a name before it, that name; and any other bringing team its automatic name, since
 * it may end up with it.
 */
export function carriedNames(teams: readonly Naming[]): string[] {
  const key = (n: string | null) => n?.trim().toLowerCase() || "";
  const kept = new Set(teams.filter((t) => t.carried === null).map((t) => key(t.name || t.automatic)));
  const given = new Set<string>();
  return teams.map((t, i) => {
    if (t.carried === null) return t.name;
    const k = key(t.carried);
    const othersAutomatic = teams.some((o, j) => j !== i && o.carried !== null && key(o.automatic) === k);
    if (!k || kept.has(k) || given.has(k) || othersAutomatic) return "";
    given.add(k);
    return t.carried;
  });
}

/**
 * What each captain brings to an edition of series `typeId` on `heldOn` (null: no day yet, so after every other),
 * `id` if it's saved: for every member who's captained an earlier edition, the team they last captained, its
 * name and its logo's address. The editor shows it before the team's made ("Brings: Reacher Rounds"), read from the
 * server, not the editions the app holds.
 */
export async function broughtTeams(db: D1Database, typeId: number, heldOn: string | null, id: number | null) {
  const { results } = await db
    .prepare(
      `SELECT memberId, teamId, name, logo FROM (
         SELECT tt.captain_member_id memberId, tt.id teamId, tt.name, ${LOGO_SENT("tt")} logo,
                ROW_NUMBER() OVER (PARTITION BY tt.captain_member_id ORDER BY t.held_on DESC, t.id DESC) n
         FROM tournaments t JOIN tournament_teams tt ON tt.tournament_id = t.id
           JOIN members m ON m.id = tt.captain_member_id
         WHERE t.type_id = ? AND m.status != 'erased' AND t.id IS NOT ?
           AND (? IS NULL OR t.held_on < ? OR (t.held_on = ? AND ? IS NOT NULL AND t.id < ?)))
       WHERE n = 1 ORDER BY memberId`,
    )
    .bind(typeId, id, heldOn, heldOn, heldOn, id, id)
    .all<{ memberId: number; teamId: number; name: string; logo: string | null }>();
  return results.map((r) => ({
    memberId: r.memberId,
    name: r.name,
    logo: r.logo ? logoAddress(r.teamId, r.logo) : null,
  }));
}
