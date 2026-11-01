// Every edition of a series has its own page, at its own address (ADR 0074): /tournaments/kumite/12, its statuses under
// it (/tournaments/kumite/12/draft). "This page is the layout for that specific kumite — the url should reflect that"
// (the user, 2026-10-23). The series' own address is its front door: with one on, it opens that one's address; with
// nothing on, it's the series' page (No Kumite yet, the past ones).
import type { Tournament } from "../demo/model";
import { STATUS_PATH, statusOf, type Status } from "./tournament-front";

const series = (slug: string) => `/tournaments/${slug}`;

/** An edition's page, or one of its statuses on it. */
export const editionPath = (slug: string, id: number, status?: Status) =>
  `${series(slug)}/${id}${status ? `/${STATUS_PATH[status]}` : ""}`;

/** The track's link to a status: the edition's page itself for the one it's at, else the status's own address. */
export const statusHref = (slug: string, t: Tournament, today: string, s: Status) =>
  editionPath(slug, t.id, s === statusOf(t, today) ? undefined : s);

/** What's after a page's own address (`/teams` → "teams"), or "" when it's the page itself or another one. */
export function editionRest(path: string, base: string) {
  return path.startsWith(base + "/") ? path.slice(base.length + 1) : "";
}

// The front door's old status addresses (pushes, Home's cards, emails), and the board's older one
const FRONT_DOOR_STATUSES = new Set(["", ...Object.values(STATUS_PATH), "standings"]);

/**
 * Where the series' address goes (`current`: the one on, if any): the front door or one of its old status addresses
 * opens the one on, at the same status; an edition that's gone goes back to the front door. Null: stay where it is
 * (the series' other pages, an edition's own address, the front door with nothing on).
 */
export function frontDoorTo(path: string, slug: string, current: number | undefined, editions: number[]) {
  const base = series(slug);
  if (path !== base && !path.startsWith(base + "/")) return null;
  const rest = path.slice(base.length + 1);
  const id = /^(\d+)(?:\/|$)/.exec(rest)?.[1];
  if (id) return editions.includes(Number(id)) ? null : base;
  if (current === undefined || !FRONT_DOOR_STATUSES.has(rest)) return null;
  return rest ? `${base}/${current}/${rest}` : `${base}/${current}`;
}

/** History's old address for a past one (`/tournaments/kumite/history/5`): its own page now, or null. */
export function historyMovedTo(path: string): string | null {
  const hit = /^(\/tournaments\/[^/]+)\/history\/(\d+)(\/.*)?$/.exec(path);
  return hit ? `${hit[1]}/${hit[2]}` : null;
}
