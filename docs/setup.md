# One-time setup

Everything here is free. It takes about an hour. Do the steps in order; each one says which value goes where.

There are two environments, each on its own Cloudflare account ([ADR 0010](adr/0010-environments-and-deploys.md)):
**production** (account _Cougars_, the live site) and **dev** (account _Cougars Dev_: PR previews, design
previews, your machine).

All secrets go into **Bitwarden Secrets Manager** and nowhere else. **Name every token exactly like its
secret**, for example a Cloudflare token called `CLOUDFLARE_API_TOKEN__PRODUCTION`. Each secret is described in
[README.md#secrets](../README.md#secrets); the rules are in [ADR 0002](adr/0002-secrets-in-bitwarden.md).

## 1. Cloudflare: two accounts (hosting + database)

Do this twice: once for **Cougars** (production), once for **Cougars Dev** (dev).

1. Create a free account at <https://dash.cloudflare.com/sign-up> (or add a second account to your login).
2. **Workers & Pages** → pick a `*.workers.dev` subdomain. The workers are `web` and `team` in both
   accounts: dev at `https://web.<subdomain>.workers.dev` and `https://team.<subdomain>.workers.dev`; production's site
   at its domain.
3. Copy the **Account ID** (account home page).
4. **Manage Account → Account API Tokens → Create Token** (account-owned, so it doesn't depend on one person's
   login). Scope **Entire _account_**; permissions **Workers Admin** (Editor can't create a new worker) and **D1 Write**. Name it
   `CLOUDFLARE_API_TOKEN__PRODUCTION` on Cougars, `CLOUDFLARE_API_TOKEN__DEV` on Cougars Dev. Copy it.

Bitwarden secrets (step 3): `CLOUDFLARE_API_TOKEN__PRODUCTION`, `CLOUDFLARE_ACCOUNT_ID__PRODUCTION` in
`cougars`; `CLOUDFLARE_API_TOKEN__DEV`, `CLOUDFLARE_ACCOUNT_ID__DEV` in `cougars-dev`.

## 2. Sanity (content editing)

Two free projects, one per environment, like the two Cloudflare accounts
([ADR 0010](adr/0010-environments-and-deploys.md)). Both exist already:

| Project         | ID         | Dataset               | Used by                                                      |
| --------------- | ---------- | --------------------- | ------------------------------------------------------------ |
| **Cougars**     | `ah165efl` | `production` (public) | The live site and the hosted Studio                          |
| **Cougars Dev** | `zmg6rbe3` | `production` (public) | The dev site, PR previews, your machine and the local Studio |

The IDs are in `packages/shared/sanity.ts`; the environment picks the project, so nothing about them goes in Secrets
Manager. Public datasets need no read token.

To set up a project from scratch (or check one):

1. `npx sanity login` with your own account, then create the project at <https://www.sanity.io/manage> (Free
   plan) with one public dataset, `production`, and put its ID in `packages/shared/sanity.ts`.
2. **API → CORS origins**:
   - Cougars Dev: `http://localhost:4520`, with credentials (the local Studio of whichever checkout is shown, ADR
     0115). The old worktree origins 4521-4523 aren't needed any more.
   - Cougars Dev also: `https://studio.cougars-dev.workers.dev`, with credentials (the dev Studio, ADR 0112).
   - Cougars: `https://studio.batterseacougars.com`, with credentials (the live Studio, self-hosted, ADR 0112). The
     deploy token can't manage CORS, so these are added here by hand, once.
3. **Cougars → API → Tokens**: a **Deploy Studio** token named `SANITY_DEPLOY_TOKEN__PRODUCTION`, into Secrets
   Manager (`cougars`). CI deploys the Studio's schema with it on every push to `release`.
4. Seed the club facts (Club, Fridays, Pub, Team, Kumite) from the website's defaults, dev first. The scripts use
   your own login:
   ```sh
   npm run seed -w @cougars/studio                                    # Cougars Dev
   SANITY_STUDIO_SITE_ENV=production npm run seed -w @cougars/studio  # Cougars
   ```
   A project that still has the old `siteSettings` document is migrated instead: run
   `npm run migrate-settings -w @cougars/studio` (a dry run), then again with `-- --commit`.
5. **Members**: invite the club's editors to **Cougars** with the _Editor_ role (the Free plan includes 20
   seats), and to **Cougars Dev** if they want somewhere to practise. Vision, the query tool, only appears for
   administrators.

## 3. Bitwarden Secrets Manager

1. At <https://bitwarden.com>, create a free **organisation**, then enable **Secrets Manager** (the Free plan is
   enough).
2. Create two projects: **`cougars`** (production values, `NAME__PRODUCTION`) and **`cougars-dev`** (dev values,
   `NAME__DEV`, and shared plain `NAME`s). Add the secrets from steps 1, 2 and 5 with exactly those names.
