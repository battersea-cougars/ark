# 0053. Live reads are cached the same way everywhere, and Sanity is read through its API CDN

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-25
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

The team app reloaded the whole club (`/api/bootstrap`) when it opened and when it came back into view, against D1's
5M rows read a day. Most of those reloads found nothing new, and the whole club grew with every member and every
week of history, though Home shows only what's next.

## Decision

- **Every Sanity read uses `apicdn.sanity.io`**: the build, `astro dev`, the dev Worker and production, all through
  one reader (`lib/server/sanity-live.ts` `sanityQuery`, plain fetch), which counts them ([0059](0059-usage-page-and-check.md)).
  Sanity Studio and scripts that write still use the API; they're few calls.
- **Local, the dev site and production cache the same way.** There is no switch to turn caching off.
- **Every live read on the website goes through `lib/server/cache.ts`**: in memory, then the Workers Cache API, with
  the last good copy kept for a failure:

  | Read                                           | Fresh for  | Last good copy kept |
  | ---------------------------------------------- | ---------- | ------------------- |
  | YouTube playlists                              | 10 minutes | a day               |
  | Sanity: videos                                 | 1 minute   | an hour             |
  | Sanity: photos                                 | 1 minute   | a day               |
  | D1: What's on, events, a player card           | 1 minute   | an hour             |
  | D1: when photos and videos were last refreshed | 30 seconds | a day               |

  An admin's Refresh photos and videos (team app, Settings → Website, #109) makes YouTube's and Instagram's copies from
  before it not fresh (`freshAfter`), without changing their keys, so the last good copy is still there for a failure
  ([0016](0016-photos-and-videos-read-live.md)).

- Live pages send the same `Cache-Control` everywhere (`no-store` only when their source is unreachable).
- Build-time content in `lib/sanity/content.ts` is read once per build, every five minutes on a Worker, and every
  minute in `astro dev`. The five club-fact singletons are one query.
- **Opening the app reads the core; each page reads its own parts when it's opened** (#178). The bootstrap sends
  who you are and what you may do (viewing as included), the club's settings and menus (series, tournament types,
  venues, roles, fees, quips) and what Home needs: the nights from tonight with their sign-ups and teams, the
  tournaments not played yet and those played in the last fortnight (by their day or when a match kicked off, so one
  played early or late is there, as past), the events to come, the agenda from London's evening (and the day of a
  tournament whose day went by unplayed: it's still next, [0074](0074-tournament-home-and-scheduling.md)), the announcements, your
  own charges and dues line, and Home's people (you in full; who you really are while viewing as someone; whoever is
  in those next things, their names and cards, nothing private). For admins also says what the club is owed in all
  and who's asking to join. It doesn't grow with the roster or the history (17 KB on a club of 120 with a year of
  Fridays, was 72–78 KB). A page that shows more asks for its parts in one request (`GET /api/slices?names=…`,
  `app/page-data.svelte.ts`): the roster (`members`), the weeks just held (`pastSessions`), each series' last one
  played (`lastPlayed`), everyone's dues and reminders (`clubDues`, `reminders`). A page waits for its parts, as for
  its code; a deep link has both before the app mounts. Put together with the core (`app/club-whole.ts`) they're what
  the bootstrap used to send, byte for byte.
