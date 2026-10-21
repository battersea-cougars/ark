// Who's signed in, and who they're viewing the app as. Real sessions are ADR 0023; impersonation is
// ADR 0024: an admin sees exactly what a member sees, read-only. An everyday role is ADR 0024: someone with more than
// Member can run the app as a lesser role, and switch up to their full role until they switch back or close the app.
import type { Action } from "../access/actions";
import { EVERYDAY_ROLE, PLAYERS, REAL_ID, type Player } from "./data";
import { db } from "./store.svelte";

const KEY = "team.demo.viewAs";

function readAs(): number | null {
  try {
    const id = Number(localStorage.getItem(KEY));
    return PLAYERS.some((p) => p.id === id) && id !== REAL_ID ? id : null;
  } catch {
    return null;
  }
}

// Switched up to your full role: this tab only, so the app always opens in your everyday role
const ELEVATED = "team.fullRole";
function readElevated(): boolean {
  try {
    return sessionStorage.getItem(ELEVATED) === "1";
  } catch {
    return false;
  }
}

export const session = $state({ as: null as number | null, everyday: null as number | null, elevated: readElevated() });

/** Once the club's data is in (app/backend.svelte.ts start): who you're viewing as, and your everyday role. */
export function startSession() {
  session.as = readAs();
  session.everyday = EVERYDAY_ROLE;
}

const player = (id: number): Player => PLAYERS.find((p) => p.id === id)!;

/** Who you are. */
export const realMember = (): Player => player(REAL_ID);
/** Who the app is showing: you, or the member you're viewing as. */
export const me = (): Player => player(session.as ?? REAL_ID);
export const impersonating = (): boolean => session.as !== null;

export const rolesOf = (id: number): string[] => db.members.find((m) => m.player.id === id)?.roles ?? [];

function actionsOf(id: number): ReadonlySet<Action> {
  const actions = rolesOf(id).flatMap((name) => db.roles.find((r) => r.name === name)?.actions ?? []);
  return new Set(actions);
}

/** Your everyday role, while you're in it (not switched up, not viewing as someone): its name. */
const everydayRole = () =>
  session.everyday !== null && !session.elevated && !impersonating()
    ? db.roles.find((r) => r.id === session.everyday)
    : undefined;

/** Whether you have an everyday role, so the app offers to switch to your full one and back. */
export const hasEveryday = (): boolean =>
  session.everyday !== null && db.roles.some((r) => r.id === session.everyday) && !impersonating();
/** Switched up to your full role. */
export const elevated = (): boolean => hasEveryday() && session.elevated;
/** Your everyday role's name (Contributor). */
export const everydayName = (): string => db.roles.find((r) => r.id === session.everyday)?.name ?? "Member";
/** Your full role's name (Admin): what the switch is labelled. */
export const fullRole = (): string => rolesOf(REAL_ID)[0] ?? "Member";

/** The roles to show for someone: for you in your everyday role, that role (and Member), not your full one. */
export function shownRoles(id: number): string[] {
  const role = id === REAL_ID ? everydayRole() : undefined;
  if (!role) return rolesOf(id);
  return role.name === "Member" ? ["Member"] : [role.name, "Member"];
}

/** What the app lets the shown member do. While viewing as someone, that's their actions, not yours; in your everyday
 * role, that role's and Member's. */
export const granted = (): ReadonlySet<Action> => {
  const role = everydayRole();
  return role ? everydayActions(role.actions) : actionsOf(me().id);
};

function everydayActions(roleActions: readonly Action[]): ReadonlySet<Action> {
  const actions = [...roleActions, ...(db.roles.find((r) => r.name === "Member")?.actions ?? [])];
  return new Set(actions);
}

/** Switch up to your full role, or back to your everyday one. */
export function setElevated(on: boolean) {
  session.elevated = on;
  try {
    if (on) sessionStorage.setItem(ELEVATED, "1");
    else sessionStorage.removeItem(ELEVATED);
  } catch {
    // Private mode: lasts until reload.
  }
}
/** What you can do yourself: decides whether "View as" is offered at all. */
export const realGranted = (): ReadonlySet<Action> => actionsOf(REAL_ID);

export function viewAs(id: number | null) {
  session.as = id === REAL_ID ? null : id;
  try {
    if (session.as === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(session.as));
  } catch {
    // Private mode: lasts until reload.
  }
}
