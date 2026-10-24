# 0003. Free tiers only

- **Status:** Accepted
- **Date:** 2026-10-05 (decided at project start) · updated 2026-10-24

## Context

A volunteer-run club pays for this. The old team manager ran a Python solver on a paid server.

## Decision

Every service runs on a free tier: Cloudflare Workers, D1, Cron Triggers and SQLite-backed Durable Objects, Sanity
Free, Bitwarden Secrets Manager Free, GitHub Actions, YouTube for video. The only planned cost is a domain (about £10
a year). The budget and each service's limits are below.

A Durable Object is allowed when it stores nothing. Since April 2025 SQLite-backed classes are on the Workers Free
plan (100,000 requests and 13,000 GB-s of duration a day). The live hub, `LiveHub`, holds open streams in memory and
keeps no rows; D1 stays the only source of truth ([ADR 0072](0072-live-updates.md)).

## API functions stay cheap

The free plan is the ceiling, not the goal: every route is designed to stay far under it, so a busy Friday, a draft
night or a club twice the size doesn't find the edge. The rule, route by route (checked in
[docs/api-budget.md](../api-budget.md)):

- **Few round trips.** A request makes at most **25 D1 calls** (round trips; a `batch()` is one, as Workers counts its
  50 queries an invocation, [0123](0123-dev-only-tools.md)), whatever the club's size, the wrapper's own and what goes
  after the reply included. Statements that go together go in one `batch()`, reads included; never a query per item in
  a loop (no N+1). A route that needs more says so and why, inside 50: the Kumite simulator 45 (dev only), Move to 40.
- **Read only what's needed.** Name the columns, bound the rows (yours by index, not picked out of everyone's), and
  give every read path an index (`EXPLAIN QUERY PLAN`): no whole-table read of a growing table on a hot path.
- **Little CPU in the request.** No heavy search or compute inline: precompute it, cache it, or keep it inside a
  measured bound (fair fixtures: the table for up to 8 teams, the timed search past it).
- **Side effects after the reply.** Pushes, emails and fan-out go through `waitUntil`, the outbox and the cron
  ([0108](0108-store-apps.md)), never awaited in the response.
- **Small replies.** Send back the parts a change touched (versions and slices, [0072](0072-live-updates.md)), not the
  whole club.
- **Rules decided in the statement that writes** ([0121](0121-load-and-concurrency.md)): cheaper than read-then-write,
  and race-safe.

`api.budget.use-cases.test.ts` drives every route on its happy path on a club of 60 and of 120 and fails when a route
isn't driven, goes over its budget, or costs more for the bigger club. The fake D1 counts each request's own calls
(`Reply.d1`), however many run at once.

## Budget

