// The desktop rail (the dock, mid-left): member pages, Home, a tile per training, a tile per tournament type, Calendar,
// then the club. At its foot, set apart, the Settings gear for whoever can set something up (what only some can do:
// Members, Unpaid fees, Quips, Upload); your own things (Dues) are on your You page, the avatar top right.
import { can, type Action } from "../access/actions";
import type { IconName } from "./shell/icons";
import type { Fold, Route } from "./nav-routes";

export interface RailItem {
  id: string;
  name: string;
  icon: IconName;
  href: string;
}

export function railItems(routes: Route[], folds: Fold[], granted: ReadonlySet<Action>): RailItem[] {
  const allowed = (r: Route) => !r.focus && !r.hidden && can(granted, r.action);
  const item = (r: Route): RailItem => ({ id: r.id, name: r.name, icon: r.icon, href: r.path });
  const home = routes.find((r) => r.id === "home");
  // Hidden on a phone (opened from Home), a tile here
  const calendar = routes.find((r) => r.id === "calendar" && can(granted, r.action));
  return [
    ...(home ? [item(home)] : []),
    ...routes.filter((r) => r.tab === "training" && allowed(r)).map(item),
    ...folds.flatMap((f) => {
      const first = routes.find((r) => r.fold === f.id && allowed(r));
      return first ? [{ id: f.id, name: f.name, icon: f.icon, href: first.path }] : [];
    }),
    ...(calendar ? [item(calendar)] : []),
    ...routes.filter((r) => r.group === "Club" && allowed(r)).map(item),
  ];
}

/** The rail's foot: the Settings gear, for whoever can set something up (`reach`: app/settings-entry). */
export function railFoot(routes: Route[], reach: boolean): RailItem[] {
  const settings = routes.find((r) => r.id === "settings");
  return reach && settings ? [{ id: "settings", name: "Settings", icon: "settings", href: settings.path }] : [];
}

/** Whether a rail item is lit on this page: its section's, or its own pages' (a member's page is the club's). */
export function railOn(item: RailItem, route: Route): boolean {
  // Home's own pages too (past announcements), not the Calendar, which has its tile
  if (item.id === "home") return route.tab === "home" && route.id !== "calendar";
  if (item.id === "calendar") return route.id === "calendar";
  if (item.id === "settings") return route.id === "settings" || (route.group === "Settings" && !route.focus);
  if (item.id.startsWith("training:"))
    return route.tab === "training" && item.id === `training:${route.params?.seriesId}`;
  if (item.id.startsWith("type:")) return route.fold === item.id;
  return route.id === item.id || route.path.startsWith(item.href + "/");
}
