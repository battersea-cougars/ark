// Content access for pages. Everything is fetched at build time; the site
// rebuilds daily and on each release (ADR 0004). Until a Sanity project is configured, pages
// render from the fallback club facts (fallback.ts) and empty lists. The merge
// rules are in merge.ts.
import { DEMO_CONTENT } from "astro:env/server";
import { onWorker, sanity } from "./client";
import * as q from "./queries";
import { FALLBACK_CLUB, FALLBACK_FRIDAYS, FALLBACK_KUMITE, FALLBACK_PUB, FALLBACK_TEAM } from "./fallback";
import { liveVideos } from "../server/videos";
import { videosConfig } from "../server/sanity-env";
import { DEMO_EVENTS, DEMO_PLAYERS } from "./demo";
import { sanityError } from "../server/sanity-live";
import { guard } from "@cougars/shared/breaker";
import { toPlayer, type RosterRow } from "../roster";
import { crestFiles, editionsFrom, type ResultRows } from "../results";
import { listOr, mergeClub, mergeFridays, mergeKumite, mergePub, mergeTeam } from "./merge";
import type { ClubEvent, Player, SiteSettings, Sponsor, Award } from "./types";
import { scribe } from "@cougars/shared/scribe";
import { checkLinks } from "../links";

const log = scribe.logger("content");

// Sample content for dev builds: `DEMO_CONTENT=true npm run dev`, PR previews and
// scripts/deploy-dev.sh. Real Sanity content still wins wherever it exists. Never set for
// production. Pages built with it are noindex.
export const demo = DEMO_CONTENT;

/** In `astro dev`: why Sanity couldn't be read on the last try, or "". The layout shows it in a banner. */
export const devSanity = { problem: "" };

async function fetchOr<T>(query: string, fallback: T): Promise<T> {
  const client = sanity();
  if (!client) return fallback;
  try {
    // Behind the same circuit breaker as the live reads (ADR 0055): a spent quota stops every Sanity call
    const result = await guard("sanity", () =>
      client.fetch<T | null>(query).catch((e: { statusCode?: number }) => {
        throw e?.statusCode ? sanityError(e.statusCode) : e;
      }),
    );
    if (import.meta.env.DEV) devSanity.problem = "";
    // Every link an editor typed is checked here, once, for every page (lib/links.ts)
    return result === null ? fallback : checkLinks(result);
  } catch (error) {
    // A build fails loudly. A server route (ADR 0016), and a page in `astro dev`, render with the fallback rather
    // than an error page (ADR 0055): degraded, not broken.
    if (!onWorker && !import.meta.env.DEV) throw error;
    if (import.meta.env.DEV) devSanity.problem = String(error);
    log.error("content.sanity_error", error);
    return fallback;
  }
}

/** A Sanity list, or (with demo content on) the demo list when Sanity has none. */
const fetchList = async <T>(query: string, demoList: T[] | null = null) =>
  listOr(await fetchOr<T[] | null>(query, null), demo ? demoList : null);

// Once per build. A Worker isolate lives on between requests, so it re-reads every five minutes; `astro dev` every
// minute, so a Studio change shows soon without a query per page load (ADR 0053).
const memo = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  let at = 0;
  const reuse = () => (import.meta.env.DEV ? Date.now() - at < 60_000 : !onWorker || Date.now() - at < 5 * 60_000);
  return () => {
    if (!p || !reuse()) [p, at] = [fn(), Date.now()];
    return p;
  };
};

