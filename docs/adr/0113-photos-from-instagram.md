# 0113. The website's photos are the club's Instagram, read live, with a token that renews itself sealed in D1

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The website's photos were albums in the Studio: an admin made an album, uploaded photos, captioned each and
published. Nobody did (production had no albums), while the club posts its photos on Instagram anyway. Two places to
put the same photos means one of them goes stale.

Instagram's simple read-only API (Basic Display) closed in December 2024. What's left for reading an account's own
posts is the Instagram API with Instagram Login: a Professional account (free), a Meta developer app, and a token
that lasts 60 days. One call with the current token returns a fresh one, no sign-in, as long as it's done before
the 60 days are up.

## Decision

**Admins manage the photos on Instagram; the website shows the newest posts.** Albums are gone from the Studio and
the site. `/photos/` is a grid of the latest 48 posts, the home page's strip the latest 12; each opens in the
lightbox with its caption and a link to the post ("Watch it on Instagram" for a video, "All 4 on Instagram" for an
album, whose first photo is shown). An old album's address (`/photos/<album>/`, Wix's `/gallery/<album>`) goes to
`/photos/` (301).

**Read live, like the videos ([0016](0016-photos-and-videos-read-live.md)).** `lib/server/instagram.ts` reads
`/me/media` behind the circuit breaker ([0055](0055-degrade-instead-of-break.md)), cached
([0053](0053-live-reads-are-cached.md)): fresh for ten minutes, so a post is on the site within ten minutes; the last
good copy for three days if Instagram fails. No posts and no copy: the friendly "won't load right now" state.
Instagram's rate limits pause it for an hour.

**Pictures through our Worker.** `/api/photos/<id>` fetches a post's picture from Instagram's servers and caches it
at the edge and in browsers for a week (a post's picture never changes). Only posts in the club's feed, only from
Instagram's own picture hosts (`cdninstagram.com`, `fbcdn.net`), so it can't be used to fetch anything else. An
expired picture address is asked for again. So visitors' browsers never contact Meta: the content security policy
and the privacy page are unchanged ([0036](0036-api-security.md)). Pictures come in one size (Instagram's 1080 px),
not resized.

**The home page stays prerendered.** Its build can't read Instagram (the token lives in D1), so the strip holds
twelve empty tiles and its script fills them from `/api/photos/latest`; nothing moves when they arrive. Without
JavaScript, a line points at Instagram.

**The token renews itself** (`lib/server/instagram-token.ts`):

- The first token is `INSTAGRAM_TOKEN__PRODUCTION` in Bitwarden, a Worker secret.
- The website's daily cron (`src/worker.ts`) renews it once a week and keeps the new one in D1, table
  `sealed_tokens`, the one exception to secrets living only in Bitwarden ([0002](0002-secrets-in-bitwarden.md)):
  nothing that runs by itself can write to Bitwarden.
- **Sealed in the Worker** before it's written: AES-GCM (Web Crypto) with `INSTAGRAM_TOKEN_KEY__PRODUCTION`
  (32 random bytes, a Worker secret of its own: one key, one job, never `BACKUP_KEY`), the row's name bound in as
  associated data. D1's own encryption at rest only protects Cloudflare's disks; this keeps the token from anyone who
  can query the database or read an export or backup. Changed, or moved to another row, it won't open.
- If it won't open, the Bitwarden token is used and an error is logged. A refused renewal is an error with the days
  left. Errors reach Sentry, whose alert emails ([0111](0111-errors-and-uptime.md)). The token is never logged.
- What the token can do is read the club's own posts, which are public anyway: it can't post or reach messages. A
  leak is revoked in the Meta app.

**Before the club connects Instagram**, a sample feed (`lib/server/instagram.fake.ts`, placeholder pictures from
picsum) stands in on a laptop, dev and PR previews (`SITE_ENV` isn't `production`); production shows its empty state.

## Consequences

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

- 2026-10-20: The photos are the club's Instagram, read live; Studio albums removed; the token renews itself, sealed
  in D1 (#111).
