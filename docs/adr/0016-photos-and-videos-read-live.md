# 0016. Photos and videos are read live on the Worker: photos are the club's Instagram, videos its YouTube playlists

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-30
- **Merges:** 0015, 0019, 0039, 0040, 0113

## Context

[ADR 0004](0004-astro-workers-sanity-d1.md) has the site read Sanity at build time, and Studio changes reach
production at the daily rebuild. Photos and videos are what the club adds most often: albums from a phone straight
after a Friday or a Kumite, footage on YouTube. They should be on the site soon after they're published, with no build
and no CI run, and on free tiers ([ADR 0003](0003-free-tiers-only.md)).

The Friday videos are uploaded **unlisted**, which a channel's public uploads list doesn't include. The club keeps
them in playlists by kind (Friday Hockey, Kumite, and Website for anything else). YouTube has no playlist of
playlists. The YouTube Data API v3 is free up to 10,000 quota units a day per Google Cloud project; reading a
playlist costs two calls (2 units) per 50 videos: `playlistItems`, then `videos` (`part=status`) to hide videos still
processing.

Uploading through the app was planned and dropped: it needs a long-lived OAuth refresh token
that can post as the club, a consent screen, YouTube's API compliance audit (weeks; until then API uploads are locked
to Private), and about 1,600 quota units per upload. The YouTube app and Studio already do uploads well, on any phone.

The website's photos were albums in the Studio: an admin made an album, uploaded photos, captioned each and
published. Nobody did (production had no albums), while the club posts its photos on Instagram anyway. Two places to
put the same photos means one of them goes stale.

Instagram's simple read-only API (Basic Display) closed in December 2024. What's left for reading an account's own
posts is the Instagram API, through a Meta developer app and a Professional account (free). Meta's dashboard now
sets that app up with a business portfolio, and its tokens are a portfolio's system-user tokens, which never expire.
(It used to offer an Instagram Login token lasting 60 days, swapped weekly for a fresh one.)

## Decision

### Photos

**Admins manage the photos on Instagram; the website shows the newest photos.** Albums are gone from the Studio and
the site. Every photo is a tile of its own: a post with several photos gives one tile each, and videos are left out
(the website can't play them; the videos page is YouTube's). `/photos/` is a grid of the latest 48 photos, the home
page's strip the latest 12; each opens in the lightbox with its post's caption and a link to the post ("On
Instagram"), and the arrows step through the grid. An old album's address (`/photos/<album>/`, Wix's
`/gallery/<album>`) goes to `/photos/` (301).

**Read live, like the videos.** `lib/server/instagram.ts` reads `/me/media` behind the circuit breaker
([0055](0055-degrade-instead-of-break.md)), cached ([0053](0053-live-reads-are-cached.md)): fresh for ten minutes, so a post is on the site within ten minutes; the last
good copy for three days if Instagram fails. No posts and no copy: the friendly "won't load right now" state.
Instagram's rate limits pause it for an hour.

