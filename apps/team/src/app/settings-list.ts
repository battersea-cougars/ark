// What the Settings page lists (ADR 0065): every admin area your account can set up, grouped Club / Schedule / Security
// (the money pages are the club's). Listed by your account's roles, so the list doesn't change when you switch to your everyday role (ADR
// 0024): the rows that role can't open just go quiet, and opening one switches you up.
import { can, type Action } from "../access/actions";
import { SECTIONS, type Route, type Section } from "./nav-routes";

export interface SettingsRow {
  route: Route;
  /** Open to you as you're using the app now (your everyday role can't open every row). */
  open: boolean;
}

/** A page in Settings for whoever holds `granted` (with none given, any Settings page). */
export const isSetting = (r: Route, granted?: ReadonlySet<Action>): boolean =>
  r.group === "Settings" && (!granted || can(granted, r.action));

/** Settings' groups and rows: listed by what your account can do, open by what you can do now. */
export function settingsSections(
  routes: Route[],
  account: ReadonlySet<Action>,
  now: ReadonlySet<Action>,
): { section: Section; rows: SettingsRow[] }[] {
  return SECTIONS.map((section) => ({
    section,
    rows: routes
      .filter((r) => r.section === section && isSetting(r, account))
      .map((route) => ({ route, open: can(now, route.action) })),
  })).filter((s) => s.rows.length);
}
