# 0072. Live pages are pushed to over SSE from a Durable Object; polling at the admins' pace is the fallback

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-21
- **Merges:** 0096

## Context

Live pages follow along: the draft room while it's open, a game being scored, the tournament's home on the day. By
polling, every phone asks every few seconds whether the club has changed, and every check is a Worker request against
the club's free 100,000 a day ([0055](0055-degrade-instead-of-break.md), [0059](0059-usage-page-and-check.md)). A
2-hour draft night with 30 phones at 10 seconds is 21,600 of them (22% of the day); a tournament day with 30 phones on
a live page for 4 hours is about 43,000. Another captain's pick takes up to 10 seconds to show.

Since April 2025 Durable Objects are on the Workers Free plan, as long as the class is SQLite-backed, with 100,000
requests and 13,000 GB-s of duration a day. A Durable Object's request has no wall-clock limit while the caller stays
connected, so it can hold one open stream per phone and write to all of them at once. A Worker alone can't: one stream
is one request, and the free plan's 10 ms of CPU a request runs out within minutes of checking D1 every second.

The club may one day pay for hosting, when checking more often costs next to nothing.

## Decision

- **One Durable Object per environment, `LiveHub`** (binding `LIVE`, `apps/team/worker/live/live.ts`), declared with
  `new_sqlite_classes` (migration `v1` in `apps/team/wrangler.jsonc`) because the free plan requires it, **storing
  nothing**: the open streams live in memory, D1 stays the only source of truth, and an object restart just drops
  the streams. The free-tiers rule ([0003](0003-free-tiers-only.md)) forbids Durable Objects that store rows; a
  fan-out object is fine.
- **`GET /api/live` is a Server-Sent Events stream** for any signed-in member. Its events are only the names of the
  club's parts that changed ([0057](0057-team-app-loading-and-changes.md)'s slices), never data; what a member sees
  still comes from their own bootstrap. A server without a hub answers 503. The hub sends a `ping` event every 30 seconds
  and one as each stream opens (`HEARTBEAT_MS`, in `src/lib/live-stream.ts`), so dead phones are dropped, and a page
  that hears nothing for a beat and a half (`SILENCE_MS`, 45 seconds) knows its stream is dead even when the browser
  never says so: it stops saying "Live", closes it, and reconnects on the usual backoff, reading what it missed. No
  watch while the page is out of view (its stream is closed then).
