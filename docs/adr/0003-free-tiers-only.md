# 0003. Free tiers only: every route stays far under them, races are settled in the statement, and admins hear before a limit runs out

- **Status:** Accepted
- **Date:** 2026-10-05 (decided at project start) · updated 2026-11-02
- **Merges:** 0059, 0063, 0116, 0121

## Context

A volunteer-run club pays for this. The old team manager ran a Python solver on a paid server.

One Cloudflare account runs the website, the team app and their database on the free plan, whose daily allowances
reset at 00:00 UTC; if one runs out, the team app stops until then and the website's live pages fail (its prerendered
pages are free and keep working). A request may compute for 10 ms (waiting on D1 or a fetch doesn't count); past it
Cloudflare stops it with error 1102. An invocation may make 50 subrequests, D1 queries included. Sanity's free quotas
are monthly and hard (a spent one answers `402` until the 1st), and Sanity has no usage API.

The club's busy moments are all at once: Friday sign-up opening, the teams going up while everyone's on the page, a
draft with the room watching, a game scored live, the crons running through all of it. D1 runs each statement, and
each `batch()`, atomically and alone, with no interactive transactions, so two requests' statements interleave between
their awaits.

## Decision

**Free tiers only.** Every service runs on a free tier: Cloudflare Workers, D1, Cron Triggers and SQLite-backed
Durable Objects, Sanity Free, Bitwarden Secrets Manager Free, GitHub Actions, YouTube for video, Gmail, Firebase Cloud
Messaging, Sentry's Developer plan. The only planned costs are a domain (about £10 a year) and the app stores
(Apple's developer fee, about $99 a year on an existing account; Google's $25 once, when Android comes;
[ADR 0108](0108-store-apps.md)). Adding any paid service needs the club's agreement first.

- A **Durable Object is allowed when it stores nothing**: the live hub holds open streams in memory and keeps no rows;
  D1 stays the only source of truth ([ADR 0053](0053-how-the-team-app-gets-its-data.md)).
- **No card-payment provider**: dues are paid by bank transfer with a reference, so no card fees and no PCI scope.
- **No image service**: a member's photo is shrunk on the phone (512px, WebP or JPEG, 30–80 KB) and kept in D1 beside
  the member, served at its own address that changes with it (`immutable`); a team's logo is a small data: URL in D1.
  If pictures ever need to be bigger or many more, R2 is the move: the routes stay, only where the bytes live changes.

**Every route stays far under the free plan.** The plan is the ceiling, not the goal, so a busy Friday, a draft night
or a club twice the size doesn't find the edge:

- **Few round trips.** A request makes at most **25 D1 calls** (a `batch()` is one), whatever the club's size, the
  wrapper's own and what goes after the reply included. Statements that go together go in one `batch()`; a write that
  covers many rows takes them as one JSON list (`json_each`); never a query per item in a loop. A route that needs more
  says so and why, inside 50: the Kumite simulator 45 (dev only), Move to 40.
- **Read only what's needed.** Name the columns, bound the rows, and give every read path an index
  (`EXPLAIN QUERY PLAN`). D1 bills a sort's rows twice, so a part read on every live update is read in an index's order
  or put in order by the Worker.
- **Little CPU in the request.** Aggregate in SQL, page anything that grows, do heavy work at build time or in the
  browser (the team maker, [ADR 0006](0006-one-repo-two-projects.md)) or precompute it (fair fixtures for up to 8
  teams are a table checked against the search by a test). Never hash passwords or process images in a Worker.
- **Side effects after the reply.** Pushes, emails and fan-out go through `waitUntil`, the outbox and the cron, never
  awaited in the response.
- **Small replies.** Send back the parts a change touched, not the whole club ([ADR 0053](0053-how-the-team-app-gets-its-data.md)).
- **An invocation keeps to 50 subrequests** (fetches, emails, live hub calls), counted by the fake world: a request's
  push send is 40 phones; a five-minute cron run drains 25 phones and sends 10 emails; the run every minute between
  drains 40. A job that could be bigger is claimed and sent a few at a time over later runs.

`api.budget.use-cases.test.ts` drives every route on its happy path on a club of 60 and of 120 and fails when a route
isn't driven, goes over its budget, or costs more for the bigger club. The CPU use cases run on a club with a year of
Kumites and hold every request they time to 10 ms.

**Requests at once are safe by statement, not by luck.** Every rule that two requests could race is decided inside the
statement that writes it, or the statements that must go together go in one `batch()`: a conditional
`INSERT … SELECT … WHERE`, an `UPDATE … WHERE` with its changes checked, a UNIQUE constraint, a claim (`UPDATE …
RETURNING`, or a claim id) before anything is sent. A read before it is only for the words of a refusal. A request that
acts on what the page saw names it (the draft's turn, a step, a status, a tap's id), and is refused if things moved on.
The fake D1 interleaves like D1 (`db.interleave(seed)`, `packages/shared/testing/d1-sqlite.ts`), and
`*.concurrency.use-cases.test.ts` fire requests at once under several seeds and check the invariants; a seed that found
a race stays in its test.

**Load runs on your own machine, or on dev once the user's been told, never on production** (`npm run load`,
[docs/load-testing.md](../load-testing.md)). On dev the run brings its own members, marks everything it makes and takes
it away at the end.

