# 0055. Degrade instead of break: circuit breakers, rate limits, the app's own brake and fallback content

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-21
- **Merges:** 0056, 0058

## Context

The website and the team app call three outside services on free plans: Sanity, YouTube and Gmail. When one said no
(Sanity's spent API quota, YouTube's spent daily quota), we kept asking on every request. Each request waited for the
refusal, logged an error, and for a quota kept it spent. Nothing told the person why.

Cloudflare's own free allowance is shared by the website and the team app on one account: 100,000 Worker requests a
day, and D1's 5 million rows read and 100,000 written a day, all reset at 00:00 UTC. Static files (prerendered pages,
the app's own files) are free and unlimited; every live route and `/api/*` call is a Worker request. A loop in a
script, a scraper or a stuck browser could spend it, and through the website the Sanity and YouTube quotas too.

Per-minute limits per address don't protect a day: one stuck tab at the team API's 600 a minute would spend the day's
requests in under three hours, and a request our Worker refuses has already run, so it still counts. Cloudflare's
free rate-limiting rule blocks before the Worker, but only on a custom domain (#57).

`astro dev` treated Sanity like a build: any failure, a spent quota included, was an error page.

## Decision

**Circuit breakers.** Every call to Sanity, YouTube and Gmail goes through `guard()` in `packages/shared/breaker.ts`.

- A quota or rate-limit answer pauses the service until it resets:

  | Service | Answer                                   | Paused until                 |
  | ------- | ---------------------------------------- | ---------------------------- |
  | Sanity  | 402 (plan quota spent)                   | an hour, then try again      |
  | Sanity  | 90% of the month's CDN requests (ours)   | the 1st, 00:00 UTC (0116)    |
  | Sanity  | 429                                      | Retry-After, else a minute   |
  | YouTube | 403 `quotaExceeded`/`dailyLimitExceeded` | midnight Pacific (its reset) |
  | YouTube | 429 or a rate-limit reason               | Retry-After, else a minute   |
  | Gmail   | 429 or a rate/sending-limit reason       | Retry-After, else 15 minutes |

- Three failures in a row (network, timeout, 5xx) pause it for 30 seconds, doubling each time the trial call after a
  pause fails too, up to 15 minutes. Another 4xx is our mistake and doesn't count.
- The pause is kept in memory and in the Workers Cache API, so every isolate in a data centre sees it. Best effort,
  like the rate limits; it's free.
- While paused, callers fall back as for any failure: the website shows the last good copy
  ([0053](0053-live-reads-are-cached.md)) or its empty state; sign-in says "Email isn't sending right now" at once, the
  same for members and strangers, instead of promising a code that can't come. A pause is logged once
  (`breaker.open`), not on every request.

**Rate limits on every live route and API**, through `packages/shared/rate-limit.ts` (Workers Cache API: free, per data centre,
best effort, not a security boundary).

- The website limits each address to 240 live requests a minute (`src/middleware.ts`). Prerendered pages are static
  assets and never reach the Worker.
- The team app's limits live in `apps/team/worker/api/api.limits.ts`:

  | What                      | Limit                    |
  | ------------------------- | ------------------------ |
  | Any `/api` request        | 600 a minute per address |
  | A change (not a GET)      | 60 a minute per member   |
  | Asking for a sign-in code | 10 per 10 minutes        |
  | The join form             | 5 an hour                |

  Per address is generous because a whole squad on the rink's wifi shares one.

- Over a limit, the answer is a 429 (JSON) with a plain sentence saying to wait.

**What one member can spend** (#73), beyond those limits, because a signed-in member or a stolen session gets past
the per-address ones:

- **Live streams**: at most 3 per member at the hub ([0072](0072-live-updates.md)); a fourth closes their oldest.
- **Refusals** (a request their role can't make, [0024](0024-action-based-authorization.md)): on the audit log at
  most once a minute per member (one statement: a write only when there's none in the last minute, read through the
  `at` index), so looping on an admin route writes at most 1,440 rows a day, not one per request. Every refusal is a
  `refused` warning in Workers Logs (free, no D1 write); warnings don't go to Sentry, so it isn't flooded either. Once
  a minute per member, not per route as #73 first said: per route, a script over the app's admin routes could still
  write tens of thousands of rows a day.
- **Request bodies**: refused with a 413 before anything parses them, counted as they arrive (a `Content-Length`
  over the limit isn't read at all). 1 MB for any route (`MAX_BODY`, `api.http.ts`), 2 MB for Import members, 4 MB
  for a tournament with its teams' logos (`maxBody` on the route), 16 KB for sign-in's routes and 256 KB for the app's
  error reports.

**The team app brakes itself** (`apps/team/src/app/brake.ts`). Every call to the Worker goes through it:

- Background checks for others' changes (live pages, catching up when you come back to the app) wait after a failure:
  10 s, doubling, up to 5 minutes; a success puts them back. A 403 or 409 isn't the server failing.
- One tab makes at most 3,000 calls a UTC day; past that it says it has paused itself.
- Cloudflare's error 1027 (the day's Worker requests are used up) rests the tab until midnight UTC, and the app says
  when it's back in London time ("Back soon"), instead of "Can't reach the club's data".
- Any other 429 that isn't ours (ours are JSON and say why), such as a challenge, slows background checks for a
  minute, as our own per-minute limit does.
- How often live pages check, and their push stream, are in [0072](0072-live-updates.md); the brake has the last word
  over both.

**`astro dev` renders with fallback content** when Sanity can't be read, with a banner saying why. Builds still fail
loudly, so a broken deploy never replaces the live site; live server routes already fall back.

## Consequences

- A spent quota costs one refused call, not one per page view, and recovers on its own when the quota resets. Pages
  don't wait on a service that's down.
- A pause can outlast a fix by up to its length (15 minutes for Gmail, an hour for Sanity's quota). A deploy starts new
  isolates, but the Cache API copy remains until it expires.
- One misbehaving client can't use up the club's free quotas: a tab that's gone wrong costs at most 3,000 requests a
  day, not the club's 100,000.
- After an outage, the app's background checks come back within five minutes, not instantly.
- The Cache API only works on a custom domain; on `*.workers.dev` the rate limits and the shared pause do nothing.
- Not atomic: a burst can go slightly over a limit. Cloudflare's own rate limiting would be exact, but its free-plan
  terms haven't been checked; this costs nothing.
- Still to do: Cloudflare's free rate-limiting rule once there's a custom domain (#57). The daily allowance is watched
  on the Usage page ([0059](0059-usage-page-and-check.md)).

## History

- 2026-10-07: Sanity, YouTube and Gmail put behind circuit breakers in `shared/breaker.ts` (was 0055).
- 2026-10-07: Every live route and API rate limited, beyond sign-in and the join form (was 0056).
- 2026-10-07: The team app's own brake (3,000 calls a tab a day, back-off, error 1027), the Draft page checking every
  10 seconds on draft day, and fallback content in `astro dev` (was 0058).
- 2026-10-08: The Draft page's fixed 10 seconds became the admins' live-update setting (ADR 0072).
- 2026-10-09: Live pages pushed to over SSE; reconnecting goes through the brake (ADR 0072).
- 2026-10-20: The website's Sanity reads pause until the 1st at 90% of the month's CDN requests, by our own count, so
  builds keep the rest; a server route falls back to the club facts it last read (ADR 0116).
- 2026-10-21: What one member can spend: three live streams, a refusal on the record once a minute, and request bodies
  capped before they're parsed (#73).