**Pictures through our Worker.** `/api/photos/<id>` fetches a post's picture from Instagram's servers and caches it
at the edge and in browsers for a week (a post's picture never changes). Only posts in the club's feed, only from
Instagram's own picture hosts (`cdninstagram.com`, `fbcdn.net`), so it can't be used to fetch anything else. An
expired picture address is asked for again. So visitors' browsers never contact Meta: the content security policy
and the privacy page are unchanged ([0036](0036-api-security.md)). Pictures come in one size (Instagram's 1080 px),
not resized.

**The home page stays prerendered.** Its build can't read Instagram (the token is a Worker secret, and the build has none), so the strip holds
twelve empty tiles and its script fills them from `/api/photos/latest`; nothing moves when they arrive. Without
JavaScript, a line points at Instagram.

**The token is the club's, and never expires.** `INSTAGRAM_TOKEN` in Bitwarden, one value for both environments (there's
no dev Instagram: dev and your machine show the club's real posts, [ADR 0010](0010-environments-and-deploys.md)), a Worker secret, read
by `lib/server/instagram-env.ts`:

- It's a **system user's** token in the club's Meta business portfolio, the portfolio that owns the Instagram
  account. A system user belongs to the portfolio, not a person, so the token outlives anyone leaving; the
  portfolio has more than one admin.
- The system user has the Meta app ("Develop app") and the Instagram account ("Content"), and the token only
  `instagram_basic`: it reads the club's own posts, which are public anyway, and can't post or reach messages.
- It's read through the Graph API (`graph.facebook.com`, `/<account>/media`), with the account's ID in
  `instagram-env.ts` (not a secret). No renewal, nothing in D1, no sealing key.
- If it's revoked or stops working, the feed fails like any Instagram failure: the last good copy for three days,
  and an error in Sentry. A new one is generated on the system user and set in Bitwarden, then a deploy.

**Without the token** (a checkout with no Bitwarden access, a PR preview), a sample feed
(`lib/server/instagram.fake.ts`, placeholder pictures from picsum) stands in anywhere but production
(`SITE_ENV` isn't `production`); production shows its empty state.

### Videos

**Sanity on the Worker.** Live reads query Sanity's API CDN (published perspective) with plain `fetch` in
`apps/web/src/lib/server/sanity-live.ts`; the GROQ stays in `queries.ts`, the types in `types.ts`. No token is needed
(Sanity Free has public datasets only); `SANITY_API_TOKEN` is sent if the Worker has it, so a private dataset would
only need that secret.

`/videos` renders on the Worker from YouTube and Sanity (`lib/server/videos.ts`).

- The source is **Club → YouTube playlists** in the Studio: a list of playlist links, each with an optional label
  (e.g. _Friday hockey_). Every playlist is read (unlisted videos included) and merged into one list; each video shows
  its label next to its date. A video in two playlists is listed once, under the first playlist. With no playlists
  set, the source is the channel's public uploads.
- Only videos YouTube has finished with show: after each page of a playlist, one `videos` call (`part=status`) keeps
  those whose `uploadStatus` is "processed", so one still uploading or processing (YouTube's grey placeholder) waits
  until it's ready. If that call fails, the last good list is shown, as for any YouTube failure.
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

**On the home page**, which stays prerendered: the photo strip fills itself from `/api/photos/latest` (above); the
video reel (`components/VideoReel.astro`) swaps in a live copy from `/videos/reel/`.

**Caching and failure.** Reads go through `lib/server/cache.ts` ([ADR 0053](0053-live-reads-are-cached.md)):
YouTube playlists fresh for 10 minutes, last good copy kept a day (the playlists are one cache entry, so one failed
call shows the last good list for all); Sanity videos fresh a minute, kept an hour. Pages send `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`. If a source can't be
reached and there's no good copy, the page shows a friendly "won't load right now" state (503, not cached), never an
error page ([ADR 0055](0055-degrade-instead-of-break.md)).

**Refresh photos and videos** (#109). For a video or post that should show now, not within ten minutes, an admin
(`edit:Content`) presses it in the team app's Settings → Website. The time goes in D1 (`website_times.media_refreshed`);
the website reads it through the cache for half a minute (`lib/server/media-refresh.ts`), and a YouTube or Instagram
copy read before it isn't fresh any more (`cache.ts` `freshAfter`), so the next visit in each data centre reads the
source again: on the site within a minute. The copy stays the last good one, so a press while YouTube or Instagram is
down still shows the old list. The cache keys don't change, and Cloudflare's purge can't reach the isolates' memory,
which is why it's a time and not a purge. Nothing pressed, the caches are as above. Sanity's videos are fresh for a
minute anyway.

Pages on the Worker can't use build-time image resizing (`imageService: "compile"`), so the shared layout's logo and
background are ready-sized files in `src/assets/`.

## Consequences

- An album or a Studio change to a video shows within about a minute; a new upload within about 10 minutes. The home
  strip's no-JavaScript fallback is as old as the last build.
- A new kind of video is a new playlist on YouTube and a new entry in the Studio, with no code change. Changing the
  list or a label starts a new cache entry, so it shows within a minute.
- Free-tier budget (checked 2026-10-05): Sanity Free allows 1M API CDN and 250k API requests a month, 100 GB of
  assets and 100 GB of bandwidth; Workers Free allows 100k requests a day; YouTube two calls per playlist (per 50
  videos: `playlistItems` and `videos`) every 10 minutes per data centre, against 10,000 units a day. A club site uses well under 1% of each.
  Images come from Sanity's image CDN, which counts against bandwidth.
- Photo and video pages depend on Instagram, Sanity and YouTube at view time, softened by the last good copy.
- No OAuth client, refresh token, consent screen or API audit. Uploading leaves the app, and the uploader picks the
  club channel and the playlist themselves. Giving someone upload access happens in YouTube Studio: ticking
  `upload:Video` alone only shows them the link.
- Rotating the YouTube key means updating Secrets Manager and deploying.

- Posting a photo on Instagram is the whole job; there's nothing to do in the Studio or the team app. Uploading
  photos from the team app (#52) isn't needed.
- The website's photos are only as good as the club's Instagram: no captions there, no captions here (alt text falls
  back to "A photo from the club's Instagram").
- One more outside account to keep: the Meta developer app, owned by the developer account (docs/accounts.md). If the
  token lapses (renewal failing for 60 days), a new one is a few clicks there, then `npm run secret:set`.
- Instagram can change or close this API too, as it did Basic Display. Then the site shows its empty state and links
  to Instagram, and we look again.
- Only the newest 48 posts are on the site; older ones are on Instagram.

## History

- 2026-10-05: Photo pages rendered on the Worker from Sanity's API CDN, an exception to build-time content (was 0016).
- 2026-10-05: Videos listed from the club channel's public uploads at build time, Sanity `video` documents as
  overrides, a daily rebuild to pick up uploads (was 0015).
- 2026-10-06: Videos read live on the Worker and cached, so an upload shows in minutes; a club playlist allows
  unlisted videos; the key becomes a Worker secret (was 0019).
- 2026-10-07: No in-app upload: contributors upload on YouTube and the app only links there (was 0039).
- 2026-10-07: Several labelled playlists replace the single club playlist (was 0040).
- 2026-10-07: Caching moved to the shared rules for every live read ([ADR 0053](0053-live-reads-are-cached.md)).
- 2026-10-20: The photos are the club's Instagram, read live; Studio albums and their pages removed; the token
  renews itself, sealed in D1 (#111, was 0113). The Sanity reading moved to `lib/server/sanity-live.ts`.
- 2026-10-24: A video still uploading or processing on YouTube is left out (it showed with YouTube's grey
  placeholder): after each page of the playlist, one `videos` call (`part=status`, per 50 videos, 1 unit) keeps only
  those whose `uploadStatus` is "processed", so YouTube costs two calls per 50 videos every 10 minutes. A video shows
  within the 10-minute cache of being ready; if that call fails, the last good list is shown, as for any YouTube
  failure.
- 2026-10-24: ADR 0113 (photos from Instagram) merged in.
- 2026-10-24: Refresh photos and videos in the team app's Settings → Website (#109): the website's YouTube and
  Instagram copies from before the press aren't fresh, so a new video or post shows within a minute; the last good copy
  is kept. One D1 read per half minute per data centre for the press's time.
- 2026-10-30: The Instagram token is the club portfolio's system-user token, read through the Graph API: it never
  expires, so the weekly renewal, the sealed copy in D1 and `INSTAGRAM_TOKEN_KEY` are gone. Meta's dashboard no longer
  offers the Instagram Login token, and a system user belongs to the club, not the person who set it up.
- 2026-10-30: The Instagram token is one value for both environments (plain `INSTAGRAM_TOKEN`): dev and your machine
  show the club's real posts, so photo changes can be seen locally; the sample feed is only for a checkout without it.
- 2026-10-30: Every photo is a tile of its own: a post with several gives one each, and Instagram videos are left out
  (no ▶ or 1/4 marks); the lightbox takes a photo's click before the page router, which had dimmed the page.
