# Failures and secrets

The go-live pass on failures and secrets (#181, "Failures and secrets"; #148 section 2 item 2 and section 3 item 2),
2026-11-02. Every place the servers catch a failure, checked for whether it reaches Sentry; every way a secret or a
member's details could reach a log, a Sentry event or a reply; and docs/secrets.md against what Bitwarden holds. The
rules are [ADR 0110](../adr/0110-structured-logging.md); the browser side of the team app was checked on 2026-10-24.

## Every caught failure: reported, or says why not

About 137 places in `apps/team/worker`, `apps/web/src` and `packages/shared` catch an error or log a warning. Most
were already right after the 2026-10-23 pass: an `error` line is reported (scribe's reporter, `scribe.sentry.ts`),
and each warning says why it isn't. What changed:

- **Production without Gmail** (`packages/shared/email.ts`): a mail with no credentials was only an info line,
  `mail.logged`, with its whole text, so in production an enquiry or a sign-in code that never went was heard of by
  nobody, and the log kept an enquirer's name, phone and message. Now in production it's an error,
  `mail.unconfigured`, reported, with who it was for and its subject only. Elsewhere it logs as before (codes
  redacted).
- **The club's address unreadable** (`packages/shared/club-contact.ts`): Sanity failing was swallowed with no line at
  all. Now a warning, `club_contact.unreadable`, saying why it isn't reported (email still goes, as the sending
  account; the website's Sanity reads report an outage).
- **Quiet catches that now say why:** the team Worker's edge cache read (`api.edge.ts`), the Sentry tunnel's
  forward (`sentry-tunnel.ts`: Sentry not answering is nothing an error line could tell it), a page stream the
  visitor left (`middleware.ts`), the media refresh time unreadable (`media-refresh.ts`), the build's Sanity count
  (`count.integration.ts`: the build has no reporter), a player card's refresh in the browser (`scripts/cards.ts`).
- **A use case** (`mail.use-cases.test.ts`): a sign-in code Gmail refuses is reported (`sign_in.code_failed`), with
  nothing of the member's address, the code or the tokens in the report.

Left as they are, on purpose: rate limits, Turnstile and passkey refusals, the audit's `refused`, cache-stale and
breaker-paused reads, the hourly run's retries (each job reports its own failure), a backup's export
(`cron.exporting`), Settings → Errors failing to reach Sentry, and the live hub's `/end`: each a warning with its
reason beside it. Parsing user input (`JSON.parse` of a body or a file) answers 400 and isn't logged.

## No secret in logs, Sentry or replies

- **Logs and Sentry** are cleaned by `clean()` in `scribe.ts`, which Sentry's `beforeSend` uses too: secrets and
  phones by key, email addresses masked. Gap found: a secret in running text (an error message or a stack quoting an
  address with `access_token=` or `key=`, a `Bearer` header, a JWT) went through as it was. `mask()` now redacts
  those too, so every log line, every Sentry event and Settings → Errors' titles are covered (tests in
  `scribe.test.ts`). No such message was found in today's code (YouTube's and Instagram's errors already leave the
  address out); this is the net under them.
- **Sentry's own collection** is off for bodies, cookies, headers, query strings, SQL values and stack variables
  (`DATA_COLLECTION`); its fetch breadcrumbs drop query strings by that setting, and its D1 breadcrumbs carry the SQL
  with `?` placeholders, never values.
- **Replies** only ever carry an `HttpError`'s own words; anything else is "Something went wrong." with a 500. The
  one reply naming another member ("X already has that email") is an admin's. A test email's refusal goes back to
  the admin who sent it.
- **Personal data in warnings**: the website's rate-limit warning logs the visitor's IP (`rate_limit.live`), to see
  a flood; it stays in Workers Logs (warnings aren't reported). Kept: a short log is the legitimate use.

## Tokens and docs/secrets.md

`npm run secrets` (names only) for dev and production, and the raw names in both projects, compared with
docs/secrets.md and `scripts/lib/settings.mjs`. Docs fixed:

- `SANITY_CONTENT_TOKEN__DEV` isn't in Bitwarden: marked "not set yet" (dev Sanity refuses writes until its quota
  resets).
