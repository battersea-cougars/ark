// The way into Settings: one gear, top right in a phone's You page bar and at the foot of a desktop's dock (ADR 0022,
// ADR 0065). It shows for anyone whose account can set something up in any of their roles, their everyday one too:
// opening Settings switches them up to their full role on the way (ADR 0024), so nobody has to find that switch first.
import { can, type Action, type Requirement } from "../access/actions";
import { elevated, granted, hasEveryday, impersonating, realGranted, setElevated } from "../demo/session.svelte";
import { switchView } from "./motion";
import type { Route } from "./nav-routes";
import { routes, stayIfAllowed } from "./routes.svelte";
import { settingsSections, type SettingsRow } from "./settings-list";

/** Settings' groups and rows: your account's (the member's while viewing as them), open or not in your role now. */
export const settingsNow = () => settingsSections(routes(), impersonating() ? granted() : realGranted(), granted());

/** Whether the gear shows: your account can set something up (not while viewing as someone, read-only). */
export const canReachSettings = (): boolean => !impersonating() && settingsNow().length > 0;

/** Your everyday role can't do this, your full one can. */
const needsFullRole = (action: Requirement) => !can(granted(), action) && can(realGranted(), action);

/** On the way into Settings (the gear) or a settings page (a link, a reload): up to your full role, if your everyday
 * one can't open it. */
export function enterSettings(route?: Route) {
  if (!hasEveryday() || elevated()) return;
  const shut = route ? needsFullRole(route.action) : settingsNow().some((s) => s.rows.some((r) => !r.open));
  if (shut) setElevated(true);
}

/** A quiet row in Settings (your everyday role can't open it): opening it switches you up. */
export function openSetting(row: SettingsRow) {
  if (!row.open) setElevated(true);
}

/** Before a job your everyday role can't do (the Calendar's New event): up to your full role, as the gear does. The
 * role switch (lib/RoleSwitch) shows it. */
export function switchUpFor(action: Action) {
  if (hasEveryday() && !elevated() && needsFullRole(action)) setElevated(true);
}

/** The everyday-role switch (lib/RoleSwitch): up to your full role, or back to your everyday one, staying on this
 * page if it can (else Home). */
export function useFullRole(up: boolean) {
  if (up === elevated()) return;
  switchView(() => {
    setElevated(up);
    if (!up) stayIfAllowed();
  });
}
