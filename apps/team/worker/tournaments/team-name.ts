// A captain's default Kumite team name (ADR 0060): the name their team takes when they're named captain of a Kumite,
// so a captain carries their name from one to the next. One field on the member (members.kumite_team_name), theirs to
// set on their profile and an admin's in their editor, and overwritten whenever their Kumite team is renamed. Empty
// text is the automatic name ("Team <first name>", the app's). Never set (null): their latest Kumite team's name, so
// captains from before the field keep theirs. An erased member carries nothing.
import { text } from "../api/api.http";

/** The series whose captains carry their team name: the Kumite, by its slug. */
export const KUMITE = "kumite";

/** Team names are up to 40 characters, trimmed (the team's look and the editor say the same). */
export const teamNameOf = (o: Record<string, unknown>, key = "name") =>
  text(o, key, { optional: true, max: 40 }).trim();

/**
 * SQL for member `m`'s default Kumite team name: their own, else their latest Kumite team's (by its day), leaving out
 * the tournament `except` names (SQL: a `?`, or "0" for none), the one the team's being named in. Null: none, the
 * automatic name.
 */
export const carriedName = (except = "0") => `CASE WHEN m.status = 'erased' THEN NULL ELSE coalesce(m.kumite_team_name,
    (SELECT tt.name FROM tournament_teams tt JOIN tournaments t ON t.id = tt.tournament_id
       JOIN tournament_types ty ON ty.id = t.type_id
     WHERE tt.captain_member_id = m.id AND ty.slug = '${KUMITE}' AND t.id != ${except}
     ORDER BY t.held_on DESC, t.id DESC LIMIT 1)) END`;

/** A team in a tournament as it's being named: what its captain carries (null: it isn't carrying, it keeps `name`). */
export interface Naming {
  carried: string | null;
  name: string;
  /** Its automatic name, "Team <captain's short name>", as the app shows it (names.ts); null: no captain. */
  automatic: string | null;
}

/**
 * The names new captains' teams start with: each their carried name, unless another team in the tournament goes by it,
 * case aside, when it's the automatic name (""). Going by it: a team keeping its name, or an unnamed one its automatic
 * name; a team carrying a name before it, that name; and any other carrying team its automatic name, since it may end up
 * with it.
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