| Service                   | Free allowance                                                | Expected use                                                                       |
| ------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Cloudflare Workers        | 100k dynamic requests a day; static assets free and unlimited | Form posts, photo pages, team-app API, live Kumite                                 |
| Workers CPU               | 10 ms per request and per cron run; waiting on I/O is free    | 1–5 ms; watched on the Usage page (ADR 0059)                                       |
| Workers subrequests       | 50 an invocation, D1 queries included                         | A request a handful; the Kumite simulator's dearest about 42 (ADR 0123)            |
| Durable Objects           | 100k requests, 13,000 GB-s a day (SQLite classes only)        | One live hub (ADR 0072): a draft night ~900 GB-s                                   |
| D1                        | 5 GB storage, 5M rows read a day                              | Tiny                                                                               |
| Cron Triggers             | Free                                                          | Friday series, quarterly dues                                                      |
| Sanity                    | Free plan: 1M CDN, 250k API requests a month; see below       | A handful of editors; live photo reads                                             |
| Bitwarden Secrets Manager | Free plan, 3 machine accounts                                 | 1                                                                                  |
| GitHub Actions            | 2,000 minutes a month (private repo)                          | About 2 minutes per deploy, per project                                            |
| YouTube Data API          | 10,000 units a day per Google Cloud project                   | Video reads; an upload costs about 1,600 units                                     |
| Gmail API                 | Free, about 500 emails a day                                  | Sign-in codes, enquiries, dues reminders                                           |
| Web Push                  | Free (browser push services)                                  | Team-app notifications ([#24](https://github.com/battersea-cougars/ark/issues/24)) |
| Firebase Cloud Messaging  | Free, unlimited                                               | The store app's notifications (ADR 0108)                                           |
| GitHub Actions macOS      | Free on a public repo                                         | The store app's builds, when its shell changes (ADR 0108)                          |
| Sentry                    | Developer plan: 5k errors a month, 1 user                     | The apps' errors and down alerts (ADR 0110): a handful a month once settled        |

Sanity Free, checked on [sanity.io/pricing](https://www.sanity.io/pricing) on 2026-10-05: 20 seats, 2 datasets
(public only), 10k documents, 1M API CDN requests and 250k API requests a month, 100 GB of assets, 100 GB of
bandwidth a month. Photo pages read the API CDN live ([ADR 0016](0016-photos-and-videos-read-live.md)).

YouTube uploads from an unverified Google Cloud project are locked to private until the project passes Google's
API compliance audit (free). The team app applied for it at the start.

Publishing the team app to the app stores adds Apple's developer fee (about $99 a year, on an existing account) and,
when the Android app comes, Google's ($25 once) ([#26](https://github.com/battersea-cougars/ark/issues/26),
[0108](0108-store-apps.md)).

## Consequences

No paid bindings (Cloudflare Images, Durable Objects that store rows), no card-payment provider, no always-on
server. Adding any paid service needs the club's agreement first. Durable Object requests and duration show on the
Usage page and count in its 70% and 90% check ([ADR 0059](0059-usage-page-and-check.md)).

## History

- 2026-10-05: Every service on a free tier; no paid bindings, including Durable Objects with storage (0003).
- 2026-10-09: A Durable Object that stores nothing is fine, since SQLite-backed classes became free; the rule now
  reads "Durable Objects that store rows" (0096).
- 2026-10-09: The free-tier budget moved here from `docs/roadmap.md`, which was deleted.
- 2026-10-11: The App Store's yearly fee accepted, on an existing Apple Developer account; Firebase Cloud Messaging
  and GitHub's macOS runners added, both free (0108).
- 2026-10-18: Sentry's free Developer plan added for errors and down alerts (0111); Better Stack was tried and
  dropped, its alert routing unclear without paid on-call.
- 2026-10-23: The 50 subrequests (D1 queries included) an invocation is in the budget, as the simulator's Spin kick
  is sized by it (0123).
- 2026-10-23: API functions stay cheap, as a rule (#148): at most 25 D1 calls a request (the simulator 45, Move to
  40), batched, bounded, indexed, side effects after the reply, small replies, rules in the writing statement; every
  route counted on a club of 60 and of 120 (`api.budget.use-cases.test.ts`, docs/api-budget.md), and what it found
  fixed: agenda syncs in two round trips, the first open's N+1 over trainings, a tournament's standing read in one,
  Move to's repeated syncs, the dues parts read by index, four indexes.
- 2026-10-24: The Usage check tells admins at 70% and 90% of a limit, not 80% (ADR 0059, #157).
- 2026-10-24: Opening the app measured 21 ms CPU (p50) on dev (#175), over the 10 ms. Every tournament there has been
  is in the bootstrap, so its cost grows with them: the CPU use cases now run on a club with a year of Kumites (four,
  each team with a logo; twelve with `LOAD_KUMITES=12`; `bootstrap.testing.ts`) and hold every request they time to
  10 ms. What they found is fixed: a tournament's games, teams and players, and a game's goals and penalties, put with
  their own in one pass (each looked through every one there's been); team logos read as text and put into the reply
  as they are (`AsIs`, api.http.ts), never parsed or escaped again; London's wall-clock formatter made once. The app
  is sent the same bytes (`bootstrap.same.use-cases.test.ts`). Locally a member's open is 3–5 ms with four Kumites
  and 7–11 ms with twelve (10–15 before, docs/load-testing.md); what's left is in proportion to the bytes sent (1.5 MB
  with twelve, three quarters logos), so the next step is sending less: logos by their own cached URL, past
  tournaments when they're opened.
- 2026-10-24: Sending less (#175): the bootstrap no longer sends past tournaments (read when opened, History a page at a
  time, ADR 0074) or logos (their own cached address). With twelve Kumites a member's open is 71 KB, not 1.5 MB, and
  1.6–1.9 ms of the Worker's own CPU locally with four or twelve (it no longer grows with them); a past one opened and
  a page of History are under 0.5 ms each.
