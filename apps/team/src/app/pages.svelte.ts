// Page components by route.page (nav-routes.ts pairs each page with its params), each in its own chunk: a phone
// downloads and parses the page it opens on, not all of them. main.ts loads that one before the app mounts, so the
// first paint has its page; once the app's up, the pages you can open load in the background, so moving between
// them never waits. Pages take different props, so the map is loosely typed.
import type { Component } from "svelte";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = Component<any>;

const LOADERS: Record<string, () => Promise<{ default: Page }>> = {
  home: () => import("../pages/Home.svelte"),
  calendar: () => import("../pages/Calendar.svelte"),
  training: () => import("../pages/Training.svelte"),
  games: () => import("../pages/Games.svelte"),
  schedule: () => import("../pages/Schedule.svelte"),
  standings: () => import("../pages/Standings.svelte"),
  "tournament-teams": () => import("../pages/TournamentTeams.svelte"),
  "tournament-team": () => import("../pages/TournamentTeam.svelte"),
  draft: () => import("../pages/Draft.svelte"),
  history: () => import("../pages/History.svelte"),
  edition: () => import("../pages/Edition.svelte"),
  game: () => import("../pages/Game.svelte"),
  matchup: () => import("../pages/Matchup.svelte"),
  teammates: () => import("../pages/Teammates.svelte"),
  announcements: () => import("../pages/Announcements.svelte"),
  members: () => import("../pages/Members.svelte"),
  upload: () => import("../pages/Upload.svelte"),
  more: () => import("../pages/More.svelte"),
  profile: () => import("../pages/Profile.svelte"),
  privacy: () => import("../pages/Privacy.svelte"),
  tab: () => import("../pages/MyTab.svelte"),
  roles: () => import("../pages/Roles.svelte"),
  usage: () => import("../pages/Usage.svelte"),
  audit: () => import("../pages/AuditLog.svelte"),
  "dev-tools": () => import("../pages/DevTools.svelte"),
  "training-settings": () => import("../pages/TrainingSettings.svelte"),
  "tournament-settings": () => import("../pages/TournamentSettings.svelte"),
  "tournament-series": () => import("../pages/TournamentSeries.svelte"),
  venues: () => import("../pages/Venues.svelte"),
  fees: () => import("../pages/Fees.svelte"),
  overdue: () => import("../pages/Overdue.svelte"),
  quips: () => import("../pages/Quips.svelte"),
  settings: () => import("../pages/Settings.svelte"),
  "view-as": () => import("../pages/ViewAs.svelte"),
};

// The pages loaded so far. Raw: a component is swapped whole, never changed inside.
let loaded = $state.raw<Record<string, Page>>({});
// Loads under way, so a page asked for twice is fetched once
const pending: Record<string, Promise<Page>> = {};

/** The page, if it's loaded; App shows it the moment it is. */
export const loadedPage = (name: string): Page | undefined => loaded[name];

export function loadPage(name: string): Promise<Page> {
  const ready = loaded[name];
  if (ready) return Promise.resolve(ready);
  let p = pending[name];
  if (!p) {
    p = pending[name] = LOADERS[name]().then(
      (m) => {
        // A new object, so App sees the change ($state.raw tracks the binding, not what's in it)
        loaded = { ...loaded, [name]: m.default };
        return m.default;
      },
      (e) => {
        // A dropped connection: let the next visit try again
        delete pending[name];
        throw e;
      },
    );
  }
  return p;
}

/** The rest, one at a time while the phone's idle, so the pages are there before you tap. */
export function preloadPages(names: string[]) {
  const queue = names.filter((n, i) => names.indexOf(n) === i && !loaded[n] && LOADERS[n]);
  const idle = (fn: () => void) =>
    "requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 200);
  const next = () => {
    const name = queue.shift();
    if (!name) return;
    loadPage(name).then(
      () => idle(next),
      () => idle(next),
    );
  };
  idle(next);
}