// Club facts, one Sanity singleton each, merged field by field with their fallbacks.
export const getClub = memo(async () => mergeClub(FALLBACK_CLUB, await fetchOr(q.CLUB, null)));
export const getFridays = memo(async () => mergeFridays(FALLBACK_FRIDAYS, await fetchOr(q.FRIDAYS, null)));
export const getPub = memo(async () => mergePub(FALLBACK_PUB, await fetchOr(q.PUB, null)));
export const getTeam = memo(async () => mergeTeam(FALLBACK_TEAM, await fetchOr(q.TEAM, null)));
// The Kumite's awards come from the team app (ADR 0044), through the build's club snapshot; Sanity's list (names
// only) until the snapshot has them.
/** The next Kumite as the team app has it (ADR 0042): when, where, or that it's TBC or only a season so far. */
export interface NextKumite {
  startsAt: string;
  venue: string;
  dateTbc: boolean;
  season: string | null;
}
const kumiteSnapshot = import.meta.glob<{ awards: Award[]; next?: NextKumite | null } | null>(
  "../../data/kumite.local.json",
  { eager: true, import: "default" },
);
export const getKumite = memo(async () => {
  const k = mergeKumite(FALLBACK_KUMITE, await fetchOr(q.KUMITE, null));
  const snapshot = Object.values(kumiteSnapshot)[0];
  const fromApp = snapshot?.awards;
  return {
    ...k,
    awards: fromApp?.length ? fromApp : k.awards.map((name): Award => ({ name })),
    next: snapshot?.next ?? null,
  };
});

/** Every club fact in one object. */
export const getSettings = memo(async (): Promise<SiteSettings> => {
  // All at once: in `astro dev` each is a fresh read, so one after another adds up
  const [club, fridays, pub, team, kumite] = await Promise.all([
    getClub(),
    getFridays(),
    getPub(),
    getTeam(),
    getKumite(),
  ]);
  return { ...club, ...fridays, pub, team, kumite };
});

// The club's videos as of this build: only the homepage's no-JavaScript fallback uses these. /videos and the
// homepage reel read them live (lib/server/videos.ts, docs/adr/0016-photos-and-videos-read-live.md).
export const getVideos = memo(async () => (await liveVideos(videosConfig())).data);
export const getEvents = memo(() => fetchList<ClubEvent>(q.EVENTS, DEMO_EVENTS));
export const getEventPages = memo(() => fetchList<ClubEvent>(q.EVENT_PAGES, DEMO_EVENTS));
// The roster: the active Cougars as of this build (lib/roster.ts, scripts/club-snapshot.mjs). Without a snapshot
// (a fresh checkout, a database that couldn't be read), Sanity's players or the samples.
const snapshot = import.meta.glob<RosterRow[] | null>("../../data/roster.local.json", {
  eager: true,
  import: "default",
});
export const getPlayers = memo(async () => {
  const roster = Object.values(snapshot)[0];
  return roster ? roster.map(toPlayer) : fetchList<Player>(q.PLAYERS, DEMO_PLAYERS);
});
export const getSponsors = memo(() => fetchList<Sponsor>(q.SPONSORS));
// Tournament results as of this build (lib/results.ts, ADR 0100): none without a snapshot. The team app starts a
// rebuild when a result changes.
const resultsSnapshot = import.meta.glob<ResultRows | null>("../../data/results.local.json", {
  eager: true,
  import: "default",
});
const resultRows = () => Object.values(resultsSnapshot)[0] ?? null;
export const getResults = memo(async () => editionsFrom(resultRows()));
export const getCrestFiles = memo(async () => crestFiles(resultRows()));

/**
 * Which parts of the website are on (ADR 0109): the team and the Kumite as switched in the Studio, and the results
 * while the Kumite is on or there are results to show.
 */
export const getSections = memo(async () => {
  const [{ team, kumite }, results] = await Promise.all([getSettings(), getResults()]);
  return { team: team.onWebsite, kumite: kumite.onWebsite, results: kumite.onWebsite || results.length > 0 };
});

/** Events that haven't finished yet, soonest first. */
export function upcoming(events: ClubEvent[], now = new Date()): ClubEvent[] {
  return events.filter((e) => new Date(e.endsAt ?? e.startsAt) >= now);
}

/** The kit rules, then what's lent to first-timers (if anything): the "Kit" / "Bring" line on several pages. */
export const kitText = (s: Pick<SiteSettings, "kitNotes" | "firstSessionKit">) =>
  [s.kitNotes, s.firstSessionKit].filter(Boolean).join(" ");
