# 0016. Photos and videos are read live on the Worker; videos are uploaded on YouTube, into labelled playlists

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-20
- **Merges:** 0015, 0019, 0039, 0040

## Context

[ADR 0004](0004-astro-workers-sanity-d1.md) has the site read Sanity at build time, and Studio changes reach
production at the daily rebuild. Photos and videos are what the club adds most often: albums from a phone straight
after a Friday or a Kumite, footage on YouTube. They should be on the site soon after they're published, with no build
and no CI run, and on free tiers ([ADR 0003](0003-free-tiers-only.md)).

The Friday videos are uploaded **unlisted**, which a channel's public uploads list doesn't include. The club keeps
them in playlists by kind (Friday Hockey, Kumite, and Website for anything else). YouTube has no playlist of
playlists. The YouTube Data API v3 is free up to 10,000 quota units a day per Google Cloud project; listing a
playlist costs 1 unit per 50 videos.

Uploading through the app was planned and dropped: it needs a long-lived OAuth refresh token
that can post as the club, a consent screen, YouTube's API compliance audit (weeks; until then API uploads are locked
to Private), and about 1,600 quota units per upload. The YouTube app and Studio already do uploads well, on any phone.

## Decision

**Photos** are the club's Instagram, read live the same way: [ADR 0113](0113-photos-from-instagram.md).

**Sanity on the Worker.** Live reads query Sanity's API CDN (published perspective) with plain `fetch` in
`apps/web/src/lib/server/sanity-live.ts`; the GROQ stays in `queries.ts`, the types in `types.ts`. No token is needed
(Sanity Free has public datasets only); `SANITY_API_TOKEN` is sent if the Worker has it, so a private dataset would
only need that secret.

**Videos.** `/videos` renders on the Worker from YouTube and Sanity (`lib/server/videos.ts`).

- The source is **Club → YouTube playlists** in the Studio: a list of playlist links, each with an optional label
  (e.g. _Friday hockey_). Every playlist is read (unlisted videos included) and merged into one list; each video shows
  its label next to its date. A video in two playlists is listed once, under the first playlist. With no playlists
  set, the source is the channel's public uploads.
- Sanity `video` documents are optional overrides, matched by YouTube id: a filled-in title, date or description
  replaces YouTube's, _Hide from the website_ drops it, _Show first_ pins it. A document whose video isn't in the
  source adds it. They don't change the label. Order: pinned first, then newest. The date is the London day.
- `YOUTUBE_API_KEY` is a read-only Worker secret, pushed from Secrets Manager by `deploy.yml` on every deploy
  ([docs/secrets.md#youtube](../secrets.md#youtube)). It never reaches the browser. Without it, the site shows the Sanity
  videos only.

**Uploading videos happens on YouTube, not in the app.** The team app's Upload shows people with `upload:Video`
([ADR 0024](0024-action-based-authorization.md)) a link to YouTube's upload page and says which playlist to use.
They upload signed in with their own Google account, as the club channel, Unlisted, into exactly one playlist. Who
can upload is YouTube's channel permissions (Editor or above), managed by the club account. The app holds no YouTube
credential that can write.

**On the home page**, which stays prerendered: the photo strip fills itself from `/api/photos/latest` (ADR 0113); the
video reel (`components/VideoReel.astro`) swaps in a live copy
from `/videos/reel/`.

**Caching and failure.** Reads go through `lib/server/cache.ts` ([ADR 0053](0053-live-reads-are-cached.md)):
YouTube playlists fresh for 10 minutes, last good copy kept a day (the playlists are one cache entry, so one failed
call shows the last good list for all); Sanity videos fresh a minute, kept an hour. Pages send `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`. If a source can't be
reached and there's no good copy, the page shows a friendly "won't load right now" state (503, not cached), never an
error page ([ADR 0055](0055-degrade-instead-of-break.md)).

Pages on the Worker can't use build-time image resizing (`imageService: "compile"`), so the shared layout's logo and
background are ready-sized files in `src/assets/`.

## Consequences

- An album or a Studio change to a video shows within about a minute; a new upload within about 10 minutes. The home
  strip's no-JavaScript fallback is as old as the last build.
- A new kind of video is a new playlist on YouTube and a new entry in the Studio, with no code change. Changing the
  list or a label starts a new cache entry, so it shows within a minute.
- Free-tier budget (checked 2026-10-05): Sanity Free allows 1M API CDN and 250k API requests a month, 100 GB of
  assets and 100 GB of bandwidth; Workers Free allows 100k requests a day; YouTube one call per playlist (per 50
  videos) every 10 minutes per data centre, against 10,000 units a day. A club site uses well under 1% of each.
  Images come from Sanity's image CDN, which counts against bandwidth.
- Photo and video pages depend on Sanity and YouTube at view time, softened by the last good copy.
- No OAuth client, refresh token, consent screen or API audit. Uploading leaves the app, and the uploader picks the
  club channel and the playlist themselves. Giving someone upload access happens in YouTube Studio: ticking
  `upload:Video` alone only shows them the link.
- Rotating the YouTube key means updating Secrets Manager and deploying.

## History

- 2026-10-05: Photo pages rendered on the Worker from Sanity's API CDN, an exception to build-time content (was 0016).
- 2026-10-05: Videos listed from the club channel's public uploads at build time, Sanity `video` documents as
  overrides, a daily rebuild to pick up uploads (was 0015).
- 2026-10-06: Videos read live on the Worker and cached, so an upload shows in minutes; a club playlist allows
  unlisted videos; the key becomes a Worker secret (was 0019).
- 2026-10-07: No in-app upload: contributors upload on YouTube and the app only links there (was 0039).
- 2026-10-07: Several labelled playlists replace the single club playlist (was 0040).
- 2026-10-07: Caching moved to the shared rules for every live read ([ADR 0053](0053-live-reads-are-cached.md)).
- 2026-10-20: Photos are the club's Instagram now ([ADR 0113](0113-photos-from-instagram.md)); Studio albums and
  their pages are gone, and the Sanity reading moved to `lib/server/sanity-live.ts`.