**Admins see the allowance and hear before it runs out.** The team app's Usage page shows today's Workers, D1 and live
hub use against the free limits, CPU time per request, and this month's Sanity requests; an hourly cron check tells
the admins by email and on their phones as a limit nears, and Home's For admins shows the nearest
([the Settings notes](../../apps/team/worker/settings/README.md)). How:

- Cloudflare's GraphQL analytics, in one query, with a **read-only token** (`CLOUDFLARE_ANALYTICS_TOKEN`), never the
  deploy token, which shouldn't live in a Worker. Without it the page says how to set it up and the check does nothing.
- **Sanity requests are counted by us**, at the one reader (`sanityQuery`, plain fetch on the API CDN, and the team
  app's one read), per UTC day, project and quota, in memory, then into D1 (`sanity_requests`) in one round trip after
  the response; the build sends its count over Cloudflare's API when it's done. Every read carries a tag
  (`web.build`, `web.dev`, `web.worker`, `team`) so Sanity's own log shows which it was. Our count is a floor: the
  Studio, scripts and local use aren't counted, and sanity.io/manage stays the source of truth.
- **Near the CDN quota, builds come first**: at 90% of the month's CDN requests the website's live reads stop calling
  Sanity until the 1st (the circuit breaker, [ADR 0055](0055-degrade-instead-of-break.md)), so the daily rebuild and
  a release still have the last tenth.

## Budget

| Service                   | Free allowance                                                | Expected use                                                      |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Cloudflare Workers        | 100k dynamic requests a day; static assets free and unlimited | Form posts, photo pages, team-app API, live Kumite                |
| Workers CPU               | 10 ms per request and per cron run; waiting on I/O is free    | 1–5 ms; watched on the Usage page                                 |
| Workers subrequests       | 50 an invocation, D1 queries included                         | A request a handful; the Kumite simulator's dearest about 42      |
| Durable Objects           | 100k requests, 13,000 GB-s a day (SQLite classes only)        | One live hub: a draft night ~900 GB-s                             |
| D1                        | 5 GB storage, 5M rows read and 100k written a day             | Small; rows read is the line to watch on a draft night            |
| Cron Triggers             | Free                                                          | The hourly and five-minute jobs                                   |
| Sanity                    | 1M CDN and 250k API requests a month, 10k documents, 100 GB   | A handful of editors; live photo reads                            |
| Bitwarden Secrets Manager | Free plan: 3 projects, 3 machine accounts                     | 2 projects, 3 accounts ([ADR 0002](0002-secrets-in-bitwarden.md)) |
| GitHub Actions            | Free on a public repo, macOS runners included                 | Deploys, checks, the store app's builds                           |
| YouTube Data API          | 10,000 units a day per Google Cloud project                   | Video reads; an upload costs about 1,600 units                    |
| Gmail API                 | Free, about 500 emails a day                                  | Sign-in codes, enquiries, dues reminders                          |
| Web Push, FCM             | Free                                                          | The team app's notifications ([ADR 0108](0108-store-apps.md))     |
| Sentry                    | Developer plan: 5k errors a month, 1 user                     | Errors and down alerts ([ADR 0110](0110-structured-logging.md))   |

YouTube uploads from an unverified Google Cloud project stay private until the project passes Google's API compliance
audit (free); the club applied at the start.

## Consequences

- No paid bindings (Cloudflare Images, Durable Objects that store rows), no card fees, no always-on server.
- A rule that's checked and then written is a bug waiting for a busy Friday; review asks where the check is.
- A slow route shows as a rising p99 on the Usage page before it fails. Tests can't measure Worker CPU (Node and
  in-memory SQLite aren't workerd), so the guard is the measurement in production plus the rules above;
  `scripts/cpu-by-route.mjs` gives CPU per route from Workers Logs. A cold Worker's first request costs more.
- Admins hear about a runaway or a scraper with almost a third of the day left, not when the app stops.
- Rows read is the limit closest to the edge: live pages read only the parts that changed, without sorts or scans of
  the club's history.
