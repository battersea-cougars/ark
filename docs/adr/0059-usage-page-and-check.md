# 0059. Admins see the free Cloudflare allowance and CPU time, and are emailed at 80% or a stopped request

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-23
- **Merges:** 0063

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

## Decision

- **Settings → Security → Usage** (`read:Usage`; admins have it through `manage:all`) shows, against the free limits,
  today's Worker requests, D1 rows read and rows written, the live hub's Durable Object requests and duration (GB-s),
  and when they reset in London time. It also shows each Worker's CPU time per request today: typical (p50) and the
  slowest 1 in 100 (p99), against 10 ms, and how many requests were stopped for going over. The live-update pace
  setting sits beside it ([0072](0072-live-updates.md)). Below, this month's Sanity requests as we count them, with
  their own monthly emails ([0116](0116-sanity-requests-counted.md)).
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
  Sanity's usage isn't readable through its API, so the page shows our own count (ADR 0116).

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
- 2026-10-20: Sanity's month on the page and in the hourly check, from our own count (ADR 0116); the page's reads are
  one round trip.
- 2026-10-23: Each limit's level (70%, 90%) kept by the hourly check and said on the admins' Home, one line for the
  nearest, sent with the club so it's there on first paint (#148); push and email at those levels are #157. D1 storage and Gmail sends aren't counted yet, so they
  aren't among them.
