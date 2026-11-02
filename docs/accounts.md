# The club's accounts

Every outside service the club runs on: who owns it, where to sign in, what's in it, and how it's set up from
scratch. Each secret a service issues (where it's kept, its scopes, what reads it, how to change it) is in
[secrets.md](secrets.md), the section linked from each service here; the rules are in
[ADR 0002](adr/0002-secrets-in-bitwarden.md). Everything here is free.

## Who's who

Accounts are named here by role, never by address:

- **The club account:** the club's Gmail account. It receives enquiries, owns the YouTube channel, and is a second
  owner or administrator everywhere else, so the club never depends on one person.
- **The developer account:** a Gmail account kept for the club's technical work. It sends every email the apps send,
  owns the Google Cloud project, and owns the Sentry organisation, so a password change on the club account breaks
  nothing ([ADR 0027](adr/0027-email-through-gmail-api.md)).
- **A maintainer:** whoever looks after this repo. Their personal account is a co-owner where a person is needed,
  and only until it's handed over (see [Not yet handed over](#not-yet-handed-over)).

**Dev never mails the club.** The dev accounts (Cloudflare **Cougars Dev**, Sanity **Cougars Dev**) have the developer
account and a maintainer as members, never the club account, so their usage and limit emails, and dev's Sentry alerts,
reach the developer account and never the club inbox. The club account is on production only.

## At a glance

| Service                       | Owned by                                                                                                                      | Sign in at                                                         | What it holds                                                            | Its secrets                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| [GitHub](#github)             | Organisation `battersea-cougars`; the club account and a maintainer are owners                                                | <https://github.com/battersea-cougars>                             | The repo, Actions, the rebuild App                                       | [GitHub](secrets.md#github)                          |
| [Bitwarden](#bitwarden)       | The club's organisation (EU server); the club account and a maintainer                                                        | <https://vault.bitwarden.eu>                                       | Secrets Manager: projects `cougars` and `cougars-dev`                    | [Bitwarden](secrets.md#bitwarden)                    |
| [Cloudflare](#cloudflare)     | **Cougars**: the club account and a maintainer; **Cougars Dev**: the developer account and a maintainer; Super Administrators | <https://dash.cloudflare.com>                                      | Workers, D1, the domain, Access, Turnstile, Web Analytics, rate limiting | [Cloudflare](secrets.md#cloudflare)                  |
| [Sanity](#sanity)             | **Cougars**: the club account and a maintainer; **Cougars Dev**: the developer account and a maintainer; Administrators       | <https://www.sanity.io/manage>                                     | The website's editable content and photos                                | [Sanity](secrets.md#sanity)                          |
| [Google Cloud](#google-cloud) | Project `battersea-cougars`, the developer account; the club account a second Owner                                           | <https://console.cloud.google.com>                                 | The Gmail API app, YouTube API keys, Firebase                            | [Google](secrets.md#google)                          |
| [Gmail](#gmail)               | The developer account (sends); the club account (receives)                                                                    | Gmail                                                              | The apps' outgoing mail; the club inbox                                  | [Gmail](secrets.md#gmail)                            |
| [YouTube](#youtube)           | The club account owns the channel; managers upload                                                                            | YouTube Studio                                                     | The club's videos and playlists                                          | None (read with [Google's keys](secrets.md#youtube)) |
| [Instagram](#instagram)       | The club's Meta business portfolio                                                                                            | <https://business.facebook.com>                                    | The club's photos, which the website shows                               | [Instagram](secrets.md#instagram)                    |
| [Sentry](#sentry)             | Organisation `battersea-cougars` (EU), the developer account                                                                  | <https://de.sentry.io>                                             | Errors from both apps; the down alerts                                   | [Sentry](secrets.md#sentry)                          |
| [Apple](#apple)               | A maintainer's developer membership, for now (#103)                                                                           | <https://developer.apple.com>, <https://appstoreconnect.apple.com> | The store app (iOS)                                                      | [Apple](secrets.md#apple)                            |

Secrets that come from no service (keys we make, the starting roster) are in secrets.md too:
[Our own keys](secrets.md#our-own-keys), [Club data](secrets.md#club-data).

## Setting up from scratch

In this order; each step names the secrets it makes, and [secrets.md's order](secrets.md#setting-up-from-scratch)
says how to make each one.

1. [Bitwarden](#bitwarden): the store everything else goes into.
2. [Cloudflare](#cloudflare): both accounts.
3. [Sanity](#sanity): both projects.
4. [GitHub](#github): environments, the rebuild App, the branch rules; then the first dev deploy.
5. [Google Cloud](#google-cloud), [Sentry](#sentry), [Instagram](#instagram), and [Apple](#apple) when the store app
   is built.
6. [The domain](#the-domain): its records come with the first `release` deploy; Access until launch.

## GitHub

- **Organisation** `battersea-cougars`, repo `ark`, public (on the free plan a private repo would lose environments,
  rulesets and unlimited Actions minutes). Owners: the club account and a maintainer.
- **Environments** (Settings → Environments): `production`, deployment branches **`release` only**, holds
  `BWS_ACCESS_TOKEN__PRODUCTION`; `preview` (`main` and PRs) holds `BWS_ACCESS_TOKEN__DEV`. No repository-level
  secrets: nothing else is stored in GitHub ([ADR 0010](adr/0010-environments-and-deploys.md)). Variables → Actions:
  `BWS_SERVER_URL`, `https://vault.bitwarden.eu` (the EU server); on `production`, `LAUNCHED` once the team app is
  open ([The domain](#the-domain)).
- **Branch rules**: `main` and `release` can't be force-pushed or deleted, and `release` changes only through a pull
  request from `main` whose checks pass; a merged pull request's branch is deleted (`delete_branch_on_merge`):
  `node scripts/branch-rules.mjs` (safe to run again).
- **GitHub App "Cougars rebuilds",** owned by the organisation: lets the team app start a website rebuild, and nothing
  else ([ADR 0016](adr/0016-how-the-website-gets-its-data.md)). Its key: [secrets.md](secrets.md#github_app_private_key).
- **First deploy**: deploy dev once, so the `web` worker exists before the first PR preview:
  `node scripts/env-pull.mjs -- bash scripts/deploy-dev.sh`. After that `main` deploys dev and a pull request from
  `main` into `release`, merged, deploys production.

## Bitwarden

- **Organisation** on Bitwarden's EU server, free plan: two people (the club account and a maintainer, both owners),
  three projects, three machine accounts. It has two halves: the **vault** (Password Manager, the `bw` command),
  opened with your master password, and **Secrets Manager** (`bws`), which only takes a machine account's token.
- **Secrets Manager projects:** `cougars` (production: `NAME__PRODUCTION`) and `cougars-dev` (dev, and every shared
  plain `NAME`); the machine accounts `cougars-ci`, `cougars-ci-dev` and `cougars-local`, and which project each
  reads: [secrets.md](secrets.md#bitwarden).
- **Not in Secrets Manager:** account logins (the club and developer accounts' passwords). Secrets Manager holds only
  what the apps, CI and scripts use.
- **Setting it up:** create the organisation, enable Secrets Manager (Free), create the two projects, then the three
  machine accounts and their tokens ([secrets.md](secrets.md#bitwarden)). On your machine, once:
  `bw config server https://vault.bitwarden.eu` and `bw login` as your account in the organisation; then `bw-unlock`
  each container start (the devcontainer keeps its own login, volume `cougars-bitwarden-cli`).

## Cloudflare

Two accounts, so dev can never touch production ([ADR 0010](adr/0010-environments-and-deploys.md)):

|           | **Cougars** (production)                                                                                                                                                                | **Cougars Dev**                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Workers   | `web` (batterseacougars.com, www.), `team` (team.), `studio` (studio.)                                                                                                                  | `web`, `team`, `studio` on its workers.dev subdomain |
| D1        | `cougars`                                                                                                                                                                               | `cougars-dev`                                        |
| Domain    | batterseacougars.com: Cloudflare Registrar and DNS, DNSSEC on ([The domain](#the-domain))                                                                                               | none                                                 |
| Access    | The gate in front of production's team app until launch (the website is open), its admins list kept in the dashboard; a service token for CI's smoke tests (`scripts/access-setup.mjs`) | none                                                 |
| Turnstile | One widget, `cougars`, for the domain (`scripts/turnstile-setup.mjs`)                                                                                                                   | One for workers.dev                                  |
| Also      | Web Analytics; the rate-limiting rule (`scripts/ratelimit-setup.mjs`)                                                                                                                   |                                                      |

**Setting it up**, in each account: create a free account at <https://dash.cloudflare.com/sign-up> (or add a second
account to your login); **Workers & Pages** → pick a `*.workers.dev` subdomain; copy the **Account ID** into
`scripts/lib/settings.mjs` (`CLOUDFLARE_ACCOUNT_ID`, committed: not a secret). Tokens are account API tokens (Manage
Account → Account API Tokens), so they belong to the account, not a person; each one, with its permissions:
[secrets.md](secrets.md#cloudflare). Then Turnstile ([secrets.md](secrets.md#turnstile)).

## Sanity

| Project         | ID         | Dataset               | Used by                                                      |
| --------------- | ---------- | --------------------- | ------------------------------------------------------------ |
| **Cougars**     | `ah165efl` | `production` (public) | The live site and the hosted Studio                          |
| **Cougars Dev** | `zmg6rbe3` | `production` (public) | The dev site, PR previews, your machine and the local Studio |

- The IDs are in `packages/shared/sanity.ts`: not secret, since every image URL carries them, and public datasets need
  no read token. The environment picks the project.
- **Members:** Administrators are the club account and a maintainer; the club's editors are Editors on **Cougars**,
  and on **Cougars Dev** if they want somewhere to practise (Free plan: 20 seats). Vision, the query tool, only appears
  for administrators.
- **The Studio** is self-hosted at studio.batterseacougars.com and dev's on workers.dev
  ([ADR 0004](adr/0004-astro-workers-sanity-d1.md)). A Studio change reaches the live site at the daily rebuild (some time
  after 04:37 UTC), the next release, or a rebuild from the team app (Settings → Website,
  [ADR 0016](adr/0016-how-the-website-gets-its-data.md)); by hand, `gh workflow run deploy.yml --ref release -f apps=web`.
- **Setting a project up:** `npx sanity login` with your own account, create the project (Free plan) with one public
  dataset, `production`, and put its ID in `packages/shared/sanity.ts`. **API → CORS origins**, with credentials,
  added by hand (the deploy token can't): Cougars Dev `http://localhost:4520` (the local Studio, ADR 0115) and
  `https://studio.cougars-dev.workers.dev`; Cougars `https://studio.batterseacougars.com`. Seed the club facts from
  the website's defaults, dev first, with your own login: `npm run seed -w @cougars/studio`, then
  `SANITY_STUDIO_SITE_ENV=production npm run seed -w @cougars/studio`. Its tokens: [secrets.md](secrets.md#sanity).

## Google Cloud

- **Project** _Battersea Cougars_, ID `battersea-cougars` (permanent, so no "website" or "dev" in it), owned by the
  developer account, with the club account a second Owner (**IAM → Grant access**). Free, no billing account.
- **Gmail API:** one OAuth app, "Battersea Cougars" (In production, unverified: only the developer account ever signs
  in, #156), with one Web client, scope `gmail.send` only. Its client, tokens and how to rotate them:
  [secrets.md](secrets.md#gmail).
- **YouTube Data API:** two API keys, one per environment, each restricted to the YouTube Data API
  ([secrets.md](secrets.md#youtube)).
- **Firebase**, for the store app's notifications ([secrets.md](secrets.md#firebase)).

## Gmail

- **The developer account sends** every email: sign-in codes, enquiries, auto-replies, reminders. A password change on
  that account cancels the deployed token: [secrets.md](secrets.md#gmail) says how to make it again (#101).
- **Production reads as the club:** the developer account has the club's address as a "Send mail as" alias, so
  replies reach the club inbox.
- **The club account receives** enquiries. Its address is set in the Studio (Club → Contact email), never in this repo.

## YouTube

- **The channel** belongs to the club account, phone-verified (so uploads can be up to 12 hours). Managers are added
  as **Editor** in YouTube Studio → Settings → Permissions.
- **What the website shows** is set in the Studio (Club → YouTube channel and playlists) and read with the Google Cloud
  keys. The channel's picture, banner and watermark are in [`brand/youtube/`](../brand/README.md).

## Instagram

- **The account** @batterseacougarshockey belongs to the club account, switched to a Professional account (free) so its
  posts can be read through Instagram's API. Admins post there; the website shows the newest
  ([ADR 0016](adr/0016-how-the-website-gets-its-data.md)). There's no dev copy: every environment reads the real one.
- **The club's Meta business portfolio** (business.facebook.com) owns the Instagram account, the Meta app that reads
  it, and the system user `photosreader` whose token the website reads ([secrets.md](secrets.md#instagram)). It has more
  than one admin with full control, so nobody leaving takes anything with them; add a new admin before an old one goes.
  Only an admin with full control can add apps.

## Sentry

- **Organisation** `battersea-cougars`, EU region, free Developer plan (one user: the developer account, which forwards
  the alert emails). Projects `web` and `team`, each event saying its environment; alerts email on a new issue
  (production, dev) and a spike (production), and a cron monitor watches the team Worker's hourly run
  ([ADR 0110](adr/0110-structured-logging.md)). `scripts/sentry-setup.mjs` sets the projects and alerts up
  ([secrets.md](secrets.md#sentry)).

## Apple

- **Apple Developer membership:** a maintainer's for now; making it the club's is #103. The store app is built and
  sent to TestFlight by `store.yml` ([ADR 0108](adr/0108-store-apps.md)). Its key, its IDs and the App Review sign-in:
  [secrets.md](secrets.md#apple).

## The domain

`batterseacougars.com`, bought 2026-10-06 with Cloudflare Registrar (at cost, auto-renew on) on the **Cougars**
account. Registrar lock and contact privacy are on; DNSSEC on (**DNS → Settings**); keep two-factor login on the
account, which controls the domain.

- **Workers on it**: `deploy.yml` sets production's `SITE_URL`, and `scripts/ci/target.mjs` attaches it and `www.` to
  the `web` worker and `team.` to `team` as custom domains (`studio.` is in apps/studio's `wrangler.jsonc`), so a `release` deploy makes the DNS records and
  certificates. That needs the zone permissions on [`CLOUDFLARE_API_TOKEN__PRODUCTION`](secrets.md#cloudflare_api_token__production).
  Dev stays on workers.dev: a domain can only point at workers in its own account. The form rate limit and the edge
  cache work only on the domain (Cloudflare's Cache API is off on `*.workers.dev`).
- **www**: a zone rule redirects `www.` to the bare domain (301, path and query kept), written by every production
  deploy (`scripts/redirect-setup.mjs`); seen under Rules → Redirect Rules.
- **Rate limiting** (#57): the zone's one free rule blocks an address that sends more than 150 requests in 10 seconds
  (per data centre) for 10 seconds, on the site, `www.` and the team app, before a scraper costs a Worker request; 150
  leaves room for a whole club on the rink's Wi-Fi. `node scripts/env-pull.mjs --environment production -- node
scripts/ratelimit-setup.mjs` writes it; change the number there and run it again. Seen under Security → WAF.
- **Cloudflare Access, until launch**: `team.` asks for an email and a one-time code and lets in only the emails on the
  **Admins (production roster)** policy, plus CI's service token for the deploy's smoke tests. The list is kept by
  hand: Zero Trust → **Access → Policies → Admins (production roster) → Edit**. The rest is
  `node scripts/env-pull.mjs --environment production -- node scripts/access-setup.mjs` (its first run starts the list
  from `TEAM_ROSTER__PRODUCTION`; again, it keeps the list, and rotates the [service token](secrets.md#cloudflare-access)).
  At launch: the same with `--remove`, then set the `production` environment's variable `LAUNCHED` to `true` (ADR
  0010, ADR 0050). At launch also switch the Google Auth Platform **Branding** URLs to the domain.
- **Web Analytics**: on for batterseacougars.com, counting page views without cookies (the privacy page says so).
  Its API refuses our account tokens, so it's set up by hand, once: Analytics & Logs → Web Analytics →
  batterseacougars.com → **Manage site**, copy the token from the JS snippet (public: it's in every page) into
  `deploy.yml` as `WEB_ANALYTICS_TOKEN` and release; then turn **automatic setup off** there, so Cloudflare stops adding
  its own beacon to every page, the team app's included ([ADR 0004](adr/0004-astro-workers-sanity-d1.md)).

## Not yet handed over

- **The domain's registrant contact** is a maintainer's: #102.
- **The Apple membership** is a maintainer's: #103.

## Writing about accounts in this repo

The repo is public. Write here:

- **Yes:** secret **names**, which service and role issues each, the permissions it has, where it's used, how to
  rotate it; service, project, organisation and Worker names; IDs that are public anyway (Sanity project IDs, the
  GitHub App's IDs, Turnstile site keys).
- **Never:** a secret's value; anyone's email address or phone number (say "the club account", "the developer
  account", "a maintainer"); a password or where one is kept beyond "Bitwarden"; personal details in issues, ADRs or
  commit messages.

Anything unsure goes in Bitwarden, and the doc names it there.
