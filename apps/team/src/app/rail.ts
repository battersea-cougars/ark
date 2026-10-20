// The desktop rail (the dock, mid-left): member pages only. Home, a tile per training, Calendar, a tile per tournament
// type, then the club's pages (Teammates). What only some can do (Members, Unpaid fees, Announcements, Upload) is in
// Settings, the gear; your own things (Dues) are on your You page, the avatar top right.
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
  const calendar = routes.find((r) => r.tab === "calendar" && allowed(r));
  return [
    ...(home ? [item(home)] : []),
    ...routes.filter((r) => r.tab === "training" && allowed(r)).map(item),
    ...(calendar ? [item(calendar)] : []),
    ...folds.flatMap((f) => {
      const first = routes.find((r) => r.fold === f.id && allowed(r));
      return first ? [{ id: f.id, name: f.name, icon: f.icon, href: first.path }] : [];
    }),
    ...routes.filter((r) => r.group === "Club" && allowed(r)).map(item),
  ];
}

/** Whether a rail item is lit on this page: its section's, or its own pages' (a member's page is Teammates). */
export function railOn(item: RailItem, route: Route): boolean {
  if (item.id === "home") return route.id === "home";
  if (item.id === "calendar") return route.tab === "calendar";
  if (item.id.startsWith("training:"))
    return route.tab === "training" && item.id === `training:${route.params?.seriesId}`;
  if (item.id.startsWith("type:")) return route.fold === item.id;
  return route.id === item.id || route.path.startsWith(item.href + "/");
}
