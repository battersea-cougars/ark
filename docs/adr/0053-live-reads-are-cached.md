# 0053. Live reads are cached the same way everywhere, and Sanity is read through its API CDN

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-24
- **Merges:** 0041, 0054

## Context

Events, photos and videos are read live on the Worker ([0016](0016-photos-and-videos-read-live.md),
[0042](0042-website-reads-the-club-agenda.md)) so that a change shows without a rebuild and deploy. They were never
meant to be uncached. Each page view in `astro dev` is several queries (the club facts, the page's own, then photos,
videos and What's on again on page load). Uncached, a day of local work, screenshots and several sessions used up the
dev Sanity project's monthly API request quota (Sanity then answered every API read with `402 plan_limit_reached`)
and then YouTube's 10,000 units a day: the video playlists disappeared from the local site. Sanity's API CDN has its
own, larger quota and kept working.

Stale content after a change came from our own caches (the build memo, the Workers Cache API kept on disk under
`.wrangler`, `Cache-Control`), not from Sanity's CDN, which is refreshed within seconds of a publish.

`Cache-Control` alone doesn't help on the server: Cloudflare doesn't keep a Worker's own replies because of it; only
browsers do. Without a server cache every visitor reads Sanity or D1 again.

The team app reloads the whole club (`/api/bootstrap`) when it opens and when it comes back into view, against D1's
5M rows read a day. Most of those reloads find nothing new.

## Decision

- **Every Sanity read uses `apicdn.sanity.io`**: the build, `astro dev`, the dev Worker and production, all through
  one reader (`lib/server/sanity-live.ts` `sanityQuery`, plain fetch), which counts them ([0059](0059-usage-page-and-check.md)).
  Sanity Studio and scripts that write still use the API; they're few calls.
- **Local, the dev site and production cache the same way.** There is no switch to turn caching off.
- **Every live read on the website goes through `lib/server/cache.ts`**: in memory, then the Workers Cache API, with
  the last good copy kept for a failure:

  | Read                                 | Fresh for  | Last good copy kept |
  | ------------------------------------ | ---------- | ------------------- |
  | YouTube playlists                    | 10 minutes | a day               |
  | Sanity: videos                       | 1 minute   | an hour             |
  | Sanity: photos                       | 1 minute   | a day               |
  | D1: What's on, events, a player card | 1 minute   | an hour             |

- Live pages send the same `Cache-Control` everywhere (`no-store` only when their source is unreachable).
- Build-time content in `lib/sanity/content.ts` is read once per build, every five minutes on a Worker, and every
  minute in `astro dev`. The five club-fact singletons are one query.
- **The team app's bootstrap has an ETag**: the club's data version (`data_version`, one more on every change through
  the API, the club seed and the roster seed), the member, the day and the deploy. It's sent `private, no-store`, so the
  browser keeps no copy of members' details after signing out ([0036](0036-api-security.md)): opening the app reads
  the club whole. After that, the app's checks send `If-None-Match` themselves, with the tag it keeps in memory, and get
  an empty 304 after one row read when nothing has changed, at the data version the app's copy holds
  (`x-club-version`), since a live page moves that on by reading only the parts that changed
  ([0072](0072-live-updates.md)); a weak tag (`W/`, a proxy that compressed the reply) matches too.
- **What grows with the club's history isn't in the bootstrap**: past tournaments are read when they're opened, a page
  of History at a time ([0074](0074-tournament-home-and-scheduling.md), #175), each tagged the same way (the data
  version, the member, the day, the deploy, and what it is), so asking again unchanged is an empty 304; a team's logo is
  an address with its version in it, `private, max-age=31536000, immutable`.

## Consequences

- A page view costs Sanity, YouTube or D1 at most one read a minute per data centre, however many people look or how
  often anyone reloads, locally too. Local and dev pages count against Sanity's CDN quota, not the API one.
- A change takes up to a minute to show on the website (up to ten for a new YouTube upload, a little more where a
  browser holds the page; a Studio publish also takes a few seconds to reach the CDN). To see one sooner locally,
  restart `astro dev` and clear `.wrangler`.
- The caching production relies on runs on local and dev before release.
- If the CDN quota runs out too, reads fall back as for any Sanity failure: builds fail loudly, live pages show the
  last good copy or their empty state ([0055](0055-degrade-instead-of-break.md)).
- A change made to D1 directly (`wrangler d1 execute`, a script) must also bump `data_version`, or members' apps keep
  what they have until the next change, the next day or the next deploy. The seeds already do.
- After a change, the app reloads only the parts it touched ([0057](0057-team-app-loading-and-changes.md)).

## History

- 2026-10-07: Caches on in production only: one `CACHE_READS` switch; local and dev read Sanity's API uncached and
  sent `no-store`, after old content showed twice outside production (was 0041).
- 2026-10-07: Every Sanity read goes through its API CDN, after uncached local reads spent the dev project's API quota
  (was 0053).
- 2026-10-07: Live reads cached everywhere on the server through `cache.ts`, `CACHE_READS` removed, and the team app's
  bootstrap given an ETag, after uncached reads also spent YouTube's daily quota (was 0054).
- 2026-10-20: The build's content read through the same plain-fetch reader as the live reads (no `@sanity/client`), the
  club facts in one query instead of five, and every read counted (ADR 0059).
- 2026-10-21: The app's checks ask with the tag at the version its copy holds, not the browser's last reply, as live
  pages now read only the parts that changed (#112, ADR 0072); the reply says its version (`x-club-version`).
- 2026-10-24: The bootstrap is `private, no-store`, not `no-cache`: the browser's disk cache kept the club's data
  after signing out (#81). The app keeps the tag in memory, so its checks are still 304s; opening it reads the club.
- 2026-10-24: The bootstrap sends each series' next one and last one played, not every tournament; past ones, History's
  pages and the all-time leaders are read on demand with the same tag, logos by their own address (#175, ADR 0074).
