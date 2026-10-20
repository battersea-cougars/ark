// The way into Settings: one gear, top right, on a phone's You page and beside a desktop's badge (ADR 0022, ADR 0065).
// It shows for anyone whose account can set something up in any of their roles, their everyday one too: opening
// Settings switches them up to their full role on the way (ADR 0024), so nobody has to find that switch first.
import { can } from "../access/actions";
import { elevated, granted, hasEveryday, impersonating, realGranted, setElevated } from "../demo/session.svelte";
import type { Route } from "./nav-routes";
import { routes } from "./routes.svelte";

const settingsFor = (perms: ReturnType<typeof granted>): Route[] =>
  routes().filter((r) => r.group === "Settings" && can(perms, r.action));

/** The settings pages open to you now, in the list's order. */
export const settingsNow = (): Route[] => settingsFor(granted());

/** Whether the gear shows: your account can set something up (not while viewing as someone, read-only). */
export const canReachSettings = (): boolean => !impersonating() && settingsFor(realGranted()).length > 0;

/** On the way into Settings: up to your full role, if your everyday one can't see it. */
export function enterSettings(route?: Route) {
  if (!hasEveryday() || elevated()) return;
  const needed = route ? [route] : settingsFor(realGranted());
  if (needed.some((r) => !can(granted(), r.action) && can(realGranted(), r.action))) setElevated(true);
}
