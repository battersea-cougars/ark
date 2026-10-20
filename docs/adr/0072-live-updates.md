# 0072. Live pages are pushed to over SSE from a Durable Object; polling at the admins' pace is the fallback

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-20
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
  still comes from their own bootstrap. A server without a hub answers 503. The hub sends a comment every 30 seconds
  so dead phones are dropped.
- **Every change notifies the hub** at the one place all writes pass (`handleApi`, after the data version bump), with
  the slices the route declared, through `waitUntil`. A notify that fails is logged, never fails the change.
- **A page reloads on an event naming a part it follows** (the ETag check, [0053](0053-live-reads-are-cached.md): one
  request, a 304 when it already has it), and on reconnecting after a drop. The stream is open only while the page is
  in view; hidden, it's closed, and coming back reopens it and catches up.
- **Reconnecting goes through the brake** ([0055](0055-degrade-instead-of-break.md)): the browser's own 3-second retry
  is turned off; the app reopens after 10 seconds, doubling to 5 minutes, never while the brake rests, and each
  connect counts as one of the tab's calls for the day.
- **Polling is the fallback, not gone.** While the stream is open a page still checks every 60 seconds, as a safety
  net. While it's down, it checks at **one club setting, `live_refresh_seconds`** (`club_settings`; default 10, 5 to
  120 seconds), sent to everyone in the bootstrap (`settings`). Admins (`manage:Settings`) set it on **Usage**, beside
  today's use, with what it costs: requests per phone per hour, and a tournament day as a share of the free day.
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