3. **Machine accounts**, each with one access token (names and the matrix are in
   [README.md#bitwarden-tokens](../README.md#bitwarden-tokens)):
   - `cougars-ci`: `cougars` and `cougars-dev`. Token `BWS_ACCESS_TOKEN__PRODUCTION`, in GitHub environment `production`.
   - `cougars-ci-dev`: `cougars-dev` only. Token `BWS_ACCESS_TOKEN__DEV`, in GitHub environment `preview`.
   - `cougars-ci` and `cougars-ci-dev` get **Can read** only.
   - `cougars-local`: **Can read, write** on both, so you can add secrets from the shell. Token
     `COUGARS_LOCAL_BW_TOKEN`, in your vault as a secure note `cougars/.env.local` with the line
     `COUGARS_LOCAL_BW_TOKEN=...`.
4. If your vault is on the EU server (`vault.bitwarden.eu`), remember that for step 4.

Locally, **`bw-unlock` is the login**: once per container start, then every script finds the token itself. The
devcontainer keeps its own Bitwarden login (volume `cougars-bitwarden-cli`), separate from your host's.

```sh
bw config server https://vault.bitwarden.eu   # once
bw login                                      # once, as the account in the Cougars org
bw-unlock                                     # each container start
npm run secrets                               # lists secret names (dev)
```

## 4. GitHub

In `battersea-cougars/ark` → **Settings**:

1. **Environments**:
   - `production`: deployment branches **`release` only**. Secret `BWS_ACCESS_TOKEN__PRODUCTION`.
   - `preview`: Secret `BWS_ACCESS_TOKEN__DEV`.
   - No repository-level secrets.
2. **Variables → Actions** (optional):
   - `BWS_SERVER_URL`: `https://vault.bitwarden.eu` if your vault is on the EU server.
3. Deploy dev once, so the `web` worker exists before the first PR preview:
   ```sh
   node scripts/env-pull.mjs -- bash scripts/deploy-dev.sh
   ```

`main` deploys dev; `git push origin main:release` deploys production ([ADR 0010](adr/0010-environments-and-deploys.md)). The
first production deploy creates the D1 database and applies migrations.

## 5. Publish → rebuild (deferred to the team app)

Not set up ([ADR 0004](adr/0004-astro-workers-sanity-d1.md)). Studio changes reach the live site at the daily
rebuild (04:30 UK winter, 05:30 summer) or the next release. Photos are read live and need no rebuild. To publish
something sooner, start a production rebuild by hand: **Actions → Deploy → Run workflow → `release`**, or
`gh workflow run deploy.yml --ref release`.

The team app will start rebuilds when content changes, the way Gwenda's ops does.

## 6. Domain

`batterseacougars.com`, bought 2026-10-06 with Cloudflare Registrar (at cost, about $10.50 a year, auto-renew on)
on the **Cougars** account. Registrar lock and contact privacy are on by default; turn on DNSSEC (**DNS → Settings**)
and keep two-factor login on the account, which controls the domain.

Nothing is done by hand: `deploy.yml` sets production's `SITE_URL` to `https://batterseacougars.com`, and
`scripts/ci/target.mjs` attaches it and `www.` to the `cougars` worker as custom domains, so the first `release`
deploy creates the DNS records and certificates. That needs the zone permissions on
[`CLOUDFLARE_API_TOKEN__PRODUCTION`](../README.md#cloudflare_api_token__production). Dev stays on workers.dev: it's a
separate Cloudflare account, and a domain can only point at workers in its own.

The form rate limit and the edge cache start working on the domain: Cloudflare's Cache API is disabled on
`*.workers.dev`. At launch, switch the Google Auth Platform **Branding** URLs to the domain (README.md#gmail).

**Before launch, behind Cloudflare Access**: `batterseacougars.com`, `www.` and `team.` ask for an email and a
one-time code, and let in only the emails on the **Admins (production roster)** policy, plus CI's service token for the
deploy's smoke tests. Who's on that list is managed by hand: Zero Trust → **Access → Policies → Admins (production
roster) → Edit**, the _Include_ emails. Zero Trust is on (Free plan); the rest is
`node scripts/env-pull.mjs --environment production -- node scripts/access-setup.mjs`. Its first run starts the list
from the admins in `TEAM_ROSTER__PRODUCTION`; running it again (to rotate the service token, say) keeps the list as it
is, and no deploy touches it. It stores the service token in Secrets Manager. At launch, the same with `--remove`, then set the
`production` environment's variable `LAUNCHED` to `true` (ADR 0010, ADR 0050). The service token lasts a year.

**Rate limiting** (#57): the zone's one free rate-limiting rule blocks an address that sends more than 150 requests in
10 seconds (per Cloudflare data centre) for 10 seconds, on the site, `www.` and the team app, before a scraper costs a
Worker request. The Workers' own limits on forms and sign-in still apply behind it. 150 leaves room for a whole club on
the rink's Wi-Fi (one address) opening the app at once. It's written by
`node scripts/env-pull.mjs --environment production -- node scripts/ratelimit-setup.mjs`, which needs **Zone WAF
Write** on the production token; change the number there and run it again. Seen under Security → WAF → Rate limiting
rules.

**www**: `www.batterseacougars.com` answers too (the deploy attaches both names), so a rule redirects it to the bare
domain (301, path and query kept), and search engines see one copy of each page. It's written by
`node scripts/env-pull.mjs --environment production -- node scripts/redirect-setup.mjs`, which needs **Single
Redirect Write** on the production token. Seen under Rules → Redirect Rules.

**Web Analytics**: on for batterseacougars.com (added 2026-10-10 in the dashboard: Analytics & Logs → Web Analytics),
with automatic setup, so Cloudflare adds its script to the site's pages and there's nothing in the code. It also reaches
`team.batterseacougars.com`, whose CSP refuses it (harmless console errors): excluding it needs a paid rule, so it's
tracked in #92. It counts page views without cookies (the privacy page says so). Its API refuses the
account tokens we use, so it's set up by hand. The website's content security policy allows
its script (`static.cloudflareinsights.com`) and its beacon (`cloudflareinsights.com`) (ADR 0036).
