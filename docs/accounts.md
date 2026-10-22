# The club's accounts, and where every secret comes from

Every outside service the club runs on: who owns it, what's in it, and which secrets it issues. The secrets themselves
live only in Bitwarden Secrets Manager ([ADR 0002](adr/0002-secrets-in-bitwarden.md)); how each one is made, used
and rotated is in [secrets.md](secrets.md). One-time setup steps are in [setup.md](setup.md).

## Who's who

Accounts are named here by role, never by address:

- **The club account:** the club's Gmail account. It receives enquiries, owns the YouTube channel, and is a second
  owner or administrator everywhere else, so the club never depends on one person.
- **The developer account:** a Gmail account kept for the club's technical work. It sends every email the apps send,
  owns the Google Cloud project, and owns the Sentry organisation, so a password change on the club account breaks
  nothing ([ADR 0027](adr/0027-email-through-gmail-api.md)).
- **A maintainer:** whoever looks after this repo. Their personal account is a co-owner where a person is needed,
  and only until it's handed over (see [Not yet handed over](#not-yet-handed-over)).

## At a glance

| Service                       | Owned by                                                                                              | What it holds                                                            | Secrets it issues (in Bitwarden)                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [GitHub](#github)             | Organisation `battersea-cougars`; club account and a maintainer are owners                            | The repo, Actions, the rebuild App                                       | `GITHUB_APP_PRIVATE_KEY`; GitHub itself holds only the two Bitwarden tokens                                                                                              |
| [Bitwarden](#bitwarden)       | The club's organisation (EU server); club account and a maintainer                                    | Secrets Manager: projects `cougars` and `cougars-dev`                    | The machine-account tokens `BWS_ACCESS_TOKEN__PRODUCTION`, `__DEV`, and the local one                                                                                    |
| [Cloudflare](#cloudflare)     | Accounts **Cougars** and **Cougars Dev**; club account and a maintainer are Super Administrators      | Workers, D1, the domain, Access, Turnstile, Web Analytics, rate limiting | `CLOUDFLARE_API_TOKEN__*`, `CLOUDFLARE_ACCOUNT_ID__*`, `CLOUDFLARE_ANALYTICS_TOKEN__*`, `TURNSTILE_SECRET_KEY`(`__PRODUCTION`), `CF_ACCESS_CLIENT_ID/SECRET__PRODUCTION` |
| [Sanity](#sanity)             | Projects **Cougars** and **Cougars Dev**; club account and a maintainer are Administrators            | The website's editable content and photos                                | `SANITY_DEPLOY_TOKEN__PRODUCTION`                                                                                                                                        |
| [Google Cloud](#google-cloud) | Project `battersea-cougars`, owned by the developer account; club account second Owner                | The Gmail API app, YouTube API keys, Firebase                            | `GMAIL_CLIENT_ID`/`_SECRET`, `GMAIL_WEB_CLIENT_ID`/`_SECRET`, `YOUTUBE_API_KEY__*`, `FIREBASE_*`                                                                         |
| [Gmail](#gmail)               | The developer account (sends); the club account (receives)                                            | The apps' outgoing mail; the club inbox                                  | `GMAIL_REFRESH_TOKEN`                                                                                                                                                    |
| [YouTube](#youtube)           | The club account owns the channel; managers upload                                                    | The club's videos and playlists                                          | None (read with the Google Cloud API keys)                                                                                                                               |
| [Instagram](#instagram)       | The club account owns @batterseacougarshockey (Professional); the developer account owns the Meta app | The club's photos, which the website shows                               | `INSTAGRAM_TOKEN__PRODUCTION` (and our `INSTAGRAM_TOKEN_KEY__PRODUCTION`)                                                                                                |
| [Sentry](#sentry)             | Organisation `battersea-cougars` (EU), the developer account                                          | Errors from both apps; the down alerts                                   | `SENTRY_AUTH_TOKEN`, `SENTRY_DSN_WEB`, `SENTRY_DSN_TEAM`                                                                                                                 |
| [Apple](#apple)               | A maintainer's developer membership, for now (#103)                                                   | The store app (iOS)                                                      | `APP_STORE_CONNECT_KEY`, `_KEY_ID`, `_ISSUER_ID`, `APPLE_TEAM_ID`, `FIREBASE_IOS_CONFIG`, `APP_REVIEW_*__PRODUCTION` (when the store app ships)                          |

Made by us, from no service: `BACKUP_KEY` (`__PRODUCTION`) seals the database backups; `TEAM_ROSTER__PRODUCTION` is
production's first admins; `SMOKE_TOKEN` is made and spent by each deploy and never stored.

## GitHub

- **Organisation** `battersea-cougars`, repo `ark`, public (on the free plan a private repo would lose environments,
  rulesets and unlimited Actions minutes). Owners: the club account and a maintainer.
- **Environments:** `production` (deploys from `release` only) holds `BWS_ACCESS_TOKEN__PRODUCTION`; `preview` (`main`
  and PRs) holds `BWS_ACCESS_TOKEN__DEV`. Nothing else is stored in GitHub ([ADR 0010](adr/0010-environments-and-deploys.md)).
- **GitHub App "Cougars rebuilds",** owned by the organisation: lets the team app start a website rebuild, and nothing
  else. Its private key is `GITHUB_APP_PRIVATE_KEY`; its client and installation IDs aren't secret (README, settings).

## Bitwarden

- **Organisation** on Bitwarden's EU server, free plan: two seats (the club account and a maintainer), three machine
  accounts. Owners: both.
- **Secrets Manager projects:** `cougars` (production: `NAME__PRODUCTION`) and `cougars-dev` (dev, and every shared
  plain `NAME`).
- **Machine accounts:** `cougars-ci` (production deploys, reads both projects), `cougars-ci-dev` (`main` and PRs,
  reads `cougars-dev` only), `cougars-local` (a maintainer's machine). Each one's token is that account's only key;
  the local one sits in its maintainer's own vault, never on disk in the repo.
- **Not in Secrets Manager:** account logins (the club and developer accounts' passwords). Secrets Manager holds only
  what the apps, CI and scripts use.

## Cloudflare

Two accounts, so dev can never touch production ([ADR 0010](adr/0010-environments-and-deploys.md)):

|           | **Cougars** (production)                                                                                                                                                           | **Cougars Dev**                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Workers   | `web` (batterseacougars.com, www.), `team` (team.), `studio` (studio.)                                                                                                             | `web`, `team`, `studio` on its workers.dev subdomain |
| D1        | `cougars`                                                                                                                                                                          | `cougars-dev`                                        |
| Domain    | batterseacougars.com: Cloudflare Registrar and DNS, DNSSEC on                                                                                                                      | none                                                 |
| Access    | The gate in front of production until launch, its admins list kept in the dashboard; a service token for CI's smoke tests; the two health checks open (`scripts/access-setup.mjs`) | none                                                 |
| Turnstile | One widget for the domain (`scripts/turnstile-setup.mjs`)                                                                                                                          | One for workers.dev                                  |
| Also      | Web Analytics; the rate-limiting rule (`scripts/ratelimit-setup.mjs`)                                                                                                              |                                                      |

API tokens are account tokens, named exactly like their secret, each with only the permissions listed under its
README entry. `CLOUDFLARE_ANALYTICS_TOKEN__*` is read-only, for the team app's Usage page.

## Sanity

- **Projects:** **Cougars** (production) and **Cougars Dev**, one public dataset each. Their IDs are in
  `packages/shared/sanity.ts`: not secret, since every image URL carries them, and public datasets need no read token.
- **Members:** Administrators are the club account and a maintainer; the team manager is an Editor. Free plan:
  20 seats.
- **The Studio** is self-hosted at studio.batterseacougars.com ([ADR 0112](adr/0112-self-hosted-studio.md)); its
  CORS origins were added by hand (`setup.md`).
- **Token:** `SANITY_DEPLOY_TOKEN__PRODUCTION` (role Deploy Studio), for the schema deploy. No write token exists.

## Google Cloud

- **Project** `battersea-cougars`, owned by the developer account, the club account a second Owner.
- **Gmail API:** one OAuth app, "Battersea Cougars" (In production, unverified: only the developer account ever signs
  in), with a Desktop client `cougars-website`, scope `gmail.send` only. Its ID and secret are `GMAIL_CLIENT_ID` and
  `GMAIL_CLIENT_SECRET`; a Web client, `GMAIL_WEB_CLIENT_ID` and `GMAIL_WEB_CLIENT_SECRET`, lets an admin reconnect
  from the team app. A client can hold two secrets at once, so a rotation has no gap
  ([secrets.md#gmail](secrets.md#gmail)).
- **YouTube Data API:** two API keys, `YOUTUBE_API_KEY__PRODUCTION` and `__DEV`, each restricted to the YouTube Data
  API.
- **Firebase**, for the store app: `FIREBASE_SERVICE_ACCOUNT` sends notifications; `FIREBASE_IOS_CONFIG` goes into the iOS build.

## Gmail

- **The developer account sends** every email: sign-in codes, enquiries, auto-replies, reminders. Its
  `GMAIL_REFRESH_TOKEN` (`scripts/gmail-auth.mjs`) is cancelled by a password change on that account: re-run the
  script, then redeploy ([secrets.md#gmail](secrets.md#gmail), #101).
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
  ([ADR 0113](adr/0113-photos-from-instagram.md)).
- **The Meta developer app** "Battersea Cougars website", owned by the developer account, with the club's Instagram
  as its tester. It issues the read-only token `INSTAGRAM_TOKEN__PRODUCTION` ([secrets.md#instagram](secrets.md#instagram)). The website renews
  it weekly and keeps the renewed one in D1, sealed with `INSTAGRAM_TOKEN_KEY__PRODUCTION`, which we make.

## Sentry

- **Organisation** `battersea-cougars`, EU region, free Developer plan (one user: the developer account, which forwards
  the alert emails). Projects `web` and `team`; alerts on a new issue (production, dev) and a spike (production), and a cron
  monitor on the team Worker's hourly run ([ADR 0111](adr/0111-errors-and-uptime.md)).
- **Secrets:** `SENTRY_AUTH_TOKEN` (the developer account's personal token: setup and source maps), and the two DSNs,
  made by `scripts/sentry-setup.mjs`.

## Apple

- **Apple Developer membership:** a maintainer's for now; making it the club's is #103.
- **Secrets:** the App Store Connect API key and its IDs, `APPLE_TEAM_ID`, Firebase's iOS
  config, and the App Review sign-in ([secrets.md#apple](secrets.md#apple)). All are in Bitwarden but the App Review
  pair, made when the app first goes to review.

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
