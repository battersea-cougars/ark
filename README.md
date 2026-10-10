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
npm run dev                # http://localhost:4500
npm test
```

To preview the design with sample events, videos, photos and players: `DEMO_CONTENT=true npm run dev`.

The site builds and runs **without Sanity**: until a Sanity project is configured, it uses the club copy in
`apps/web/src/lib/sanity/fallback.ts` and shows empty states for videos, photos and events.

With secrets (run `bw-unlock` first, see [Bitwarden tokens](#bitwarden-tokens)):

```sh
node scripts/env-pull.mjs --status          # list secret names (never values)
node scripts/env-pull.mjs -- npm run dev    # run with dev secrets injected
```

## Secrets

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
- **Every secret has an entry below.** Adding one: create the token with its secret name, add it to Secrets
  Manager with `node scripts/secret-set.mjs NAME` (hidden prompt; it picks the project from the name), add it here.

| Secret                                                                    | Project       | Issued by                   | Used by                              |
| ------------------------------------------------------------------------- | ------------- | --------------------------- | ------------------------------------ |
| [`BWS_ACCESS_TOKEN__PRODUCTION`](#bitwarden-tokens)                       | (GitHub)      | Bitwarden, `cougars-ci`     | Production deploys                   |
| [`BWS_ACCESS_TOKEN__DEV`](#bitwarden-tokens)                              | (GitHub)      | Bitwarden, `cougars-ci-dev` | PR previews                          |
| [`COUGARS_LOCAL_BW_TOKEN`](#bitwarden-tokens)                             | (your vault)  | Bitwarden, `cougars-local`  | Your machine                         |
| [`CLOUDFLARE_API_TOKEN__PRODUCTION`](#cloudflare_api_token__production)   | `cougars`     | Cloudflare, Cougars         | Production deploys                   |
| [`CLOUDFLARE_ACCOUNT_ID__PRODUCTION`](#cloudflare_account_id__production) | `cougars`     | Cloudflare, Cougars         | Production deploys                   |
| [`CLOUDFLARE_API_TOKEN__DEV`](#cloudflare_api_token__dev)                 | `cougars-dev` | Cloudflare, Cougars Dev     | PR previews, `deploy-dev.sh`         |
| [`CLOUDFLARE_ACCOUNT_ID__DEV`](#cloudflare_account_id__dev)               | `cougars-dev` | Cloudflare, Cougars Dev     | PR previews, `deploy-dev.sh`         |
| [`CLOUDFLARE_ANALYTICS_TOKEN__PRODUCTION`](#cloudflare_analytics_token)   | `cougars`     | Cloudflare, Cougars         | Team app Usage page                  |
| [`CLOUDFLARE_ANALYTICS_TOKEN__DEV`](#cloudflare_analytics_token)          | `cougars-dev` | Cloudflare, Cougars Dev     | Team app Usage page (dev)            |
| [`SANITY_DEPLOY_TOKEN__PRODUCTION`](#sanity_deploy_token__production)     | `cougars`     | Sanity                      | Studio deploys                       |
| [`YOUTUBE_API_KEY__PRODUCTION`](#youtube-api-keys)                        | `cougars`     | Google Cloud                | Website (production)                 |
| [`YOUTUBE_API_KEY__DEV`](#youtube-api-keys)                               | `cougars-dev` | Google Cloud                | Website (dev)                        |
| [`GMAIL_CLIENT_ID`](#gmail)                                               | `cougars-dev` | Google Cloud                | Website, team app (both)             |
| [`GMAIL_CLIENT_SECRET`](#gmail)                                           | `cougars-dev` | Google Cloud                | Website, team app (both)             |
| [`GMAIL_REFRESH_TOKEN__PRODUCTION`](#gmail)                               | `cougars`     | Google, club Gmail          | Website, team app (production)       |
| [`GMAIL_REFRESH_TOKEN`](#gmail)                                           | `cougars-dev` | Google, dev Gmail           | Website, team app (dev)              |
| [`TURNSTILE_SECRET_KEY__PRODUCTION`](#turnstile)                          | `cougars`     | Cloudflare, Cougars         | Website (production)                 |
| [`TURNSTILE_SECRET_KEY`](#turnstile)                                      | `cougars-dev` | Cloudflare, Cougars Dev     | Website (dev)                        |
| [`TEAM_ROSTER__PRODUCTION`](#team-roster)                                 | `cougars`     | (the admins only)           | Deploys (D1 seed)                    |
| [`TEAM_ROSTER`](#team-roster)                                             | `cougars-dev` | (the club's roster)         | Deploys (D1 seed)                    |
| [`GITHUB_APP_PRIVATE_KEY`](#github_app_private_key)                       | `cougars-dev` | GitHub, `Cougars rebuilds`  | Team app (both): rebuilds            |
| [`CF_ACCESS_CLIENT_ID__PRODUCTION`](#cf_access_client_id__production)     | `cougars`     | Cloudflare Access           | Production smoke tests, until launch |
| [`CF_ACCESS_CLIENT_SECRET__PRODUCTION`](#cf_access_client_id__production) | `cougars`     | Cloudflare Access           | Production smoke tests, until launch |
| [`BACKUP_KEY__PRODUCTION`](#backup_key)                                   | `cougars`     | (random, made once)         | Database backups (production)        |
| [`BACKUP_KEY`](#backup_key)                                               | `cougars-dev` | (random, made once)         | Database backups (dev)               |

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
(`node scripts/secret-set.mjs NAME`).
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

  | Applies to                   | Permission             | Why                                 |
  | ---------------------------- | ---------------------- | ----------------------------------- |
  | Entire Cougars (Dev) account | Account Analytics Read | Today's Worker requests and D1 rows |

- **Used by:** the team Worker (`apps/team/worker/settings/usage.ts`), with `CLOUDFLARE_ACCOUNT_ID`.
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

Lets CI deploy the Studio to https://battersea-cougars.sanity.studio on every push to `release`.

- **Issued by:** Sanity → manage → project **Cougars** → API → Tokens, role **Deploy Studio**. Token name:
  `SANITY_DEPLOY_TOKEN__PRODUCTION`.
- **Used by:** the `studio` job in `deploy.yml` (`sanity deploy`, which reads it as `SANITY_AUTH_TOKEN`).
  Production only: `main` and PRs never deploy the Studio.
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

### Gmail

Lets the website email the club inbox about each enquiry, and auto-reply to the enquirer, through the Gmail API
(HTTPS, not SMTP; no password is stored anywhere). Outside production every email is redirected to one safe
inbox, and dev can only ever send from its own test account, never the club's.

- **Issued by:**
  - `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`: Google Cloud console, signed in as the developer account (the dev
    Gmail account, which owns the club's Google Cloud work). One project for the whole club, website and team app:
    _Battersea Cougars_, ID `battersea-cougars` (permanent, so no "website" or "dev" in it). Add
    batterseahockey@gmail.com as a second Owner (**IAM → Grant access**), so the club can always reach the project
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
       It stays unverified (Google warns on the consent screen, which is fine: only the club's two accounts ever
       sign in).
    6. **Clients → Create client → Desktop app**, named `cougars-website`. Save both values:
       `node scripts/secret-set.mjs GMAIL_CLIENT_ID`, then `GMAIL_CLIENT_SECRET` (shared by both environments).
  - `GMAIL_REFRESH_TOKEN`: `node scripts/gmail-auth.mjs dev`, signed in as the dev Gmail account. It refuses the
    club's account.
  - `GMAIL_REFRESH_TOKEN__PRODUCTION`: `node scripts/gmail-auth.mjs production`, signed in as
    batterseahockey@gmail.com. It refuses any other account.

  The script opens Google's consent page, catches the answer on `http://localhost:4590` and saves the token straight
  to Secrets Manager; nothing is printed.