- `INSTAGRAM_TOKEN__PRODUCTION` (wins in production) and `INSTAGRAM_TOKEN_KEY__PRODUCTION` (read by nothing) are in
  Bitwarden though the docs said one value: listed, with what should happen to them.
- Bitwarden still holds old copies of the committed settings (`APPLE_TEAM_ID`, `APP_STORE_CONNECT_KEY_ID`,
  `APP_STORE_CONNECT_ISSUER_ID`, `CLOUDFLARE_ACCOUNT_ID__DEV`, `CLOUDFLARE_ACCOUNT_ID__PRODUCTION`,
  `SENTRY_DSN_TEAM`), which `npm run secrets` hides: noted under Plain settings, to delete.
- `WEB_ANALYTICS_TOKEN` (public, `deploy.yml`) added to the plain values.

What each token may do, as the docs say it:

| Token                                    | Scopes in the docs                                | Wider than needed?                                                                                                               |
| ---------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `BWS_ACCESS_TOKEN__PRODUCTION` / `__DEV` | yes (projects, read)                              | no                                                                                                                               |
| `COUGARS_LOCAL_BW_TOKEN`                 | yes (read, write both)                            | writes production from a laptop; chosen so setup runs from the shell                                                             |
| `CLOUDFLARE_API_TOKEN__PRODUCTION`       | yes (table)                                       | **Workers Editor is redundant** beside Workers Admin; Access Write goes at launch                                                |
| `CLOUDFLARE_API_TOKEN__DEV`              | yes                                               | no                                                                                                                               |
| `CLOUDFLARE_ANALYTICS_TOKEN__*`          | yes (Account Analytics Read; dev + Observability) | no                                                                                                                               |
| `SENTRY_AUTH_TOKEN`                      | yes                                               | **yes**: CI holds Project Admin, Team and Alerts write for what only needs Release Admin (source maps); split setup from deploys |
| `SENTRY_ISSUES_TOKEN`                    | yes (`event:read`)                                | no (not made yet)                                                                                                                |
| `GMAIL_REFRESH_TOKEN`, Web client        | yes (`gmail.send`)                                | no                                                                                                                               |
| `FIREBASE_SERVICE_ACCOUNT`               | yes (FCM API Admin)                               | no                                                                                                                               |
| `APP_STORE_CONNECT_KEY`                  | yes (App Manager)                                 | no: listing changes need it                                                                                                      |
| `GITHUB_APP_PRIVATE_KEY`                 | yes (Actions read/write)                          | can delete runs and old backup artifacts; said so in the docs                                                                    |
| `SANITY_DEPLOY_TOKEN__PRODUCTION`        | yes (Deploy Studio)                               | no                                                                                                                               |
| `SANITY_CONTENT_TOKEN__*`                | yes (Editor)                                      | write, until launch, then deleted                                                                                                |
| `INSTAGRAM_TOKEN`                        | yes (`instagram_basic`)                           | no                                                                                                                               |
| `YOUTUBE_API_KEY__PRODUCTION`            | yes (YouTube Data API v3 only)                    | no                                                                                                                               |
| `YOUTUBE_API_KEY__DEV`                   | **no**                                            | check it's restricted to the YouTube Data API v3 like production's                                                               |
| `CF_ACCESS_CLIENT_*__PRODUCTION`         | a service token for the one Access app            | goes at launch                                                                                                                   |

For the owner (Bitwarden and the providers, not changed here): delete the six old setting copies; fold the
Instagram token into the plain `INSTAGRAM_TOKEN` and delete both `__PRODUCTION` entries once the system-user code is
live; make `SENTRY_ISSUES_TOKEN` and `SANITY_CONTENT_TOKEN__DEV`; drop Workers Editor from production's Cloudflare
token; split `SENTRY_AUTH_TOKEN` (a CI token with Release Admin and Organization Read only); restrict the dev YouTube
key.
