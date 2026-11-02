// How a person is named on the public website (ADR 0016): the name they chose on their profile, else their
// first name and initial. Never a full name they didn't choose. The roster and the results both use it.

/** "Adrian Kowalski" → "Adrian K." A single name stays as it is. */
export function publicName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

/** What the website calls them: their chosen name, else first name and initial. */
export const onTheWebsite = (name: string, webName: string | null | undefined) => webName?.trim() || publicName(name);

/** The short form, for "Team …": their chosen name, else their first name. */
export const shortOnTheWebsite = (name: string, webName: string | null | undefined) =>
  webName?.trim() || name.trim().split(/\s+/)[0];