- **Used by:** the website's enquiry form (Worker) and the team app's sign-in codes and notices, to send mail. The refresh token can send mail as its account
  and nothing else: it can't read the mailbox.
- **Gets there by:** CI pull from Secrets Manager (`GMAIL_REFRESH_TOKEN__PRODUCTION` becomes `GMAIL_REFRESH_TOKEN`),
  then `deploy.yml` pushes all three to the Worker as secrets on every deploy. Locally,
  `node scripts/env-pull.mjs -- npm run dev` (dev account). Without them, emails are logged, not sent
  ([ADR 0027](docs/adr/0027-email-through-gmail-api.md)).
- **Expires:** no, but Google cancels a refresh token when the account's password changes, access is removed in
  [the account's third-party access](https://myaccount.google.com/connections), or it's unused for 6 months.
- **Rotate:** re-run `gmail-auth.mjs` for that environment, then deploy. Client secret: **Clients → the client →
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
  `node scripts/secret-set.mjs TURNSTILE_SECRET_KEY` (dev) or `TURNSTILE_SECRET_KEY__PRODUCTION`.
- **Used by:** the website's `/api/join` (Worker), to check each form's token with Cloudflare.
- **Gets there by:** CI pull from Secrets Manager, then `deploy.yml` pushes it to the Worker as a secret on every
  deploy. A laptop uses Cloudflare's test site key (always passes) and no secret, so no auto-replies locally.
- **Expires:** no.
- **Rotate:** the widget → **Rotate secret key**, update Secrets Manager, deploy.

### Team roster

- **What:** the club's players as one line of JSON: name, position (F/D/G), rating, and optionally an email and
  roles. Not a credential, but personal data (names and skill ratings), so it never goes in this public repo
  ([ADR 0029](docs/adr/0029-personal-data.md)). Format and local use: [db/seed/README.md](db/seed/README.md).
- **Set:** from the local copy, `db/seed/roster.local.json` (gitignored):
  `node -e "console.log(JSON.stringify(require('./db/seed/roster.local.json')))" | node scripts/secret-set.mjs TEAM_ROSTER`.
  `TEAM_ROSTER__PRODUCTION` is the same shape with only production's admins; the members are imported in the app
  (Members → Manage → Import members, [ADR 0050](docs/adr/0050-schema-and-seed-until-launch.md)).
- **Used by:** `scripts/seed-roster.mjs`, which adds players who aren't in D1 yet and changes no one. Dev and local
  add them anonymized: made-up names bar the admins (ADR 0029).
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

### Settings that aren't secret

| Name                                   | Where                       | What                                                                                                            |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                             | `deploy.yml`                | `https://batterseacougars.com` on production; dev's workers.dev                                                 |
| `BWS_SERVER_URL`                       | GitHub variable, your shell | `https://vault.bitwarden.eu` if the vault is on the EU server                                                   |
| `SANITY_PROJECT_ID` / `SANITY_DATASET` | `packages/shared/sanity.ts` | Picked from `SITE_ENV`: Cougars on production, Cougars Dev else                                                 |
| `SANITY_STUDIO_SITE_ENV`               | CI (Studio deploy)          | `production` builds the live Studio; unset is the dev project                                                   |
| `DEMO_CONTENT`                         | `.env`, GitHub variable     | Sample content + `noindex`; `true` on production only pre-launch                                                |
| `PUBLIC_BUILD_VERSION`                 | Set by CI                   | Shown in `<meta name="generator">`; checked by the smoke test; its commit is the team app's build id (ADR 0104) |
| `GITHUB_APP_CLIENT_ID`                 | team `wrangler.jsonc`       | `Iv23liuUhxYcTesso0TW`, the Cougars rebuilds App                                                                |
| `GITHUB_APP_INSTALLATION_ID`           | team `wrangler.jsonc`       | `169599165`, its installation on `battersea-cougars/ark`                                                        |

## Docs

- [docs/setup.md](docs/setup.md): one-time account setup (Cloudflare, Sanity, Bitwarden, GitHub)
- [docs/testing.md](docs/testing.md): how we test (use cases first, the fake world)
- [docs/editing.md](docs/editing.md): guide for club editors (no coding)
- [Milestones](https://github.com/battersea-cougars/ark/milestones): what's next, per project, as GitHub issues
- [docs/adr/](docs/adr/README.md): architecture decisions, and why
- [db/README.md](db/README.md): database conventions
- [docs/team-app-data-model.md](docs/team-app-data-model.md): the team app's tables
- [CLAUDE.md](CLAUDE.md): conventions for contributors and AI agents

## Ports (devcontainer)

Cougars owns ports **4500-4529** so it doesn't clash with other projects on the host:
4500 web, 4510 team app, 4520 Sanity Studio. Worktrees use 4501-4509 (web) and 4521-4529 (Studio).

## Worktrees (parallel streams)

Parallel work streams each get a git worktree under `.worktrees/`, with their own
dependencies, local D1 database and ports, so each can be previewed while `main` runs on 4500:

```sh
bash scripts/worktree.sh add cms       # branch cms, installs and migrates
bash scripts/worktree.sh dev cms       # http://localhost:4501 (dev secrets if Bitwarden is unlocked)
bash scripts/worktree.sh studio cms    # http://localhost:4521
bash scripts/worktree.sh stop cms      # stop its website (Astro runs it in the background)
bash scripts/worktree.sh remove cms    # when the stream has landed on main
```

| Stream    | Website | Studio |
| --------- | ------- | ------ |
| `cms`     | 4501    | 4521   |
| `youtube` | 4502    | 4522   |
| `gallery` | 4503    | 4523   |

A Studio on a new port needs that origin added once under the Sanity project's API → CORS origins
(e.g. `http://localhost:4521`, with credentials).

Opening the devcontainer installs dependencies, migrates the local D1 database and starts **web** and the **team app**
automatically (VS Code tasks in `.vscode/tasks.json`, each in its own terminal). Start the Studio with
_Terminal → Run Task… → dev: studio_.
