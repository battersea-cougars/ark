# 0053. How the apps get their data: live reads cached the same way everywhere; the team app reads the club in parts, by version, and live pages are pushed to over SSE

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-11-02
- **Merges:** 0041, 0054, 0057, 0072, 0081, 0096, 0120

## Context

Uncached, a day of local work, screenshots and several sessions used up the dev Sanity project's monthly API quota and
then YouTube's daily units. `Cache-Control` alone doesn't help on the server: Cloudflare doesn't keep a Worker's own
replies because of it, only browsers do.

The team app reloaded the whole club (`/api/bootstrap`) when it opened, came back into view and after every change: a
busy Friday is hundreds of reads, nearly all unchanged, against D1's 5M rows read a day, and the whole club grew with
every member and every week of history. Live pages (the draft room, a game being scored, a tournament's day) polled:
a draft night with 30 phones at 10 seconds was 22% of the day's Worker requests, and a pick took up to 10 seconds to
show. Read part by part, opening the app was 29 statements one after another. Home's first paint waited on a chain of
three trips (the data, then the app, then Home).

## Decision

**Live reads are cached the same way everywhere**

- **Every Sanity read uses the API CDN** (`apicdn.sanity.io`), through one reader that counts them
  ([ADR 0003](0003-free-tiers-only.md)); only the Studio and scripts that write use the API.
- **Local, dev and production cache the same way**: there's no switch to turn it off.
- **Every live read on the website goes through `lib/server/cache.ts`**: in memory, then the Workers Cache API, with
  the last good copy kept for a failure ([ADR 0055](0055-degrade-instead-of-break.md)):

  | Read                                           | Fresh for  | Last good copy kept |
  | ---------------------------------------------- | ---------- | ------------------- |
  | YouTube playlists, Instagram                   | 10 minutes | a day, three days   |
  | Sanity: videos                                 | 1 minute   | an hour             |
  | D1: What's on, events, a player card           | 1 minute   | an hour             |
  | D1: when photos and videos were last refreshed | 30 seconds | a day               |

- Build-time content (`lib/sanity/content.ts`) is read once per build, every five minutes on a Worker and every minute
  in `astro dev`; the five club-fact singletons are one query.

**The team app reads the club in one statement, in parts**

- **One statement for the whole club** (`readClub`, `worker/api/api.club.ts`): each part is a query whose rows SQLite
  turns into JSON, side by side in one `SELECT`, and who's asking is a row of it (`WITH viewer AS (VALUES …)`), so each
  part filters on it and another member's private fields never leave D1 ([ADR 0024](0024-action-based-authorization.md)).
  The domain modules shape the rows.
- **Opening the app reads the core; each page reads its own parts when it's opened** (`SLICES` in
  `api.slices.ts`; `GET /api/slices?names=…`). The core is who you are and may do, the club's settings and menus, and
  what Home needs (the nights from tonight, tournaments not yet played and just played, the agenda, your own dues);
  it doesn't grow with the roster or the history. Past tournaments, a page of History, a ledger, a team's logo (by
  its own cached address) are each read when opened. Once the app's up and the phone is idle, the rest is prefetched
  in one request, unless it asks to save data.
- **Every part has its own version** (`data_version.parts`), and the bootstrap an ETag (the data version, the member,
  the day, the deploy): asked again with its tag while unchanged, it's an empty 304 after one row read. A change to D1
  made outside the API (a script) must bump `data_version`; the seeds do.
- **What's the same for everyone who sees the club alike is kept at the edge** (`worker/api/api.edge.ts`): keyed by
  the deploy, the parts, their versions and what the viewer may see, never who they are, so a change is a new key and
  nothing is stale. What's someone's own is never kept there, and a use case fails if a part that reads who's asking
  isn't marked so.
- **In the browser, in memory only**, never on disk: the bootstrap is `private, no-store`, so nothing of the club
  outlasts signing out. The app shell opens offline and says it can't reach the club.

**A change replies with the parts it touched**

