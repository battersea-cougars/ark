# 0016. How the website gets its data: photos, videos and the agenda read live on the Worker; the roster and results built in from D1

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-11-02
- **Merges:** 0015, 0019, 0039, 0040, 0042, 0043, 0045, 0062, 0085, 0100, 0113

## Context

The site reads Sanity at build time and production rebuilds daily ([ADR 0004](0004-astro-workers-sanity-d1.md)). Some
of what it shows changes faster than that: photos (the club posts them on Instagram), videos (on YouTube, Friday's
unlisted, in playlists by kind) and the club's calendar, which lives in D1 and is kept in the team app. Other things
change rarely but live in D1, not Sanity: the roster (personal data, never in the repo,
[ADR 0029](0029-personal-data.md)), tournament results and the Kumite's awards.

Reading D1 live on every visit would make each view a Worker request, and the website and the team app share one
account's 100,000 a day: a bot on the website could stop the team app. Writing D1's data into Sanity would make two
copies, with names that stop following what each player chose.

## Decision

**Read live on the Worker, cached, degrading to the last good copy**: photos, videos and the agenda. Each read goes
through `lib/server/cache.ts` and the circuit breaker ([ADR 0053](0053-how-the-team-app-gets-its-data.md),
[ADR 0055](0055-degrade-instead-of-break.md)); with no source and no good copy a page shows a friendly "won't load
right now" (503, not cached), never an error page. The home page stays prerendered and its script swaps in the live
parts (`/api/photos/latest`, `/videos/reel/`, `/whats-on/`), with nothing moving when they arrive.

- **Photos are the club's Instagram**, read through the Graph API (`lib/server/instagram.ts`) with a system user's
  token in the club's Meta business portfolio: it never expires, outlives anyone leaving, and can only read the club's
  own posts (`instagram_basic`). It's `INSTAGRAM_TOKEN`, one value for both environments (there's no dev Instagram).
  Fresh ten minutes, the last good copy three days. **Pictures come through our Worker**
  (`/api/photos/<id>`), only for posts in the club's feed and only from Instagram's own hosts, cached a week, so
  visitors' browsers never contact Meta and the CSP and privacy page stay as they are. Without the token, outside
  production, a sample feed stands in.
- **Videos are YouTube's**, from the playlists listed in the Studio (Club → YouTube playlists), unlisted ones
  included, with Sanity `video` documents as optional overrides (`lib/server/videos.ts`). `YOUTUBE_API_KEY` is a
  read-only Worker secret; without it the site shows the Sanity videos only. Live Sanity reads are plain `fetch` on
  the API CDN (`lib/server/sanity-live.ts`), no token. **Uploading happens on YouTube, not in the app**: the team app
  links to YouTube's upload page and holds no credential that can write (no OAuth client, consent screen or API
  audit).
- **The agenda is one D1 table, `agenda`**: one row per thing on a day (a training session, a tournament's day, its
  draft night and sign-up deadline, a one-off event), with its time, place, public, cancelled and who it's for. Every
  change pushes its own rows (`packages/shared/agenda.ts`), where the rules live once; an empty agenda fills itself on
  the first read. The website's What's on and `/events` read its public rows live; the team app's bootstrap gets an
  `agenda` part, and a route that can't move anything on it says `calendar: false` so it isn't read again.
- **Refresh photos and videos** in the team app's Settings → Website writes a time to D1 (`website_times`) that makes
  any copy read before it stale (`cache.ts` `freshAfter`): Cloudflare's purge can't reach the isolates' memory, so
  it's a time, not a purge.

**Built in from D1 at build time, rebuilt when it changes**: the roster, results and the Kumite's awards.

- `scripts/club-snapshot.mjs` runs before `astro dev` and `astro build` and reads the environment's D1 (the local D1
  on a laptop; in CI, the D1 API) into gitignored JSON: the active Cougars (`roster-sql.mjs`), every public, done
  tournament (`results-sql.mjs`) and the Kumite's awards. If it can't read the database, the site falls back to
  samples; a build never fails on it.
- **Only what the website shows leaves the database**: a member's chosen name (else first name and initial; a full
  name never reaches a page), position, bio and stats. Picking up a card reads `/api/players/<id>` live, cached a
  minute, so a changed name shows without a rebuild.
- **One rule set**: the table, the champion and "done" live in `@cougars/shared/results`, used by the Worker, the app
  and the website, so they can't disagree. Results are static pages; nothing is written to Sanity.
- **A changed result rebuilds the website.** A change through the team app's API to a done tournament marks a
  rebuild wanted (`website_rebuild`); a five-minute cron sends it after five quiet minutes, so a results day is one
  rebuild. It's sent as the club's GitHub App, **Cougars rebuilds**, owned by the organisation, which runs
  `deploy.yml` for the website (`workflow_dispatch`) from the environment's branch; each token it takes can start
  workflows and nothing else, so a leaked key can't push code. Rebuild now (Settings → Website) sends the same at once.

What the site shows from all this (which photos, which trainings, the results page, names) is in
[the website notes](../../apps/web/src/README.md) and [the team app's website notes](../../apps/team/worker/website/README.md).

## Consequences

- A post or a video is on the site within ten minutes, a change on the calendar within a minute, with no publish or
  rebuild; Refresh makes it a minute. Photo and video pages depend on Instagram and YouTube at view time, softened by
  the last good copy.
- The website and the app can't disagree about what's on. A write path that forgets to push leaves the agenda stale,
  so each one is covered by a use-case test.
- Results and the roster cost nothing per view and can't use up the account's Worker requests; if D1 is down the
  pages still show the last build. A result is on the website about ten minutes after the last change.
- One more secret (the GitHub App's key) on the team Worker, one more outside account (the Meta app). Instagram can
  change or close its API, as it did Basic Display; then the site shows its empty state and links to Instagram.
- Future training sessions exist only once the team app has made them, 12 weeks ahead.
- Two calendars until the rest moves over: past event pages and the Kumite poster still come from Sanity `event`
  documents.
