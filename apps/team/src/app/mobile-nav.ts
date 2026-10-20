// Phone tabs, derived from the route tree. Each tab remembers the last page used in it.
import { can, type Action } from "../access/actions";
import { routeFor, type Route, type TabId } from "./nav-routes";

/** The routes a member can see in a tab, in tree order. Full-screen and hidden pages are reached from a page. */
export const tabRoutes = (routes: Route[], tab: TabId, granted: ReadonlySet<Action>): Route[] =>
  routes.filter((r) => r.tab === tab && !r.focus && !r.hidden && can(granted, r.action));

/**
 * The pages in the strip along the top of a phone screen: the current tab's, and within a tournament type only
 * that type's. Shown only when there's more than one. The More tab uses its own page.
 */
export function stripRoutes(routes: Route[], current: Route, granted: ReadonlySet<Action>): Route[] {
  if (current.tab === "more") return [];
  const list = tabRoutes(routes, current.tab, granted).filter((r) => !current.fold || r.fold === current.fold);
  return list.length > 1 ? list : [];
}

/**
 * Where a tab goes: the last page used in it, if the member can still see it, else its first page. Profile always
 * opens your profile: the page you asked for, not the settings page you last left.
 */
export function tabHref(
  routes: Route[],
  tab: TabId,
  granted: ReadonlySet<Action>,
  last: Partial<Record<TabId, string>>,
): string {
  const list = tabRoutes(routes, tab, granted);
  const remembered = tab === "more" ? undefined : last[tab];
  if (remembered && list.some((r) => r.path === remembered)) return remembered;
  return list[0]?.path ?? "/";
}

/**
 * Where a phone's Back goes (#86), or null for a tab's own pages (Home, Friday, Calendar, the Kumite's pages, You),
 * which have the tabs instead. Every other page (a team, a matchup, Dues, Unpaid fees, a settings page) goes back
 * to the page it was opened from in the app, by the browser's history: Home → Unpaid fees → Back is Home. Opened
 * from outside or after a reload, to the page it belongs under: a settings page to Settings, the rest of the You tab
 * to You, a hidden page to the one it's `under`, else its tab's first page.
 */
export function backFor(routes: Route[], route: Route, from: string | null): { to: Route; history: boolean } | null {
  if (route.focus) return null;
  const ownTabPage = !route.hidden && (route.tab !== "more" || route.id === "profile");
  if (ownTabPage) return null;
  const came = from ? routeFor(routes, from) : undefined;
  if (came && came.id !== route.id) return { to: came, history: true };
  const byId = (id?: string) => (id ? routes.find((r) => r.id === id) : undefined);
  const parent =
    byId(route.under) ??
    (route.group === "Settings" ? byId("settings") : undefined) ??
    (route.tab === "more" ? byId("profile") : undefined) ??
    routes.find((r) => r.tab === route.tab && !r.hidden);
  return parent && parent.id !== route.id ? { to: parent, history: false } : null;
}