- Every route that isn't a GET declares `changes`, the parts it can touch, and a test fails if one doesn't. A
  successful change replies with those parts, read after it as this member may see them, plus its version
  (`x-club-version`); the app puts them in place with no second request. Declaring too little leaves a part stale
  until its next change; declaring too much just reads more.
- A route that can't move anything on the calendar says `calendar: false`, so the agenda isn't read for it.
- **Parts are as narrow as what moves.** A register mark names the nights and `played` (what members have played:
  Home's people and the roster), never `members`, so the phones read the night, not the club. Only a change to who
  someone is or what they may do reads the whole club.
- **What people owe is worked out only where a change can move it** (`dues.scope.ts`): a change recharges its night's,
  tournament's or member's charges; the hourly run only the nights and tournaments since `data_version.charged_through`.
  A whole-club working-out is kept for an earlier fee, a tournament saved and Recalculate (the dues notes). So a tap's
  rows read don't grow with the club's history ([ADR 0003](0003-free-tiers-only.md)).

**Live pages are pushed to over SSE from a Durable Object that stores nothing**

- **One `LiveHub` per environment** (binding `LIVE`, `worker/live/live.ts`), SQLite-backed because the free plan
  requires it, **storing nothing**: the open streams live in memory, D1 stays the only source of truth, and a restart
  just drops them.
- **`GET /api/live` is a Server-Sent Events stream** for any signed-in member, at most three per member; ending a
  sign-in closes its streams. Its events name the parts that changed and the versions, not data, so what a member sees
  comes from their own reads, filtered for them. The exceptions are what's the same for every member, decided in one place (`live/live.parts.ts`): a game
  being scored on its day, whose event carries the match, and the after-party's reveals, whose event carries the drum
  and the winners already out (routes marked `liveAwards`), so a reveal is one request however many phones are in the
  room, and a winner still sealed never travels.
- **Every change notifies the hub** where all writes pass (`handleApi`), through `waitUntil`; a failed notify is
  logged and never fails the change. The hub sends at most one event a second, so a burst is one event.
- **A page reads only the parts an event names**, one read at a time after a random wait of up to a second, so the
  phones don't all ask at once. Nothing is read while the page is out of view; the stream is closed then.
- **Reconnecting goes through the brake** ([ADR 0055](0055-degrade-instead-of-break.md)), from 10 seconds doubling to
  5 minutes. **Polling is the fallback**: while the stream is down a live page checks at the club's
  `live_refresh_seconds` (admins set it on Usage), and with it up every 60 seconds as a safety net.

**Home's first paint**

- **The data first**: a one-line inline script at the top of `index.html` starts `fetch("/api/bootstrap")`, and the
  app takes that promise once (allowed by its hash in the CSP; a test fails when the script changes and the hash
  doesn't). Not a `<link rel="preload">`: Safari fetched twice.
- **Importing the app reads no data**, so the app and Home are imported up front beside the data and arrive in one
  wave; every other page is its own chunk, loaded when opened or while idle (`app/pages.svelte.ts`).
- **A budget**: `scripts/team-app-budget.mjs`, run by the team app's build, fails when what Home needs passes
  **105 kB gzipped**. Hashed files are kept a year (`immutable`); the page itself is always revalidated.

## Consequences

- A page view costs Sanity, YouTube or D1 at most one read a minute per data centre, however many people look; a
  change takes up to a minute to show on the website.
- Opening the app is a few statements and doesn't grow with the club; a tap is one request whose reply is the parts it
  touched. A test holds the open to its statements.
- A pick or a goal shows on every phone within about a second; a draft night is about a tenth of the requests polling
  took, and about 900 of the 13,000 free GB-s. D1 rows read is the line to watch.
- The parts' versions are only as good as the routes' declarations.
- The app has two ways to hear about a change, and both have to keep working: the tests drive the stream, and the
  fallback is what a locked phone or a hub restart falls back on. Paying for hosting one day would be a setting for the
  fallback pace, not a code change.
- A module that reads the club's data as it loads would see it empty: read it in a function, a `$derived` or a
  component. Judge first paint on a build, not the dev server.
