# Battersea Cougars

Website and team app for the Battersea Cougars inline hockey club: two projects in one repo
([ADR 0006](docs/adr/0006-one-repo-two-projects.md)). The website is live; the team app is next. What's planned is in
[GitHub milestones](https://github.com/battersea-cougars/ark/milestones).

| Part          | What                                                                      | Where                 |
| ------------- | ------------------------------------------------------------------------- | --------------------- |
| `apps/web`    | Public website: Astro, deployed as a Cloudflare Worker with static assets | http://localhost:4500 |
| `apps/studio` | Sanity Studio, where the club edits content                               | http://localhost:4520 |
| `db/`         | D1 (SQLite) migrations                                                    |                       |
| `shared/`     | Code used by more than one app (D1 helpers, test fixtures)                |                       |
| `scripts/`    | Secrets loading (Bitwarden) and CI helpers                                |                       |
| `apps/team`   | Team app: mobile-first Svelte PWA (clickable demo shell for now)          | http://localhost:4510 |

Running cost is £0: every service is on a free tier (see [ADR 0003](docs/adr/0003-free-tiers-only.md)).

## Quick start

```sh
npm ci
npm run db:rebuild:local   # create the local D1 database (db/schema.sql + the club seed)
npm run db:seed:local      # a made-up club to work with (db/seed/roster.example.json), its admin Ada Admin
npm run dev                # the website, http://localhost:4500 (through the show switch, see Worktrees)
npm run team               # the team app, http://localhost:4510 (sign in as admin@example.com: the code shows on screen)
npm test
```

A clean clone needs nothing else: no private files. The website's `apps/web/src/data/*.local.json` are made from the
local database by every build, and `db/seed/roster.local.json` (your own roster) is optional.

To preview the design with sample events, videos, photos and players: `DEMO_CONTENT=true npm run dev`.

The site builds and runs **without Sanity**: until a Sanity project is configured, it uses the club copy in
`apps/web/src/lib/sanity/fallback.ts` and shows empty states for videos, photos and events.

With secrets (run `bw-unlock` first, see [Bitwarden tokens](#bitwarden-tokens)):

```sh
npm run secrets                             # list secret names (never values)
npm run app restart                         # the apps pick up dev secrets once Bitwarden is unlocked
```

## Secrets

Each secret, below. Which service and account each comes from, service by service: [docs/accounts.md](docs/accounts.md).

Rules ([ADR 0002](docs/adr/0002-secrets-in-bitwarden.md), [ADR 0010](docs/adr/0010-environments-and-deploys.md)):

- Every secret lives in **Bitwarden Secrets Manager** and nowhere else. GitHub holds only the Bitwarden tokens
  (one per GitHub environment). There are no secret files; `.env` is for local, non-secret overrides
  ([.env.example](.env.example)).
- **Two environments.** Production (Cloudflare account **Cougars**) and dev (account **Cougars Dev**). Your
  machine, PR previews and `scripts/deploy-dev.sh` are dev.
- **Two Sanity projects** to match: **Cougars** (`ah165efl`, production) and **Cougars Dev** (`zmg6rbe3`), each
  with one public `production` dataset ([ADR 0010](docs/adr/0010-environments-and-deploys.md)). Their IDs aren't
  secret (`packages/shared/sanity.ts`), and public datasets need no read token.
- **Naming:** `NAME` applies to both; `NAME__PRODUCTION` / `NAME__DEV` override it for one. Code reads `NAME`.
  Production values sit in the Secrets Manager project `cougars`; dev and shared values in `cougars-dev`. Every
  app shares these two projects ([ADR 0002](docs/adr/0002-secrets-in-bitwarden.md)); _Used by_ says which app
  needs a secret.
- **A token is named exactly like its secret** at the provider that issued it.
- **Never in this public repo:** a value, or anyone's email address or phone number; name accounts by role ("the
  club account", "the developer account"). What's safe to write: [docs/accounts.md](docs/accounts.md#writing-about-accounts-in-this-repo).
- **Every secret has an entry below.** Adding one: create the token with its secret name, add it to Secrets
  Manager with `npm run secret:set NAME` (hidden prompt; it picks the project from the name), add it here.

| Secret                                                                    | Project       | Issued by                   | Used by                                   |
| ------------------------------------------------------------------------- | ------------- | --------------------------- | ----------------------------------------- |
| [`BWS_ACCESS_TOKEN__PRODUCTION`](#bitwarden-tokens)                       | (GitHub)      | Bitwarden, `cougars-ci`     | Production deploys                        |
| [`BWS_ACCESS_TOKEN__DEV`](#bitwarden-tokens)                              | (GitHub)      | Bitwarden, `cougars-ci-dev` | PR previews                               |
| [`COUGARS_LOCAL_BW_TOKEN`](#bitwarden-tokens)                             | (your vault)  | Bitwarden, `cougars-local`  | Your machine                              |
| [`CLOUDFLARE_API_TOKEN__PRODUCTION`](#cloudflare_api_token__production)   | `cougars`     | Cloudflare, Cougars         | Production deploys                        |
| [`CLOUDFLARE_ACCOUNT_ID__PRODUCTION`](#cloudflare_account_id__production) | `cougars`     | Cloudflare, Cougars         | Production deploys                        |
| [`CLOUDFLARE_API_TOKEN__DEV`](#cloudflare_api_token__dev)                 | `cougars-dev` | Cloudflare, Cougars Dev     | PR previews, `deploy-dev.sh`              |
| [`CLOUDFLARE_ACCOUNT_ID__DEV`](#cloudflare_account_id__dev)               | `cougars-dev` | Cloudflare, Cougars Dev     | PR previews, `deploy-dev.sh`              |
| [`CLOUDFLARE_ANALYTICS_TOKEN__PRODUCTION`](#cloudflare_analytics_token)   | `cougars`     | Cloudflare, Cougars         | Team app Usage page                       |
| [`CLOUDFLARE_ANALYTICS_TOKEN__DEV`](#cloudflare_analytics_token)          | `cougars-dev` | Cloudflare, Cougars Dev     | Team app Usage page (dev)                 |
| [`SANITY_DEPLOY_TOKEN__PRODUCTION`](#sanity_deploy_token__production)     | `cougars`     | Sanity                      | Studio deploys                            |
| [`YOUTUBE_API_KEY__PRODUCTION`](#youtube-api-keys)                        | `cougars`     | Google Cloud                | Website (production)                      |
| [`YOUTUBE_API_KEY__DEV`](#youtube-api-keys)                               | `cougars-dev` | Google Cloud                | Website (dev)                             |
| [`INSTAGRAM_TOKEN__PRODUCTION`](#instagram)                               | `cougars`     | Meta, club's Instagram      | Website (production)                      |
| [`INSTAGRAM_TOKEN_KEY__PRODUCTION`](#instagram)                           | `cougars`     | Made by us                  | Website (production)                      |
| [`GMAIL_CLIENT_ID`](#gmail)                                               | `cougars-dev` | Google Cloud                | Website, team app (both)                  |
| [`GMAIL_CLIENT_SECRET`](#gmail)                                           | `cougars-dev` | Google Cloud                | Website, team app (both)                  |
| [`GMAIL_REFRESH_TOKEN`](#gmail)                                           | `cougars-dev` | Google, developer Gmail     | Website, team app (both)                  |
| [`TURNSTILE_SECRET_KEY__PRODUCTION`](#turnstile)                          | `cougars`     | Cloudflare, Cougars         | Website (production)                      |
| [`TURNSTILE_SECRET_KEY`](#turnstile)                                      | `cougars-dev` | Cloudflare, Cougars Dev     | Website (dev)                             |
| [`SMOKE_TOKEN`](#smoke_token)                                             | (none)        | Made by each deploy         | Deploy smoke test of the form (both)      |
| [`TEAM_ROSTER__PRODUCTION`](#team-roster)                                 | `cougars`     | (the admins only)           | Deploys (D1 seed)                         |
| [`GITHUB_APP_PRIVATE_KEY`](#github_app_private_key)                       | `cougars-dev` | GitHub, `Cougars rebuilds`  | Team app (both): rebuilds                 |
| [`CF_ACCESS_CLIENT_ID__PRODUCTION`](#cf_access_client_id__production)     | `cougars`     | Cloudflare Access           | Production smoke tests, until launch      |
| [`CF_ACCESS_CLIENT_SECRET__PRODUCTION`](#cf_access_client_id__production) | `cougars`     | Cloudflare Access           | Production smoke tests, until launch      |
| [`BACKUP_KEY__PRODUCTION`](#backup_key)                                   | `cougars`     | (random, made once)         | Database backups (production)             |
| [`BACKUP_KEY`](#backup_key)                                               | `cougars-dev` | (random, made once)         | Database backups (dev)                    |
| [`APP_STORE_CONNECT_KEY`](#store-app)                                     | `cougars-dev` | Apple, App Store Connect    | Store app builds (`store.yml`)            |
| [`APP_STORE_CONNECT_KEY_ID`](#store-app)                                  | `cougars-dev` | Apple, App Store Connect    | Store app builds (`store.yml`)            |
| [`APP_STORE_CONNECT_ISSUER_ID`](#store-app)                               | `cougars-dev` | Apple, App Store Connect    | Store app builds (`store.yml`)            |
| [`APPLE_TEAM_ID`](#store-app)                                             | `cougars-dev` | Apple (`store-setup.mjs`)   | Store app builds, team app (links)        |
| [`FIREBASE_SERVICE_ACCOUNT`](#store-app)                                  | `cougars-dev` | Google Cloud, Firebase      | Team app (both): notifications            |
| [`FIREBASE_IOS_CONFIG`](#store-app)                                       | `cougars-dev` | Firebase                    | Store app builds (`store.yml`)            |
| [`APNS_KEY`](#store-app)                                                  | `cougars-dev` | Apple, Developer → Keys     | Nothing (backup of Firebase's copy)       |
| [`APNS_KEY_ID`](#store-app)                                               | `cougars-dev` | Apple, Developer → Keys     | Nothing (backup of Firebase's copy)       |
| [`APP_REVIEW_EMAIL__PRODUCTION`](#store-app)                              | `cougars`     | (us)                        | Team app (production): App Review         |
| [`APP_REVIEW_CODE__PRODUCTION`](#store-app)                               | `cougars`     | (random, made once)         | Team app (production): App Review         |
| [`SENTRY_AUTH_TOKEN`](#sentry)                                            | `cougars-dev` | Sentry, developer account   | Deploys (source maps), `sentry-setup.mjs` |
| [`SENTRY_DSN_WEB`](#sentry)                                               | `cougars-dev` | Sentry (`sentry-setup.mjs`) | Website Worker (both)                     |
| [`SENTRY_DSN_TEAM`](#sentry)                                              | `cougars-dev` | Sentry (`sentry-setup.mjs`) | Team Worker and app (both)                |

### Bitwarden tokens

They let CI (and you) read the other secrets. Each is the access token of one Bitwarden machine account, named
like the secret that holds it:

| Token                          | Machine account  | `cougars`       | `cougars-dev`   | Stored in                                           |
| ------------------------------ | ---------------- | --------------- | --------------- | --------------------------------------------------- |
| `BWS_ACCESS_TOKEN__PRODUCTION` | `cougars-ci`     | Can read        | Can read        | GitHub environment `production` (deploys `release`) |
| `BWS_ACCESS_TOKEN__DEV`        | `cougars-ci-dev` | No access       | Can read        | GitHub environment `preview` (`main` and PRs)       |
| `COUGARS_LOCAL_BW_TOKEN`       | `cougars-local`  | Can read, write | Can read, write | your vault: secure note `cougars/.env.local`        |

Project access is set in Secrets Manager → **Machine accounts → _account_ → Projects**. CI is read-only: it never
changes a secret. `cougars-local` can write, so you add secrets from the shell
(`npm run secret:set NAME`).
People (org members) get access to the projects they maintain; the free plan allows 2.

- **Gets there by:** `deploy.yml` passes its environment's token to `bws` as `BWS_ACCESS_TOKEN` and runs
  `scripts/env-pull.mjs --github-env --environment production|dev`, which exports the rest (masked). Locally,
  **`bw-unlock` is the login** (once per container start, as in Ark): the scripts read the token from the vault
  note `cougars/.env.local` (a line `COUGARS_LOCAL_BW_TOKEN=...`), and ask for your master password if it's locked: `node scripts/env-pull.mjs -- <command>`.
- **Expires:** as set when created. Check each machine account's token list.
- **Rotate:** new token on the machine account, `gh secret set <name> --env <environment>` (or update your vault),
  run a deploy, revoke the old token.

### `CLOUDFLARE_API_TOKEN__PRODUCTION`

Deploys the `cougars` worker and migrates the `cougars` D1 database on the **Cougars** account.

- **Issued by:** Cloudflare, Cougars account → Manage Account → **Account API Tokens**. Token name:
  `CLOUDFLARE_API_TOKEN__PRODUCTION`.

  Account API tokens use role-style permissions, grouped by what they apply to:

  | Applies to             | Permission                                                       | Why                                                     |
  | ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
  | Entire Cougars account | Workers Admin                                                    | Deploy the `cougars` worker (Editor can't create it)    |
  | Entire Cougars account | Workers Editor                                                   | (also on the token; Admin covers it)                    |
  | Entire Cougars account | D1 Write                                                         | Create and migrate the `cougars` database               |
  | Entire Cougars account | Turnstile Write                                                  | Make the Turnstile widget (`turnstile-setup.mjs`)       |
  | All zones in Cougars   | Zone WAF Write                                                   | The domain's rate-limiting rule (`ratelimit-setup.mjs`) |
  | All zones in Cougars   | Single Redirect Write                                            | www to the bare domain (`redirect-setup.mjs`)           |
  | Entire Cougars account | Access: Identity Providers, Apps, Policies, Service Tokens Write | The gate before launch (`access-setup.mjs`)             |
  | All zones in Cougars   | Zone Read                                                        | Find the batterseacougars.com zone                      |
  | All zones in Cougars   | DNS Write                                                        | The deploy creates the domain's DNS records             |
  | All zones in Cougars   | Workers Routes Write                                             | Attach the domain to the worker (`target.mjs`)          |

- **Used by:** `deploy.yml` on `release` and Studio publishes only (`target.mjs`, migrations, `wrangler deploy`).
- **Gets there by:** CI pull from Secrets Manager (code reads `CLOUDFLARE_API_TOKEN`).
- **Expires:** no, unless you set a TTL.
- **Rotate:** roll it in the dashboard, update Secrets Manager.

### `CLOUDFLARE_ACCOUNT_ID__PRODUCTION`

The Cougars account's id (account home page). Not secret. Account tokens need it.

### `CLOUDFLARE_ANALYTICS_TOKEN`

Read-only. The team app's Usage page and its hourly check read today's Worker requests and D1 rows from Cloudflare's
analytics, to warn the admins before the free allowance runs out ([ADR 0059](docs/adr/0059-usage-page-and-check.md)).
Never the deploy token: this one lives in the Worker.

- **Issued by:** Cloudflare, each account (Cougars, Cougars Dev) → Manage Account → **Account API Tokens**. Token
  name: `CLOUDFLARE_ANALYTICS_TOKEN__PRODUCTION` / `CLOUDFLARE_ANALYTICS_TOKEN__DEV`.

  | Applies to                   | Permission                       | Why                                                       |
  | ---------------------------- | -------------------------------- | --------------------------------------------------------- |
  | Entire Cougars (Dev) account | Account Analytics Read           | Today's Worker requests and D1 rows                       |
  | Entire Cougars Dev account   | Workers Observability Read (dev) | CPU time per route, `scripts/cpu-by-route.mjs` (ADR 0059) |

  Cloudflare lists Workers Observability under its legacy permissions; it still works. Production doesn't need it.

- **Used by:** the team Worker (`apps/team/worker/settings/usage.ts`), with `CLOUDFLARE_ACCOUNT_ID`; on dev, also
  `scripts/cpu-by-route.mjs`.
- **Gets there by:** a Worker secret when the team app deploys; locally, `node scripts/env-pull.mjs -- npm run dev
-w @cougars/team` passes it to the dev server (`vite.config.ts`), never to a file.
- **Expires:** no, unless you set a TTL.
- **Rotate:** roll it in the dashboard, update Secrets Manager.

### `CLOUDFLARE_API_TOKEN__DEV`

Deploys the `web` worker and migrates the `cougars-dev` D1 database on the **Cougars Dev** account.
Can't touch production: it is a different account.

- **Issued by:** Cloudflare, Cougars Dev account → Manage Account → **Account API Tokens**. Scope **Entire
  Cougars Dev account**; permissions **Workers Admin** (Editor can't create a new worker), **D1 Write**, **Turnstile Write**
  (`scripts/turnstile-setup.mjs`). Token name: `CLOUDFLARE_API_TOKEN__DEV`.
- **Used by:** `deploy.yml` on `main` and pull requests (preview versions), `scripts/deploy-dev.sh`.
- **Gets there by:** CI pull, or `node scripts/env-pull.mjs -- bash scripts/deploy-dev.sh`.
- **Expires:** no, unless you set a TTL.
- **Rotate:** roll it in the dashboard, update Secrets Manager.

### `CLOUDFLARE_ACCOUNT_ID__DEV`

The Cougars Dev account's id. Not secret.

### `SANITY_DEPLOY_TOKEN__PRODUCTION`

Lets CI deploy the Studio's schema to Sanity on every push to `release`. The Studio itself is self-hosted at
https://studio.batterseacougars.com ([ADR 0112](docs/adr/0112-self-hosted-studio.md)), deployed by Cloudflare's token.

- **Issued by:** Sanity → manage → project **Cougars** → API → Tokens, role **Deploy Studio**. Token name:
  `SANITY_DEPLOY_TOKEN__PRODUCTION`.
- **Used by:** the `studio` job in `deploy.yml` (`sanity schemas deploy`, which reads it as `SANITY_AUTH_TOKEN`).
  Production only.
- **Gets there by:** CI pull from Secrets Manager (`cougars`); the job maps `SANITY_DEPLOY_TOKEN` to
  `SANITY_AUTH_TOKEN`. Never name it `SANITY_STUDIO_*`: the Studio build puts those variables in its public
  JavaScript.
- **Expires:** no.
- **Rotate:** add a new Deploy Studio token with the same name, update Secrets Manager, push `release` (or re-run
  the job), delete the old token.

### YouTube API keys

Lets the website list the club's YouTube videos live (`apps/web/src/lib/server/videos.ts`,
[ADR 0016](docs/adr/0016-photos-and-videos-read-live.md)). One key per environment, so a leaked dev key can be revoked without
touching production. Without a key the site still works and shows only the videos in Sanity.

- **Issued by:** Google Cloud console, one project for the club (free, no billing account). **APIs & Services →
  Library → YouTube Data API v3 → Enable**, then **Credentials → Create credentials → API key**. Name it like
  the secret, and under **API restrictions** pick **Restrict key → YouTube Data API v3** only. No application
  restriction: CI has no fixed IP address. Both keys can live in the same project; they share its free quota of
  10,000 units a day; with the 10-minute cache the site uses a few hundred at most.
- **Used by:** the Worker's `/videos` page and home video reel, and the build (code reads `YOUTUBE_API_KEY`). It
  reads public data only and is never sent to the browser.
- **Gets there by:** CI pull from Secrets Manager (`env-pull.mjs --github-env`), then `deploy.yml` pushes it to the
  Worker as a secret on every deploy (`wrangler secret put`). Locally, `node scripts/env-pull.mjs -- npm run dev`
  (dev key).
- **Expires:** no.
- **Rotate:** Credentials → the key → **Regenerate key**, update Secrets Manager, run a deploy.

### Instagram

The website's photos are the club's Instagram posts (`apps/web/src/lib/server/instagram.ts`,
[ADR 0113](docs/adr/0113-photos-from-instagram.md)). Production only: without them, dev, previews and a laptop show a
sample feed, and production shows "No photos yet".

**`INSTAGRAM_TOKEN__PRODUCTION`**, the first token. The Worker renews it weekly by itself and keeps the renewed one in
D1, sealed (the one exception to Bitwarden-only, [ADR 0002](docs/adr/0002-secrets-in-bitwarden.md)).

- **Issued by**, once:
  1. As the club account in the Instagram app: **Settings → Account type and tools → Switch to professional
     account** (Creator or Business; free, posts unchanged).
  2. As the developer account at developers.facebook.com: **My Apps → Create app** ("Battersea Cougars website",
     use case **Manage messaging & content on Instagram**), then **Instagram → API setup with Instagram login**.
  3. **App roles → Roles → Add people → Instagram Tester**: the club's Instagram account; accept it in Instagram
     (**Settings → Website permissions → Apps and websites → Tester invites**).
  4. Back in **API setup with Instagram login → Generate access tokens → Add account**, sign in as the club's
     Instagram, and copy the token (permission `instagram_business_basic` only: read its own posts).
  5. `npm run secret:set INSTAGRAM_TOKEN__PRODUCTION`, then run a production deploy.
- **Used by:** the website Worker (`/photos/`, the home strip, `/api/photos/<id>`); the cron renews it.
- **Gets there by:** CI pull, then `deploy.yml` pushes it to the Worker as a secret.
- **Expires:** 60 days, but renewed weekly by the Worker, so never in practice. If renewal fails, Sentry alerts with
  the days left.
- **Rotate / revoke:** the Meta app → **API setup with Instagram login** → remove the account, then make a new token
  as above.

**`INSTAGRAM_TOKEN_KEY__PRODUCTION`**, the key the renewed token is sealed with in D1 (AES-GCM).

- **Issued by:** us: `openssl rand -base64 32 | npm run secret:set INSTAGRAM_TOKEN_KEY__PRODUCTION` (32 random bytes,
  base64). Its own key, never `BACKUP_KEY`.
- **Used by / gets there by:** the website Worker, pushed as a secret by `deploy.yml`.
- **Rotate:** set a new value and deploy. The sealed token then won't open: the Worker falls back to the Bitwarden
  token (an error says so) and seals a fresh one at the next weekly renewal. If the Bitwarden one has expired by then,
  make a new token.

### Gmail

Lets the website email the club inbox about each enquiry, and auto-reply to the enquirer, through the Gmail API
(HTTPS, not SMTP; no password is stored anywhere). Outside production every email is redirected to one safe
inbox, and dev can only ever send from its own test account, never the club's.

- **Issued by:**
  - `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`: Google Cloud console, signed in as the developer account (the dev
    Gmail account, which owns the club's Google Cloud work). One project for the whole club, website and team app:
    _Battersea Cougars_, ID `battersea-cougars` (permanent, so no "website" or "dev" in it). Add
    the club's Gmail account as a second Owner (**IAM → Grant access**), so the club can always reach the project
    production email depends on. Each app gets its own client in it, so either can be cut off alone; the YouTube
    keys go here too.
    1. **APIs & Services → Library → Gmail API → Enable**.
    2. **Google Auth Platform → Get started**: app name _Battersea Cougars_ (both apps share it), support and
       contact email the developer account's, audience **External**.
    3. **Data access → Add or remove scopes**: `.../auth/gmail.send` only (_Send email on your behalf_). Save.
    4. **Branding**: application home page and privacy policy, the site's `/` and `/privacy/` (the dev site's
       `https://web.cougars-dev.workers.dev` until there's a domain; switch them, and the authorised
       domain, when there is). Save.
    5. **Audience → Publish app**, to **In production**. In _Testing_, Google cancels the tokens after 7 days.
       It stays unverified (Google warns on the consent screen, which is fine: only the developer account ever
       signs in).
    6. **Clients → Create client → Desktop app**, named `cougars-website`. Save both values:
       `npm run secret:set GMAIL_CLIENT_ID`, then `GMAIL_CLIENT_SECRET` (shared by both environments).
  - `GMAIL_REFRESH_TOKEN`: `node scripts/gmail-auth.mjs`, signed in as the developer Gmail account. One token for both
    environments: production sends from this account too, so resetting the club account's password breaks nothing
    (ADR 0027). It refuses the club's account.
  - **The club's address as the sender:** in the developer account's Gmail, **Settings → Accounts and Import → Send mail as →
    Add another email address**: name _Battersea Cougars_, address: the club's Gmail address, **Treat as an alias**
    ticked. Gmail emails the club account a confirmation link; open it there. Production then sends as
    the club's address, and replies land in the club inbox. Without it, production sends as the developer account.
    The club's address is the Studio's **Club → Contact email**: change both together.

  The script opens Google's consent page, catches the answer on `http://localhost:4590` and saves the token straight
  to Secrets Manager; nothing is printed.

- **Used by:** the website's enquiry form (Worker) and the team app's sign-in codes and notices, to send mail. The refresh token can send mail as its account
  and nothing else: it can't read the mailbox.
- **Gets there by:** CI pull from Secrets Manager (both environments read the same three), then `deploy.yml` pushes all three to the Worker as secrets on every deploy. Locally,
  `node scripts/env-pull.mjs -- npm run dev` (dev account). Without them, emails are logged, not sent
  ([ADR 0027](docs/adr/0027-email-through-gmail-api.md)).
- **Expires:** no, but Google cancels a refresh token when the account's password changes, access is removed in
  [the account's third-party access](https://myaccount.google.com/connections), or it's unused for 6 months.
- **Rotate:** re-run `gmail-auth.mjs`, then deploy both environments. Client secret: **Clients → the client →
  Add secret**, update Secrets Manager, delete the old one.

### Turnstile

Cloudflare Turnstile on the "Try a session" form: it tells people from bots, and only people get the automatic
reply ([ADR 0028](docs/adr/0028-turnstile-and-auto-reply.md)). Free. Without the secret nobody counts as verified:
enquiries are still saved and emailed to the club, but nobody gets an auto-reply.

- **Issued by:** Cloudflare, one widget per account, named `cougars`, made by
  `node scripts/env-pull.mjs [--environment production] -- node scripts/turnstile-setup.mjs dev|production`. It
  stores the secret key straight in Secrets Manager (nobody sees it) and prints the site key, which goes in
  `deploy.yml`. The account's `CLOUDFLARE_API_TOKEN` needs **Turnstile Write** for it. By hand instead: sidebar
  **Turnstile** (under _Application security_ in the new
  dashboard) → **Add widget**: name `cougars-website`, hostname the site's (Cougars Dev: `cougars-dev.workers.dev`, which covers `web.` and its PR previews;
  Cougars: `batterseacougars.com`), widget mode **Managed**, pre-clearance **No** → **Create**. It shows a **site
  key** (public: it goes in `deploy.yml` as `TURNSTILE_SITE_KEY` for that environment) and a **secret key**:
  `npm run secret:set TURNSTILE_SECRET_KEY` (dev) or `TURNSTILE_SECRET_KEY__PRODUCTION`.
- **Used by:** the website's `/api/join` (Worker), to check each form's token with Cloudflare.
- **Gets there by:** CI pull from Secrets Manager, then `deploy.yml` pushes it to the Worker as a secret on every
  deploy. A laptop uses Cloudflare's test site key (always passes) and no secret, so no auto-replies locally.
- **Expires:** no.
- **Rotate:** the widget → **Rotate secret key**, update Secrets Manager, deploy.

### `SMOKE_TOKEN`

Lets the deploy's smoke test send a real "Try a session" enquiry (`scripts/ci/smoke-test.mjs`,
`apps/web/src/lib/server/smoke.ts`, [ADR 0027](docs/adr/0027-email-through-gmail-api.md)): with it in the
`X-Cougars-Smoke` header, the enquiry is saved, both emails go out **to the sending account only** (in production
too), and the row is deleted. The deploy fails unless both emails were sent.

- **Made:** by every website deploy, at random (`deploy.yml`, "Smoke key"), put on the Worker and handed to the smoke
  test. **Not stored**: not in Secrets Manager, not anywhere.
- **Spent:** straight after the smoke test, pass or fail, the Worker gets a new random value nobody ever sees, so a
  key works for its own deploy's test only. A smoke header with any other key is refused (403), never taken as an
  ordinary enquiry.
- **PR previews** share dev's Worker, so they skip the form test.

### Team roster

- **What:** the club's players as one line of JSON: name, position (F/D/G), rating, and optionally an email and
  roles. Not a credential, but personal data (names and skill ratings), so it never goes in this public repo
  ([ADR 0029](docs/adr/0029-personal-data.md)). Format and local use: [db/seed/README.md](db/seed/README.md).
- **Set:** only `TEAM_ROSTER__PRODUCTION`, production's admins (two), from a local file of that shape:
  `node -e "console.log(JSON.stringify(require('./admins.local.json')))" | node scripts/secret-set.mjs TEAM_ROSTER__PRODUCTION`,
  then delete the file. Everyone else is imported in the app (Members → Manage → Import members,
  [ADR 0050](docs/adr/0050-schema-and-seed-until-launch.md)). Dev has no roster in Secrets Manager: its database
  already holds its people, so its deploys skip the seed. `scripts/access-setup.mjs` starts the Access gate's list from it, once; after that the list is managed in the dashboard.
- **Used by:** `scripts/seed-roster.mjs`, which adds players who aren't in D1 yet and changes no one. Local adds
  them anonymized from `db/seed/roster.local.json` (made-up names bar the admins, ADR 0029), or, without one, the
  made-up club in `db/seed/roster.example.json`.
- **Gets there by:** CI pull from Secrets Manager, then the "Seed the team roster" step in `deploy.yml`, after the
  migrations, on every deploy. A laptop seeds from the local copy (`npm run db:seed:local`).
- **Expires:** no. Once the app is live, members join and are edited in the app; the roster only covers the
  starting players.

### `GITHUB_APP_PRIVATE_KEY`

The private key of the GitHub App **Cougars rebuilds**, owned by the `battersea-cougars` organisation (not a
person, so it outlives any maintainer). The team Worker signs a short request with it and swaps that for a token
that lasts an hour, to start a website rebuild when a result changes ([ADR 0100](docs/adr/0100-website-reads-tournament-results.md)).
One key for both environments: production reads `cougars-dev` too, and nothing needs a different value.

- **Issued by:** GitHub → `battersea-cougars` → Settings → Developer settings → GitHub Apps → Cougars rebuilds →
  Private keys → Generate. Installed on `battersea-cougars/ark` only, webhook off.

  | Applies to              | Permission          | Why                                                |
  | ----------------------- | ------------------- | -------------------------------------------------- |
  | `battersea-cougars/ark` | Actions: read/write | Running `deploy.yml` for the website (`apps: web`) |
  | `battersea-cougars/ark` | Metadata: read      | Required by GitHub for every App                   |

  **What a leaked key could do:** start or cancel workflow runs, and delete runs and their artifacts (old backups,
  [ADR 0106](docs/adr/0106-database-backups.md)). Not push code, not read secrets, not change settings. Each token the
  Worker takes asks for Actions: write on this repo alone. `main` and `release` refuse force-pushes and deletion
  (repository ruleset), and only `release` deploys production.

- **Format:** PKCS#8 (`-----BEGIN PRIVATE KEY-----`), which the Workers runtime's WebCrypto imports. GitHub hands
  out PKCS#1, so convert when storing (never save the file in the repo; `*.pem` is gitignored):
  `openssl pkcs8 -topk8 -nocrypt -in KEY.pem | node scripts/secret-set.mjs GITHUB_APP_PRIVATE_KEY`
- **Used by:** the team Worker, with the App's Client ID and installation ID (not secret, below).
- **Gets there by:** a Worker secret when the team app deploys.
- **Expires:** no.
- **Rotate:** generate a new key on the App, store it as above, redeploy, then delete the old key on the App.

### `CF_ACCESS_CLIENT_ID__PRODUCTION`

With `CF_ACCESS_CLIENT_SECRET__PRODUCTION`, CI's Cloudflare Access service token: until launch production is behind
Access (docs/setup.md), and the deploy's smoke tests send these two as headers to get past it.

- **Made by:** `node scripts/env-pull.mjs --environment production -- node scripts/access-setup.mjs`, which creates
  the token and stores both straight in Secrets Manager (nobody sees the secret). Run again with the secret missing,
  it rotates the token and stores the new one.
- **Used by:** `scripts/ci/smoke-test.mjs` and the team job's smoke test in `deploy.yml`.
- **Expires:** a year after it's made; run the script again to rotate.
- **At launch:** `access-setup.mjs --remove` deletes the token; delete both secrets.

### `BACKUP_KEY`

The key that seals the database's backups ([ADR 0106](docs/adr/0106-database-backups.md)). A backup is the whole
database, members' names and emails included, kept as an artifact on this public repo, so it's encrypted
(`scripts/lib/backup.mjs`). One per environment, so a dev key can't open production's backups.

- **Made by:** 32 random bytes, never seen by anyone:
  `node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))' | node scripts/secret-set.mjs BACKUP_KEY__PRODUCTION`
  (and `BACKUP_KEY` for dev).
- **Used by:** `scripts/db-backup.mjs` (`backup.yml` nightly, and `deploy.yml` before it changes the schema) and
  `scripts/db-restore.mjs`, which opens one ([db/README.md](db/README.md#backups)).
- **Gets there by:** CI pull from Secrets Manager. Locally, `node scripts/env-pull.mjs -- node scripts/db-restore.mjs …`
  (`--environment production` for a production backup).
- **Expires:** no.
- **Rotate:** only if it leaks. A new key can't open the old backups: keep the old one (as `BACKUP_KEY_OLD…`) until
  they've aged out, 90 days.

### Store app

The team app in the app stores ([ADR 0108](docs/adr/0108-store-apps.md)): built and sent to TestFlight by
`store.yml`, notifications sent by the team Worker through Firebase Cloud Messaging, and an account for Apple's App
Review. One copy each (production reads `cougars-dev` too) but the App Review pair, which is production's alone.

- **`APP_STORE_CONNECT_KEY`, `_KEY_ID`, `_ISSUER_ID`:** an App Store Connect API key, so CI signs and uploads with no
  certificates to keep. App Store Connect → Users and Access → Integrations → Team Keys → +, name
  `APP_STORE_CONNECT_KEY`, access **App Manager**. Download the `.p8` (once only) and store it with
  `node scripts/secret-set.mjs APP_STORE_CONNECT_KEY < AuthKey_XXXX.p8`, then delete the file; the key's ID and the
  page's Issuer ID go in the other two. **A leaked key could** upload builds and change the app's store listing, not
  release one past Apple's review. Rotate: make a new key, store it, revoke the old one.
- **`APPLE_TEAM_ID`:** the Apple Developer team's id. Not secret (every app link carries it), kept here so there's
  one copy: `scripts/store-setup.mjs` stores it, `store.yml` signs with it, and the team Worker serves it to phones
  (`/.well-known/apple-app-site-association`).
- **`FIREBASE_SERVICE_ACCOUNT`:** the JSON key of a Google service account in the Firebase project (the developer
  GCP project), role **Firebase Cloud Messaging API Admin** only, named `firebase-service-account` (Google allows no
  capitals). The Worker signs an hour's token with it to send notifications. **A leaked key could** send our members
  notifications, nothing else. Rotate: add a new key to the account, store it, redeploy `team`, delete the old key.
- **`FIREBASE_IOS_CONFIG`:** the iOS app's `GoogleService-Info.plist` from Firebase (Project settings → Your apps).
  Not much of a secret (its API key is limited to this app), but it stays out of the public repo: `store.yml` writes
  it into the Xcode project for the build.
- **`APNS_KEY`, `APNS_KEY_ID`:** the Apple push (APNs) key, uploaded to Firebase (Project settings → Cloud Messaging →
  Apple app configuration), which uses it to reach iPhones. No code reads it: it's kept only as a recovery copy, because
  Apple lets you download it once. Certificates, IDs & Profiles → Keys → +, **Apple Push Notifications service**,
  Sandbox & Production; `node scripts/secret-set.mjs APNS_KEY < AuthKey_XXXX.p8`, the Key ID in `APNS_KEY_ID`, then
  delete the file. **A leaked key could** send notifications to the app's users, given their phones' tokens. Rotate:
  make a new key, upload it to Firebase, store it here, revoke the old one (Apple allows two at a time).
- **`APP_REVIEW_EMAIL__PRODUCTION`, `APP_REVIEW_CODE__PRODUCTION`:** Apple's reviewers sign in to the app, and can't
  read our email: this one member's email takes this fixed six-digit code instead of an emailed one (ADR 0023, 0108),
  with every other sign-in limit as ever. The member is a plain Member in production's roster. Made once:
  `node -e 'process.stdout.write(String(require("crypto").randomInt(1e5, 1e6)))' | node scripts/secret-set.mjs APP_REVIEW_CODE__PRODUCTION`;
  both go to Apple in App Store Connect's App Review Information. Change the code after each review if you like.
- **Gets there by:** CI pull from Secrets Manager; `deploy.yml` puts the Worker's (`FIREBASE_SERVICE_ACCOUNT`,
  `APPLE_TEAM_ID`, the App Review pair) on the team Worker as secrets.
- **Android, later:** `PLAY_SERVICE_ACCOUNT` (Play Console upload), `PLAY_UPLOAD_KEY` and `FIREBASE_ANDROID_CONFIG`
  join these (ADR 0108).

### Sentry

Errors from both apps, server and browser, and the down alerts ([ADR 0111](docs/adr/0111-errors-and-uptime.md)). One
organisation, `battersea-cougars`, in Sentry's **EU region** (`de.sentry.io`), on the free Developer plan (one user:
the developer Gmail account, which forwards the alerts). Projects `web` and `team`; each event says its environment.
The only alert is an email on a new issue in **production**; dev's errors are kept but tell nobody.

- **`SENTRY_AUTH_TOKEN`:** a personal token of the developer account (User settings → Personal Tokens), named
  `SENTRY_AUTH_TOKEN`, with Project Admin, Team Read & Write, Release Admin, Issue & Event Read, Organization Read and
  Alerts Read & Write. Used by `scripts/sentry-setup.mjs` (projects, the alert, the uptime monitors) and by the deploy
  to upload source maps. Set: `npm run secret:set SENTRY_AUTH_TOKEN`. **Expires:** no; rotate by making a new one,
  setting it, and revoking the old.
- **`SENTRY_DSN_WEB`, `SENTRY_DSN_TEAM`:** where each app sends its errors. Not really secret (the team app's is in
  its browser code), but kept out of this public repo. Made by `sentry-setup.mjs`, which stores them.
- **Gets there by:** CI pull from Secrets Manager; `deploy.yml` puts each as its Worker's `SENTRY_DSN` and builds the
  team app with `VITE_SENTRY_DSN`. Unset (your machine): no reports, only the log.
- **Setup or check:** `node scripts/env-pull.mjs -- node scripts/sentry-setup.mjs` (add `--uptime` for the monitors).

### Settings that aren't secret

| Name                                   | Where                       | What                                                                                                            |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                             | `deploy.yml`                | `https://batterseacougars.com` on production; dev's workers.dev                                                 |
| `BWS_SERVER_URL`                       | GitHub variable, your shell | `https://vault.bitwarden.eu` if the vault is on the EU server                                                   |
| `SANITY_PROJECT_ID` / `SANITY_DATASET` | `packages/shared/sanity.ts` | Picked from `SITE_ENV`: Cougars on production, Cougars Dev else                                                 |
| `SANITY_STUDIO_SITE_ENV`               | CI (Studio deploy)          | `production` builds the live Studio; unset is the dev project                                                   |
| `DEMO_CONTENT`                         | `.env`, CI                  | Sample content + `noindex`; `true` on dev and PR builds, never on production                                    |
| `PUBLIC_BUILD_VERSION`                 | Set by CI                   | Shown in `<meta name="generator">`; checked by the smoke test; its commit is the team app's build id (ADR 0104) |
| `GITHUB_APP_CLIENT_ID`                 | team `wrangler.jsonc`       | `Iv23liuUhxYcTesso0TW`, the Cougars rebuilds App                                                                |
| `GITHUB_APP_INSTALLATION_ID`           | team `wrangler.jsonc`       | `169599165`, its installation on `battersea-cougars/ark`                                                        |

## Docs

- [docs/accounts.md](docs/accounts.md): every outside service, who owns it, and which secrets come from it
- [docs/setup.md](docs/setup.md): one-time account setup (Cloudflare, Sanity, Bitwarden, GitHub)
- [docs/testing.md](docs/testing.md): how we test (use cases first, the fake world)
- [docs/editing.md](docs/editing.md): guide for club editors (no coding)
- [Milestones](https://github.com/battersea-cougars/ark/milestones): what's next, per project, as GitHub issues
- [docs/adr/](docs/adr/README.md): architecture decisions, and why
- [db/README.md](db/README.md): database conventions
- [docs/team-app-data-model.md](docs/team-app-data-model.md): the team app's tables
- [CLAUDE.md](CLAUDE.md): conventions for contributors and AI agents

## Ports (devcontainer)

Cougars owns ports **4500-4529** so it doesn't clash with other projects on the host: 4500 the website, 4510 the
team app, 4520 the Sanity Studio. They belong to the show switch (below), never to an app: each shows the checkout
last shown, and every app runs on a private port that's free when it starts (not forwarded).

## Worktrees (parallel work)

The main checkout stays on `main` and is for merging. Each task is a branch in its own worktree, so several agents
work at once ([ADR 0115](docs/adr/0115-worktrees-and-the-show-switch.md)). A new one is ready at once: main's
`node_modules` is hard-linked when the lockfile matches.

```sh
npm run worktree -- add web/gallery     # branch web/gallery off main, in .worktrees/web-gallery
npm run worktree -- remove web/gallery  # its apps stopped, the worktree removed if clean, the branch if merged
npm run merge:check -- web/gallery      # in the main checkout: the branch's checks, then "Safe to merge" or not
```

**Showing a checkout.** One supervisor holds 4500, 4510 and 4520 and forwards each (hot reload included) to the
apps of the checkout shown:

```sh
npm run app                  # show this checkout: its website on 4500, team app on 4510 (Studio: add studio)
npm run app main             # show the main checkout
npm run app -- --private     # run this checkout's apps without showing them: prints their own ports
npm run app -- --own-db      # this checkout's own copy of local D1 (a branch that changes db/schema.sql)
npm run app status           # what's shown, every app, its port and state
npm run app restart [web|team|studio]
npm run app stop [web|team|studio]
npm run app logs web --follow
npm run app down             # the supervisor and every app
npm run dev                  # show this checkout and start its website afresh, following its log (also team, studio)
```

**In a browser: http://localhost:4500/__app** (or 4510/__app) lists every checkout with Show, Restart and Stop and
each app's log. While a shown app starts, its port says so and opens it when it answers; the Studio starts when 4520
is opened. A branch's app nobody has looked at for 3 hours stops (main's never). Ctrl-C in `npm run dev` only stops
following the log. Logs live in `.worktrees/.show/`.

Every checkout's apps use **main's local D1** (your data and sign-in), unless started with `--own-db`. They get the
dev secrets when Bitwarden is unlocked (`bw-unlock`, then `npm run app restart`). To sign in headless against a
private port: `node scripts/dev-sign-in.mjs --port <team app port>`.

Opening the devcontainer installs dependencies, migrates the local D1 database and starts **web** and the **team app**
automatically (VS Code tasks in `.vscode/tasks.json`, each in its own terminal). Start the Studio with
_Terminal → Run Task… → dev: studio_.
