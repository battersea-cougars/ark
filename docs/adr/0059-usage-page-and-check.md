# 0059. Admins see the free Cloudflare allowance, CPU time and our own count of Sanity requests, and are emailed before any runs out

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-24
- **Merges:** 0063, 0116

## Context

One Cloudflare account runs the website, the team app and their database, on the free plan: 100,000 Worker requests,
5 million D1 rows read and 100,000 written a day, reset at 00:00 UTC. If one runs out, the team app stops until then
and the website's live pages fail (its prerendered pages are free and keep working). The app's own brake
([0055](0055-degrade-instead-of-break.md)) stops it running away; something also has to tell someone the allowance is
being spent, by a scraper or anything else. The live hub ([0072](0072-live-updates.md)) adds Durable Objects' own free
allowance: 100,000 requests and 13,000 GB-s of duration a day.

On the Workers free plan a request may also compute for 10 ms. Waiting on D1, Sanity or another fetch doesn't count;
running our code does (rendering, JSON, loops, crypto). Past 10 ms Cloudflare stops the request and it fails with
error 1102. The same applies to a cron run. Raising the limit needs Workers Paid ([0003](0003-free-tiers-only.md)).

Both Sanity projects are on the free plan: **250,000 API requests and 1,000,000 API CDN requests a month**, plus
100 GB bandwidth ([sanity.io/pricing](https://www.sanity.io/pricing), checked 2026-10-20). The caps are hard: a spent
quota is refused (`402 plan_limit_reached`) until 00:00 UTC on the 1st. Sanity emails at 80% and 100%. Per
[Diagnose API request spikes](https://www.sanity.io/docs/platform-management/diagnose-api-request-spikes), requests to
`<project>.api.sanity.io` count towards API requests and to `<project>.apicdn.sanity.io` towards CDN requests;
requests from the Studio and other Sanity apps don't count, and neither do 4xx or 5xx answers. **Sanity has no usage
API** (`/projects/{id}/usage` is a 404): only the Usage tab on sanity.io/manage, and a 7-day request log to download.

On 2026-10-07 the dev project (`zmg6rbe3`) spent its API quota (#15). The cause, from the history: until 17:17 that
day, the build and `astro dev` read Sanity with `@sanity/client` and `useCdn: false` (the API, only the Worker used
the CDN), and from 11:36 to 17:17 (ADR 0053's `CACHE_READS` step) `astro dev` and the dev Worker also re-read Sanity on
every call: one page view was about 20 to 40 direct API requests (five club-fact singletons per `getSettings()`, three
or four callers per page, plus the page's own and the live reads), multiplied by Vite's reloads, several sessions and
agents' headless screenshots. Since 17:17 every read we make goes through the CDN. Still blocked on 2026-10-20 is that
same month's quota (a month's quota, not a new leak): the CDN answers dev's reads (checked: 200 from `apicdn`, 402 from
`api`), while writes (seeding, the Studio's own scripts) go to the API and are refused until 1 November.

## Decision

- **Settings → Security → Usage** (`read:Usage`; admins have it through `manage:all`) shows, against the free limits,
  today's Worker requests, D1 rows read and rows written, the live hub's Durable Object requests and duration (GB-s),
  and when they reset in London time. It also shows each Worker's CPU time per request today: typical (p50) and the
  slowest 1 in 100 (p99), against 10 ms, and how many requests were stopped for going over. The live-update pace
  setting sits beside it ([0072](0072-live-updates.md)). Below, this month's Sanity requests as we count them, with
  their own monthly emails (below).
- **An hourly check** (the team Worker's cron trigger, `7 * * * *`, free) emails the admins once a day per metric when
  one passes 80%, and once a day (metric `cpu`) when any request was stopped, with the count per Worker. It goes
  through the usual mail rules (outside production, only to the safe address). `usage_warnings` remembers what was
  sent each day, claimed before sending so two runs send one email.
- **Admins see it on Home before it runs out** (#148). Each hourly check also keeps, in `usage_levels`, every limit
  it read that's at 70% or more, and only those (`apps/team/worker/settings/usage.levels.ts`): today's Worker
  requests, D1 rows read and written, the live hub's requests and time, a request stopped for its CPU time (the 10 ms
  limit spent), and this month's Sanity API and CDN requests. It reads what's kept and writes only when something
  changed (a delete of what it read and an insert of what's near, then a new data version, so the next open of the
  app isn't a 304 with the old line); a limit back under 70% goes, and when Cloudflare can't be read its rows stay as
  last found. They come with the club, in the bootstrap's one read (`forAdmins`, for `read:Usage`; nobody else gets
  any), so Home's For admins has its line on first paint and nothing moves when it comes. It says the nearest in one
  line, last, opening the Usage page: "Database rows read at 74% of today's free limit", with when it resets and how
  many more are past 70%; at 90% it says "Nearly spent" and its icon is red. All fine, no line. A row from a day or
  month that's over isn't shown. Pushing and emailing admins at these levels is #157.
- Both read Cloudflare's GraphQL analytics in one query (`apps/team/worker/settings/usage.ts`): `workersInvocationsAdaptive`
  sums and quantiles, the same dataset filtered to `status: "exceededResources"`, and the Durable Object datasets.
  They use a **read-only token**, `CLOUDFLARE_ANALYTICS_TOKEN` (Account Analytics Read), never the deploy token,
  which shouldn't live in a Worker. Without it the page says how to set it up and the check does nothing; if
  Cloudflare can't be read, the page says so.
- **Code is written to stay well under 10 ms**: aggregate in SQL rather than in JavaScript, page anything that grows
  (`LIMIT`), do heavy work at build time (prerendered pages) or in the browser, and never hash passwords or process
  images in a Worker. Sign-in is a code or link ([0023](0023-sign-in-and-sessions.md)), not a password.
- **One round trip per job, one statement per kind of change.** Every call to D1 costs the Worker CPU time (about
  0.4 ms each, measured on dev in 2026-10), and the free plan allows 50 queries a request. So a job never awaits D1
  once per row: it builds its statements and sends them with `batch` (`packages/shared/d1.ts`), and a write that
  covers many rows takes them as one JSON list (`json_each`) in one statement, so the count doesn't grow with the
  club. A list of changes from the app (a member's attendance) is one request, not one per row. Use-case tests hold
  this with the fake D1's `roundTrips` count (`dues.load.use-cases.test.ts`).

### Sanity requests

**Count at the one reader.** Every Sanity read the website makes goes through `sanityQuery`
(`apps/web/src/lib/server/sanity-live.ts`), plain fetch on the API CDN: the build's content (`lib/sanity/content.ts`,
no longer `@sanity/client`) and the Worker's live reads. The team app's one read (the club's email,
`packages/shared/club-contact.ts`) is counted too. `packages/shared/sanity-requests.ts` counts each answer under 400,
by UTC day, project and quota (`api` from `api.sanity.io`, `cdn` from `apicdn.sanity.io`), in memory.

- **Into D1, after the request**, in one round trip: `sanity_requests` (day, project, kind, count), added to with one
  upsert of all the counts (`json_each`), and in the same batch the month so far for those projects. The website's
  middleware does it once a live response has finished streaming (`waitUntil`); the team Worker after an API request
  and in its hourly cron. Nothing counted, nothing sent. A read made after the reply (sending an email) is counted with
  the next request's.
- **The build** counts in its own Node process; `lib/sanity/count.integration.ts` sends the build's count to the
  environment's D1 over Cloudflare's API when the build is done (CI only: `CI` and the account's
  `CLOUDFLARE_API_TOKEN`, which the build job has for the club snapshot; `scripts/lib/d1-api.mjs`). No new secret. A
  build never fails over it. A build reads 6 times (the club facts are one query, below).
- **Local use isn't counted**: a laptop's build or `astro dev` reads the dev project but can't reach dev's D1. The
  build says its count; `astro dev` counts a server route's reads into the local D1 and logs every read.
- **Tagged in Sanity's own log**: every read carries `tag=web.build`, `web.dev`, `web.worker` or `team`, so Sanity's
  request log shows which of ours it was.

**Find the runaway.** In `astro dev` every read is logged (`sanity.read`) with its route and the user agent
(`lib/server/sanity-trace.ts`, an AsyncLocalStorage the middleware fills). A prerendered page gets no headers even in
dev, so the dev server also logs each page asked for with its user agent (`dev.page`).

**Spend less.** The five club-fact singletons are one query (`FACTS`), not five, everywhere. `astro dev` keeps them
for a minute, as before (ADR 0053): at most one read a minute however many pages load, a Studio change shows within
a minute, and it costs the CDN quota. Reading once per process and refreshing on a Studio change was considered:
Sanity's webhook can't reach a laptop, and a `listen` connection is an API request, the scarce quota.

**The Usage page** shows this month's count for the environment's project, API
and CDN, against the free plan, with where the month's pace ends up and when it resets. It's ours, so it shows without
the Cloudflare token. Production's page shows production's project; dev's, dev's.

**The hourly check** emails the admins once a month per quota at 50% and at 80% (past 80% at once, the one email), and
once when the month's pace would run out before the 1st, from the fourth day of the month (a first day says little).
A threshold's email also gives the pace, so a quota gets one email at a time. Claimed in `usage_warnings` keyed by the
month.

**Near the limit, builds come first.** At 90% of the month's CDN requests (as the last flush learnt it), the website's
reads stop calling Sanity until the 1st: the circuit breaker opens until then (ADR 0055), live pages serve the last
good copy and then their empty state, and server routes keep the club facts they last read. Builds don't know the
month's count, so they keep reading the last tenth: the daily rebuild and a release still work.

## Consequences

- Admins hear about a runaway or a scraper with a fifth of the day left, not when the app stops.
- A slow route shows up as a rising p99 before it fails, and a failure is an email, not a member's report.
- The check costs 24 Worker requests and three small round trips an hour (one reads the kept levels; writing them,
  and a new data version, only when they changed); CPU time comes from the same query.
- On a quiet Worker most requests start it cold, and starting up costs CPU: on 2026-10-10 dev's web Worker showed
  26 ms typical over 31 requests a day, but 4.4 ms typical (20 ms at p90) once warm. Read dev's figures with that in
  mind; `scripts/cpu-by-route.mjs` gives CPU time per route from Workers Logs (dev token only) to find a slow one.
- Tests can't measure Worker CPU (Node and in-memory SQLite aren't workerd), so the guard is this measurement in
  production plus the rules above, not a test.
- It only runs where the team app is deployed; locally the page works on a dev server started through env-pull.
  Sanity's usage isn't readable through its API, so the page shows our own count.

- Admins see both projects' month without sanity.io (each environment's app shows its own), and hear at 50%, 80% and
  when the pace is wrong, before Sanity's own 80% email.
- Our count is a floor, not Sanity's figure: the Studio, scripts with `sanity exec` (seeding, migrations: API writes),
  local builds and `astro dev` aren't counted, and a count can be lost if an isolate ends before its flush. If the
  page and sanity.io disagree, the difference is what we don't count; sanity.io/manage stays the source of truth.
- A live route that read Sanity costs one more D1 write and read (one round trip) after its response; reads are cached
  (ADR 0053), so that's at most about once a minute per data centre.
- The 90% stop is per isolate until the breaker's shared copy (Workers Cache, custom domain only) reaches the rest; on
  `workers.dev` each isolate learns it from its own flush.
- The API quota is still only Sanity's to see in detail: our reads never use it, so a rising API count on sanity.io
  means the Studio's scripts or something that isn't ours.

## History

- 2026-10-07: The Usage page and an hourly 80% check for Worker requests and D1 rows, with a read-only analytics token
  (was 0059).
- 2026-10-07: CPU time per request (p50, p99, stopped) on the page, an email when a request is stopped, and the rules
  for staying under 10 ms (was 0063).
- 2026-10-09: The live hub's Durable Object requests and duration added to the page and the 80% check (ADR 0072).
- 2026-10-10: Cold starts explain high CPU on a quiet Worker; the dev token can read Workers Logs for CPU per route
  (`scripts/cpu-by-route.mjs`).
- 2026-10-11: One round trip per job: a sign-up or a tick on the register went from 44 D1 calls (and one more pair per
  Quarterly Member's quarter) to about 15, whatever the club's size; a member's attendance saves in one request.
- 2026-10-20: Our own count of Sanity requests, on the Usage page, emails at 50%, 80% and on pace, a dev log of every
  read with its route and user agent, the club facts in one query, and live reads stopped at 90% of the CDN quota
  (#15, was 0116); the page's reads are one round trip.
- 2026-10-23: Each limit's level (70%, 90%) kept by the hourly check and said on the admins' Home, one line for the
  nearest, sent with the club so it's there on first paint (#148); push and email at those levels are #157. D1
  storage and Gmail sends aren't counted yet, so they aren't among them.
- 2026-10-24: ADR 0116 (Sanity requests counted) merged in.
