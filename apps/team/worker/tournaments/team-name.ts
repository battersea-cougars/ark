// A captain brings their team to the next edition of a series (ADR 0060): in a draft, the team they're named captain
// of starts with the name and logo of the team they last captained in an earlier edition of the same series, unless
// it's given its own. Nothing about it lives on the member (another club may have no Kumite): it's worked out from
// the editions, each keeping its own team's name and logo, so a rename changes only that edition's team, which is
// then the last one for next time. An erased member brings nothing; one who's never captained in it starts blank.
import { text } from "../api/api.http";

/** Team names are up to 40 characters, trimmed (the team's look and the editor say the same). */
export const teamNameOf = (o: Record<string, unknown>, key = "name") =>
  text(o, key, { optional: true, max: 40 }).trim();

/**
 * SQL for the team (its id) member `m` last captained in an earlier edition of tournament `edition`'s series (SQL: a
 * `?`): by day, and of editions on the same day the one made first. Null: none, so the automatic name and initials.
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