- **Each stream is a member's and a sign-in's.** One member holds at most three (`STREAMS_PER_MEMBER`); a fourth
  closes their oldest, so a stale one never shuts out the page in front of them and nobody holds dozens (#73). Ending
  a sign-in (signing out, an admin's Sign out everywhere, a new email, being made inactive, deleting the account)
  closes its streams at once (`POST /end`, [0023](0023-sign-in-and-sessions.md)); the page's reconnect then gets a 401.
- **Every change notifies the hub** at the one place all writes pass (`handleApi`, after the data version bump), with
  the slices the route declared and the data version the change made, through `waitUntil`. A notify that fails is
  logged, never fails the change.
- **The hub sends at most one event a second**: the first change after a quiet second goes out at once; the ones
  after it wait for the end of that second and go out together, naming every part and every version in them. So a
  burst (a Friday's taps) is one event a second, not one a tap.
- **A page reads only the parts an event names, not the whole club** (#112). The app's copy of the club
  (`app/catch-up.ts`) knows the data version it holds all of; an event naming a part a page follows makes it read
  the parts it lacks (`GET /api/slices?names=…`, each as this member may see it, with the version read first), one
  read at a time, after a random wait of up to a second, so a burst is one read a phone and the phones don't all ask
  in the same instant. Nothing is read while the page is out of view. A change's own reply carries its version
  (`x-club-version`), so the phone that made it reads nothing more. A change to members or roles (what someone may
  do) reads the whole club. The whole club's check (the ETag, [0053](0053-live-reads-are-cached.md)) asks at the
  version the copy holds, so once the parts are in it's a 304; a version the copy never heard of (a change that told
  nobody, like the dues cron's, or one made before the stream opened) leaves it short until that check reads it all.
  The stream reconnecting after a drop checks the whole club too. The stream is open only while the page is in view;
  hidden, it's closed, and coming back reopens it and catches up.
- **Reconnecting goes through the brake** ([0055](0055-degrade-instead-of-break.md)): the browser's own 3-second retry
  is turned off; the app reopens after 10 seconds, doubling to 5 minutes, never while the brake rests, and each
  connect counts as one of the tab's calls for the day.
- **Polling is the fallback, not gone.** While the stream is open a page still checks every 60 seconds, as a safety
  net. While it's down, it checks at **one club setting, `live_refresh_seconds`** (`club_settings`; default 10, 5 to
  120 seconds), sent to everyone in the bootstrap (`settings`). Admins (`manage:Settings`) set it on **Usage**, beside
  today's use, with what it costs: requests per phone per hour, and a tournament day as a share of the free day.
- **A page opening just after the club was read doesn't check it again** (within 10 seconds: Home, as the app
  opens, [0120](0120-team-app-first-paint.md)).
- **Every live page uses this** (`lib/live-updates.svelte.ts`): the game page from the game up next to full time (the
  scorekeeper's too: the same person may have it open on two devices), the tournament's home on its day while games
  are on, and the draft room while it's open. Only while the page is in view; the brake still has the last word.
- **Each page says which**: "Live", or "Updates every 10 seconds".
- **Sign-ups follow along too, quietly**: Home (its training and tournament cards) and a training's page follow
  `sessions` (once the teams are out, everyone's but a team maker's, whose own moves a refresh mid-drag would upset) (and Home `tournaments`), so someone answering In or Out shows on everyone's cards
  and lists without a refresh. Everyone sits on these pages, so they don't say "Live", and with no stream they check
  once a minute (`steady`), not on the admins' live beat: a dropped stream across the whole club can't spend the day.
- **The Usage page shows Durable Object requests and duration** beside the day's use, and the 80% check
  ([0059](0059-usage-page-and-check.md)) covers them.

## Consequences

- A pick or a goal shows on every phone within about a second. A draft night is about 2,000 Worker requests instead of
  21,600, and about 900 GB-s of the 13,000 (one object billed while anyone is connected, whatever the number of
  phones). A tournament day of live scoring is about 1,800 GB-s. These are estimates, not yet measured.
- Measured locally ([0121](0121-load-and-concurrency.md), docs/load-testing.md): requests stay a few per cent of the
  day; **D1 rows read** was what ran out while every phone reloaded the whole club on every change (a draft night
  with 68 phones about 87% of the free 5M, a full Friday rush about twice it, #112). Reading only the parts, one
  read at a time, with the hub's one event a second: a draft night about 33%, a game scored live for 80 phones
  about 3% (was 24%), the Friday rush about 12% with every read landing.
- A change reaches other screens a little later at a quiet moment (a random wait of up to a second before the read,
  and up to a second in the hub when changes come close together); under load the lighter reads make it sooner (a
  pick on every screen 1.2 s at the median, was 1.6 s).
- The data version is now part of what the app and the hub say to each other (an event's `versions`, a reply's
  `x-club-version`, the ETag at the version held): a change that bumps it without notifying (the dues cron) costs
  each live phone one whole read on its next check, as before.
- The app has two ways to hear about a change, and both have to keep working: the tests drive the stream
  (`live.use-cases.test.ts`), and the fallback is what a locked phone, a dropped connection or a hub restart falls back
  on.
- Moving to a paid plan is a setting change for the fallback pace, not a code change.
- Deploying the first time applies the `v1` migration to that Worker (`team` on dev, and on production at
  launch). A previews-only upload (`wrangler versions upload`) can't apply it; the team app deploys with
  `wrangler deploy`.
- The same object would carry the website's live Kumite page one day; for now the website keeps polling.

## History

- 2026-10-08: Live pages poll at one admin setting, `live_refresh_seconds`, instead of the draft room's fixed 10
  seconds and the game page's own pace; push ruled out as not free (was 0072).
- 2026-10-09: Durable Objects found to be on the free plan; live pages pushed to over SSE from a `LiveHub` that
  stores nothing, with polling kept as the fallback and a 60-second safety net (was 0096).
- 2026-10-10: Home and a training's page (until its teams are made) follow sign-ups live, quietly, falling back to a
  check a minute.
- 2026-10-20: A training's page keeps following once the teams are out (but not for a team maker), so teams made,
  moved or cleared reach everyone on it without a refresh.
- 2026-10-21: Load runs measured the fan-out: D1 rows read, not requests, is the limit a busy day passes (#112).
- 2026-10-21: Live pages read only the parts an event names, one read at a time after a random wait, nothing while
  hidden; the hub sends at most one event a second, with the data versions; a page opening just after the club was
  read doesn't check again (#112). Before, every event was a whole-club reload on every phone.
- 2026-10-21: A member holds at most three streams (a fourth closes their oldest), and a stream closes when its sign-in
  ends; the hub knows each stream's member and session (#72, #73).
- 2026-10-23: The heartbeat is a `ping` event, not an SSE comment (which a browser never passes to the page), sent as
  each stream opens and every 30 seconds; a page that hears nothing for 45 seconds treats its stream as dead (not
  "Live", closed, reconnected with the backoff and a catch-up). Before, a silently dead connection (a phone that
  changed networks, a proxy holding the socket) could say "Live" for minutes after updates stopped.
