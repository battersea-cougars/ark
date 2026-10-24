// Tournaments read when they're opened (#175, ADR 0074). Opening the app brings each series' next one and its last
// one played (the club's TOURNAMENTS); a past one's page, or a link to one of its games or teams, reads that one in
// full (worker/tournaments/editions.routes.ts) and keeps it here, so going back to it is instant. The store's
// tournaments are the club's with these after them. After any change to the club's tournaments, the ones kept are
// asked about again when next shown, with their tags: unchanged, that's an empty 304.
import { TOURNAMENTS } from "../demo/data";
import type { Tournament } from "../demo/model";
import { db } from "../demo/store.svelte";
import { ApiError, readTagged } from "./api";

/** How a page names the one it wants: by itself, by one of its games, or by one of its teams. */
export type EditionBy = "tournament" | "game" | "team";
const PATHS: Record<EditionBy, (n: number) => string> = {
  tournament: (n) => `/api/tournaments/${n}`,
  game: (n) => `/api/tournament-games/${n}/tournament`,
  team: (n) => `/api/tournament-teams/${n}/tournament`,
};

/** One wanted that isn't here yet, for the routes (app/routes.svelte.ts) and the pages' loading state. */
export interface Asked {
  slug: string;
  by: EditionBy;
  n: number;
}

/** What's on its way, what isn't there (a 404: gone, or never was), and a beat for each change to the kept ones. */
export const editions = $state({ asking: [] as Asked[], gone: [] as Asked[], round: 0 });

const kept = new Map<number, { tournament: Tournament; tag: string | null; fresh: boolean }>();
const inFlight = new Set<string>();
const keyOf = (a: Asked) => `${a.by}:${a.n}`;
const same = (a: Asked) => (b: Asked) => a.by === b.by && a.n === b.n;

/** The club's tournaments in the store, the ones read on demand after them (the club's own wins: it's newer). */
export function showTournaments() {
  const club = structuredClone(TOURNAMENTS);
  const ids = new Set(club.map((t) => t.id));
  db.tournaments = [...club, ...[...kept.values()].filter((k) => !ids.has(k.tournament.id)).map((k) => k.tournament)];
}

/** Something changed the club's tournaments: each kept one is asked about again when it's next shown. */
export function keptAreStale() {
  if (!kept.size) return;
  for (const k of kept.values()) k.fresh = false;
  editions.round++;
}

/** A tournament deleted: no longer kept. */
export function forgetEdition(id: number) {
  kept.delete(id);
}

const has = (a: Asked): Tournament | undefined =>
  db.tournaments.find((t) =>
    a.by === "tournament"
      ? t.id === a.n
      : a.by === "game"
        ? t.games?.some((g) => g.id === a.n)
        : t.teams.some((x) => x.id === a.n),
  );

/** Whether this one is on its way and not here yet: its page shows that it's loading, at the size it will be. */
export const waitingFor = (by: EditionBy, n: number) => editions.asking.some((x) => x.by === by && x.n === n);

/**
 * A page wants this one: read it unless it's here and up to date (one of the club's, or kept and nothing's changed).
 * Kept but changed since, it's shown as it was while it's asked about again.
 */
export function wantEdition(a: Asked) {
  const here = has(a);
  const held = here && kept.get(here.id);
  if (here && (!held || held.fresh)) return;
  if (editions.gone.some(same(a)) || inFlight.has(keyOf(a))) return;
  if (!here) editions.asking.push(a);
  void read(a, held || null);
}

async function read(a: Asked, held: { tournament: Tournament; tag: string | null } | null) {
  inFlight.add(keyOf(a));
  try {
    const { data, tag } = await readTagged<{ tournament: Tournament }>(PATHS[a.by](a.n), held?.tag ?? null);
    const tournament = data?.tournament ?? held!.tournament;
    kept.set(tournament.id, { tournament, tag, fresh: true });
    showTournaments();
  } catch (e) {
    // Not there: its address goes back to the series' front door. Anything else (offline, resting), asked next time
    if (e instanceof ApiError && e.status === 404) editions.gone.push(a);
  } finally {
    inFlight.delete(keyOf(a));
    editions.asking = editions.asking.filter((x) => !same(a)(x));
  }
}

/** What an address names, on a series' pages: one of its editions, or a game's or a team's page. */
export function askedBy(path: string): Asked | null {
  const hit = /^\/tournaments\/([^/]+)\/(?:(\d+)|games\/(\d+)|teams\/(\d+))(?:\/|$)/.exec(path);
  if (!hit) return null;
  const [, slug, t, g, k] = hit;
  if (t) return { slug, by: "tournament", n: Number(t) };
  return g ? { slug, by: "game", n: Number(g) } : { slug, by: "team", n: Number(k) };
}

/** This one in full, read if the app hasn't it (an admin opening a past one's editor from Settings). */
export async function loadEdition(id: number): Promise<boolean> {
  const a: Asked = { slug: "", by: "tournament", n: id };
  if (!has(a)) await read(a, null);
  return !!has(a);
}
