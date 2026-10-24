// The club in parts, as opening the app and each page read it (#178, ADR 0053). Opening the app reads the core: who
// you are, the club's settings and menus, and what Home needs. Each page reads its own parts when it's opened: the
// whole roster, the weeks just held, each series' last one played, everyone's dues.
//
// A change says which parts it changed by their family's name (`members`, `sessions`, ...: worker/api routes'
// `changes`), and the live hub passes those names on (ADR 0072). Each family is a core part and the pages' parts that
// come from the same rows: a change to members is a change to Home's people and to the roster. This is where that's
// said, on both sides: the Worker sends back, with a change, the family's parts a phone holds; a phone hearing of a
// change knows which of the parts it holds are out of date.
//
// No imports, and only what Node can run as it is: the load runs' phones use this too (scripts/load/load.client.mjs).

/** Each family a change can name: the core's parts it changes, and the pages' (read only by a phone that holds them). */
export const FAMILIES: Record<string, { core: readonly string[]; pages: readonly string[] }> = {
  // Who's in Home's next things, and Home's line of who's asking to join, come from members too
  members: { core: ["people", "forAdmins"], pages: ["members"] },
  // Who's signed up names people on Home
  sessions: { core: ["sessions", "people"], pages: ["pastSessions"] },
  tournaments: { core: ["tournaments", "people"], pages: ["lastPlayed"] },
  clubEvents: { core: ["clubEvents", "people"], pages: [] },
  // What the club is owed in all, on an admin's Home
  dues: { core: ["dues", "forAdmins"], pages: ["clubDues"] },
  reminders: { core: [], pages: ["reminders"] },
};

/** The pages' own parts: never in the core, read when a page that shows them is opened. */
export const PAGE_PARTS: readonly string[] = Object.values(FAMILIES).flatMap((f) => f.pages);

/**
 * The parts a change to these families changed: the core's, and of the pages' only those `held` (all of them, if
 * not said). A name that isn't a family is a part of its own (`settings`, `quips`).
 */
export function partsChanged(names: readonly string[], held?: ReadonlySet<string> | readonly string[]): string[] {
  const holds = held && new Set(held);
  const out = new Set<string>();
  for (const name of names) {
    const family = FAMILIES[name];
    if (!family) {
      out.add(name);
      continue;
    }
    for (const part of family.core) out.add(part);
    for (const part of family.pages) if (!holds || holds.has(part)) out.add(part);
  }
  return [...out];
}

/** The header a phone names the pages' parts it holds in, on every change: they come back with it. */
export const HOLDS_HEADER = "x-club-holds";
