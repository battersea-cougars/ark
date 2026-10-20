# 0116. We count our own Sanity requests, show them on the Usage page, warn before a quota runs out, and save the last tenth for builds

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

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

**The Usage page** (Settings → Security → Usage, ADR 0059) shows this month's count for the environment's project, API
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

- 2026-10-20: Our own count of Sanity requests, on the Usage page, emails at 50%, 80% and on pace, a dev log of every
  read with its route and user agent, the club facts in one query, and live reads stopped at 90% of the CDN quota
  (#15).
