// Each page's own parts of the club, read when it's opened (#178, ADR 0053). Opening the app reads the core (Home,
// and what every page shares: who you are, the club's settings and menus); a page that shows more asks for the rest
// in one request when it's opened: the roster, the weeks just held, each series' last one played, everyone's dues.
// Once the app's up and the phone's idle, the parts of the pages you're likely to open next are read the same way, so
// moving between pages doesn't wait (PREFETCH).
//
// What's read is kept while the app is open, in memory only, like the core (#81): never on disk, so nothing of the
// club stays on a phone after signing out. Changes come back with the change (the phone says what it holds,
// HOLDS_HEADER) and from the live hub as for the core (catch-up.ts). When the core is read again and finds the club
// changed, the parts held are asked about again with their tag: unchanged, an empty 304.
import type { Action } from "../access/actions";
import { PAGE_PARTS } from "./club-parts";
import { held, readParts } from "./api";

/**
 * The parts on their way, and those that couldn't be read (offline, resting): a page waiting for its own shows once
 * they're in, or with what the app has once they couldn't be.
 */
export const pageData = $state({ reading: [] as string[], missed: [] as string[], round: 0 });

// Not shown as they are: pages see them through pageData.round, which moves on with each read
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the parts held, pageData.round says when they change
const holding = new Set<string>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not shown: only the reads use them
const tags = new Map<string, string>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not shown: only the reads use them
const inFlight = new Map<string, Promise<void>>();

/** How a read's parts go into the app (backend.svelte.ts): `version`, the data version they were read at. */
let putInPlace: (slices: Record<string, unknown>, version: number | undefined, fresh: boolean) => void = () => {};
export const onParts = (put: typeof putInPlace) => void (putInPlace = put);

// What a change sends back and the live hub's events count in: what's held
held.parts = () => [...holding];

/** Who sees everyone's dues (ADR 0007): the pages that show a member show what they owe too. */
const seesDues = (actions: ReadonlySet<Action>) =>
  actions.has("manage:all") || actions.has("read:Dues") || actions.has("record:Payment");

const KUMITE = ["members", "lastPlayed"];
const NIGHTS = ["members", "pastSessions"];
const EVERYONE = ["members", "pastSessions", "lastPlayed"];

/**
 * What each page shows beyond the core (route.page, app/nav-routes.ts). Home and the setting-up pages need nothing
 * more; a Kumite's pages, the roster and the series' last one; a training night and the calendar, the weeks just held;
 * the members' pages, everything, and everyone's dues for whoever sees them. A page not here is given everything.
 */
const NEEDS: Record<string, readonly string[]> = {
  home: [],
  announcements: [],
  privacy: [],
  profile: [],
  tab: [],
  roles: [],
  usage: [],
  errors: [],
  email: [],
  website: [],
  audit: [],
  "training-settings": [],
  venues: [],
  fees: [],
  quips: [],
  settings: [],
  upload: [],
  calendar: ["pastSessions", "lastPlayed"],
  training: NIGHTS,
  games: KUMITE,
  game: KUMITE,
  "tournament-team": KUMITE,
  history: KUMITE,
  "draft-room": KUMITE,
  matchup: KUMITE,
  awards: KUMITE,
  teammates: KUMITE,
  "tournament-settings": ["lastPlayed"],
  "tournament-series": ["lastPlayed"],
};
/** The pages that show what members owe, for whoever sees everyone's dues. */
const OWED_ON = new Set(["members", "overdue", "training", "view-as"]);

/** The pages' parts this page shows (`page`: route.page; none: the address isn't a page yet, so everything). */
export function needsOf(page: string | undefined, actions: ReadonlySet<Action>): string[] {
  const parts = page && Object.hasOwn(NEEDS, page) ? NEEDS[page] : EVERYONE;
  const owed = (!page || OWED_ON.has(page)) && seesDues(actions) ? ["clubDues", "reminders"] : [];
  return [...parts, ...owed];
}

/**
 * Read once the app's up, while the phone's idle: what the pages you can open next show, so they open at once.
 * Everyone's dues only for who sees them. Skipped when the phone asks to save data (Data Saver, Low Data Mode).
 */
export function prefetch(actions: ReadonlySet<Action>) {
  if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const parts = [...EVERYONE, ...(seesDues(actions) ? ["clubDues", "reminders"] : [])];
  const idle = (run: () => void) =>
    "requestIdleCallback" in window ? requestIdleCallback(run, { timeout: 5000 }) : setTimeout(run, 1500);
  // A failure is only ours to hear of when the page that wants them asks again
  idle(() => void need(parts).catch(() => {}));
}

/** The pages' parts the page in view shows (App.svelte): the others may be let go when they change. */
let inView: readonly string[] = [];
export const showing = (parts: readonly string[]) => void (inView = parts);

/**
 * Of these changed parts, the pages' that no page in view shows: let go, not read now (catch-up.ts letGo). A phone
 * on Home through Friday's taps doesn't read the weeks just held again for each; the training night's page, when it
 * opens, asks about them with their tag (#178).
 */
export function letGo(parts: readonly string[]): string[] {
  const away = parts.filter((p) => holding.has(p) && !inView.includes(p));
  for (const p of away) holding.delete(p);
  if (away.length) pageData.round++;
  return away;
}

/** Whether a page showing these parts can show: they're in, or couldn't be read. */
export const readyFor = (parts: readonly string[]) => (
  void pageData.round,
  parts.every((p) => holding.has(p) || pageData.missed.includes(p))
);

/** These parts, read unless they're in; one request for whatever's missing. */
export function need(parts: readonly string[]): Promise<void> {
  const missing = parts.filter((p) => PAGE_PARTS.includes(p) && !holding.has(p));
  if (!missing.length) return Promise.resolve();
  return read(missing, true);
}

/** The parts held asked about again (the core found the club changed): an empty 304 for each that hasn't. */
export function revalidate(): Promise<void> {
  if (!holding.size) return Promise.resolve();
  return read([...holding], true);
}

// `again`: asked with the tag of the last read of the same parts, if there was one (unchanged: an empty 304)
function read(parts: string[], again: boolean): Promise<void> {
  const key = [...parts].sort().join(",");
  const going = inFlight.get(key);
  if (going) return going;
  pageData.reading = [...new Set([...pageData.reading, ...parts])];
  const reading = (async () => {
    try {
      const { slices, version, tag } = await readParts(parts, again ? (tags.get(key) ?? null) : null);
      if (tag) tags.set(key, tag);
      // Unchanged since the app read them (an empty 304): what it has is what there is
      if (slices) putInPlace(slices, version, !parts.every((p) => holding.has(p)));
      for (const p of parts) holding.add(p);
      pageData.missed = pageData.missed.filter((p) => !parts.includes(p));
      pageData.round++;
    } catch (e) {
      pageData.missed = [...new Set([...pageData.missed, ...parts])];
      throw e;
    } finally {
      inFlight.delete(key);
      const still = new Set([...inFlight.keys()].flatMap((k) => k.split(",")));
      pageData.reading = pageData.reading.filter((p) => !parts.includes(p) || still.has(p));
    }
  })();
  inFlight.set(key, reading);
  return reading;
}