- **Each part has its own version** (`data_version.parts`): a change through the app sets it for the families its
  route declared (`src/app/club-parts.ts`: `members` is Home's people and the roster, `sessions` the next nights and
  the weeks just held...); anything else that moves the version on (a script, the hourly run, the day's first open,
  which makes the day's sessions) makes every part new (`untold`, by trigger). A page's read is tagged by its parts'
  versions, the member and the day: asked again with its tag while they're unchanged, it's an empty 304, whatever else
  changed. A tap on Friday doesn't make the roster or last year's Kumite new. A training answer names only `tonight`
  (the nights from tonight: a night already held takes no answers, its register closed at 06:00 the morning after),
  and Home's `people` only when it was someone's first answer; the register and an admin updating attendance still
  name `sessions`, the weeks just held with them. A tag names London's evening as well as the day: at 06:00 the night
  just held moves from the core's nights to the weeks just held with nothing changed. Everyone's dues and the club's
  total owed change only for who sees them: a payment or a tap doesn't read them again for anyone else.
- **What's the same for everyone who sees the club alike is kept at the edge** (`worker/api/api.edge.ts`): the roster
  as all of a role see it, a night's sign-ups and teams, a Kumite's teams, games and awards. Read from D1 once, kept in
  the isolate's memory and Cloudflare's Cache API, keyed by the deploy, the parts, their versions and what the viewer
  may see (their flags and the day, never who they are), so a change is a new key and nothing is ever stale. Each
  member's own rows (their answers in full, the vote they cast) are read from D1 every time and put in place
  (`api.club.ts` OVERLAYS). What's someone's own or depends on the moment is never kept (`OWN`: Home's people, your
  dues and charges, the agenda, events, announcements, notifications); a use case fails if a part that reads who's
  asking isn't in it. The Cache API only works on a custom domain: on dev (`*.workers.dev`) only the isolate's memory
  keeps them. On Workers Free an edge hit still counts as a request; it saves D1's rows and the Worker's time.
- **In the browser, in memory only**: the core and the pages' parts stay while the app is open, never on disk (#81).
  A change says which pages' parts the phone holds (`x-club-holds`) and gets those back too. The live copy
  ([0072](0072-live-updates.md)) reads, of each family the hub names, the parts the phone holds; a page's part that
  changes while no page in view shows it is let go and asked about again, with its tag, when a page that shows it
  opens. When the core is read again and the club has changed, the parts held are asked about with their tags.
- **Prefetch**: once the app's up and the phone is idle, the rest is read in one request: the roster, the weeks just
  held, each series' last one played, and for whoever sees them everyone's dues and reminders. Not when the phone asks
  to save data. So the pages you're likely to open next (a Kumite, Friday, the calendar, Members) open at once.
- **Offline at the rink**: Home, your next night (its sign-ups and teams) and the Kumite that's on are in the core, so
  an app open at the rink has them, and the roster for names once the prefetch has run (opening the app at home on
  wifi is enough). Nothing is kept for a cold open with no signal: keeping the club on disk would keep members'
  details on the phone after signing out, which #81 took away. The app shell still opens offline (#115) and says it
  can't reach the club.
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
  an address with its version in it, `private, max-age=31536000, immutable`, unless it's small (2 KB or less, a
  generated crest), when it comes as itself, so a page of twenty isn't twenty requests. The same for dues (#177,
  [0007](0007-dues-and-payments.md)): your unpaid charges and a line per member of what they owe, a ledger a page at a
  time; and for what looked through every edition the app held: a matchup's past meetings, the editor's "Brings" and
  Venues' "used by" are each a small read. Each member's "played" is counted once, as each night's register closes
  (`members.played`, up to `data_version.played_through`, by the day's first open and the hourly run), plus the night
  or two since, so no open counts every night ever played.

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
- Opening the app, and every live read of the core, no longer grows with the roster or the history; a page's first
  open is one request, and with the prefetch none at all.
- A route that declares too little of what it changed now leaves that part stale until its next declared change, the
  next day or the next deploy, for every phone and the edge, not just until the next whole read (#178): the parts'
  versions are only as good as the declarations ([0057](0057-team-app-loading-and-changes.md)).
- A tap costs what it did before the split, its reply smaller (3.7 KB, was 6.4 KB): it names tonight's nights alone,
  Home's people only for a first answer (docs/load-testing.md). A route that could change a held night must still name
  `sessions`.
- D1 allows five terms in a compound SELECT and the tests' SQLite doesn't hold the club read to it, so a use case does.
- A page that reads more of the club is a line in `page-data.svelte.ts` NEEDS; a new page's part is a family in
  `club-parts.ts`, a slice in `api.slices.ts` and its merge in `club-whole.ts`.

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
- 2026-10-24: A cached value can be made not fresh by a time (`freshAfter`): Refresh photos and videos in the team app
  (#109, ADR 0016). The time is a D1 read cached for 30 seconds.
- 2026-10-24: Nor every charge and payment, nor every night's attendance counted again (#177): your unpaid charges and
  each member's line of what they owe, a ledger a page at a time, "played" stored as registers close; the matchup's
  meetings, the editor's Brings and Venues' used by read from the server; a logo of 2 KB or less sent as itself (was:
  always an address, so History's twenty generated crests were twenty queued requests).
- 2026-10-24: Opening the app reads the core; each page reads its own parts when it's opened, the rest while idle
  (#178). Was: the whole club on every open. Each part has its own version, so a page's read is a 304 while its parts
  are unchanged; what's the same for everyone of a role is kept at the edge by those versions; nothing is kept on disk,
  so offline at the rink is what the open app holds (Home, your next night, the Kumite on, the roster once prefetched).
- 2026-10-25: A training answer names `tonight` (the nights from tonight), not `sessions`: a night already held takes no
  answers. Home's people come with a tap only when it was someone's first answer; the club's total owed and everyone's
  dues only for who sees them; tags name London's evening too, as the night just held moves into the weeks just held at
  06:00 (#178). A tap is back on a par with main (its reply 3.7 KB, was 16.2 KB just after the split, 6.4 KB on main).
- 2026-10-25: Played in the last fortnight goes by when a match kicked off as well as the day, so a Kumite played weeks
  late still has its after-party; the agenda is sent from London's evening (last night's, till 06:00) and with the day
  of a tournament not played yet whose day has gone by: the app decides by status what's past (ADR 0074, #182).
