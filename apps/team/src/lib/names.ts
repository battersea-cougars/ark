// The name a member goes by (ADR 0043): the one they chose on their profile (a nickname, their first name and initial,
// their full name), everywhere the app shows them, as on the website. Their full name stays for sign-in, payment
// references and an admin's views, and search finds either.

import { folded } from "./text";

interface Named {
  name: string;
  webName?: string | null;
}

/** What to call them: their chosen name, or their full name if they haven't chosen one. */
export const goesBy = (p: Named) => p.webName?.trim() || p.name;

/** The short form: on their trading card, in "Team …", greetings and lists of first names. A chosen name whole, else their first name. */
export const shortName = (p: Named) => p.webName?.trim() || p.name.trim().split(/\s+/)[0];

/** Search: either name, any part of it, accents and case aside ("zoe" finds Zoë). */
export const matchesName = (p: Named, query: string) => {
  const q = folded(query.trim());
  return !q || folded(p.name).includes(q) || (!!p.webName && folded(p.webName).includes(q));
};

/** For a lookup that may find no one: their name, or nothing. */
export const goesByOf = (p: Named | null | undefined) => (p ? goesBy(p) : "");
export const shortNameOf = (p: Named | null | undefined) => (p ? shortName(p) : "");

interface Captained {
  name?: string | null;
  captainMemberId: number | null;
}

/**
 * A team's name: its own, else "Team {captain}". Two captains with the same short name (two Alexes) get their surname
 * initial, "Team Alex B" and "Team Alex S"; the same initial too, their full name. Only among `teams`, its tournament's.
 */
export function nameOfTeam<T extends Captained>(
  team: T | undefined,
  teams: readonly T[],
  person: (id: number | null) => Named | undefined,
): string {
  if (!team) return "";
  if (team.name) return team.name;
  const captain = person(team.captainMemberId);
  if (!captain) return "Team";
  const short = shortName(captain);
  const twins = teams.flatMap((t) => {
    const c = t.captainMemberId !== team.captainMemberId && !t.name ? person(t.captainMemberId) : undefined;
    return c && shortName(c) === short ? [c] : [];
  });
  if (!twins.length) return `Team ${short}`;
  const initial = (p: Named) => {
    const words = p.name.trim().split(/\s+/);
    return words.length > 1 ? `${short} ${words.at(-1)![0].toUpperCase()}` : goesBy(p);
  };
  return `Team ${twins.some((c) => initial(c) === initial(captain)) ? goesBy({ name: captain.name }) : initial(captain)}`;
}

/** Every team's name in a tournament, in its order: what their crests are told apart among (@cougars/shared/team-initials). */
export const teamNamesOf = <T extends Captained>(
  teams: readonly T[],
  person: (id: number | null) => Named | undefined,
) => teams.map((t) => nameOfTeam(t, teams, person));
