# Secrets: reference

Every secret the website, the team app, the scripts and CI use, by the system it comes from, and within each system
by environment. For each: what it's for, where it comes from, who reads it, how it gets there, whether it expires, and
how to change it. Checked against Bitwarden and the code on 2026-10-23.

- How secrets work, in short: [below](#how-secrets-work).
- The rules, and why: [ADR 0002](adr/0002-secrets-in-bitwarden.md). The two environments:
  [ADR 0010](adr/0010-environments-and-deploys.md).
- Every outside service and who owns it: [accounts.md](accounts.md). Account setup, step by step: [setup.md](setup.md).

## How secrets work

Passwords, keys and tokens the apps need: to deploy, send email, read YouTube and Instagram, send notifications, seal
backups ([ADR 0002](adr/0002-secrets-in-bitwarden.md), [ADR 0010](adr/0010-environments-and-deploys.md)):

- **They live in Bitwarden Secrets Manager, and nowhere else.** Not in files, not in GitHub (bar the two tokens that
  open Bitwarden), not in this public repo. `.env` is for your own non-secret settings only
  ([.env.example](../.env.example)).
- **Two environments, two projects.** Production (Cloudflare account **Cougars**) reads the project `cougars`; dev
  (account **Cougars Dev**: your machine, PR previews, `main`, `scripts/deploy-dev.sh`) reads `cougars-dev`. The dev
  token can't see `cougars` at all.
- **One naming rule.** A plain `NAME` is shared by both environments (it sits in `cougars-dev`); `NAME__PRODUCTION`
  or `NAME__DEV` is that environment's own value. The code always reads plain `NAME`.
- **A token is named exactly like its secret** at the provider that issued it, so the two lists match.
- **Never in this repo:** a value, or anyone's email address or phone number; name accounts by role ("the club
  account", "the developer account"). What's safe to write: [accounts.md](accounts.md#writing-about-accounts-in-this-repo).

- **Every commit is scanned for them** (gitleaks, [ADR 0002](adr/0002-secrets-in-bitwarden.md)): a PR's, a branch's
  in `npm run merge:check`, and the whole history on every push to `main`. `npm run secrets:scan` runs it by hand
  (`-- --since main` for just your branch's commits); it never prints what it finds, only where. A find is a secret
  to rotate, not just to delete: the repo is public.

**On your machine:** run `bw-unlock` once per container start (your master password), and the scripts find their
token themselves ([Bitwarden](#bitwarden)).

```sh
npm run secrets                                  # the names in dev (never values); add -- --environment production
node scripts/env-pull.mjs -- <command>           # run a command with dev's secrets, in memory only
npm run secret:set NAME                          # add or change one (hidden prompt; picks the project from the name)
# or, better: http://localhost:4500/__secrets    # paste it into the Secrets page (below)
npm run app restart                              # the apps pick up dev secrets once Bitwarden is unlocked
```

**Adding one:** create the token at its provider with the secret's name, `npm run secret:set NAME`, and add its entry
here, under its system and environment, and to the [Overview](#overview), in the same change.

### Handing a secret over

Paste it into the **Secrets page**, <http://localhost:4500/__secrets> (linked from `/__app`), never into a terminal, a
chat or a file (#149). The show switch serves it on your machine only: it answers loopback at `localhost`, and only
the page itself can write.

- **Store:** pick the name (every one in the [Overview](#overview) kept in Secrets Manager, and anything else Bitwarden
  holds), paste the value into the hidden field or read it from a file (a `.p8`, a PEM, a JSON key), Save. It goes
  from the supervisor's memory straight to Bitwarden (`setSecret`, the project its name says), and nowhere else: no
  file, no log (the log says only `secrets: NAME updated in cougars-dev`), no terminal, no browser history or
  password manager (there is no form to submit), and it never comes back to the page.
- **Shape:** a value that doesn't look like its secret (a Google client secret is `GOCSPX-…`, a Bitwarden token
  `0.…`, a key PKCS#8 PEM, a service account JSON, our keys 32 bytes of base64; `scripts/lib/secret-shapes.mjs`) or
  that brought a `NAME=` or quotes along is questioned before it's saved.
- **Verify:** each stored value shows as its length, last 4 characters and the first 12 hex digits of its SHA-256.
  **Check** compares a value pasted from the provider with the stored one, in the browser: nothing is sent.
- **After a change,** _Restart the apps_ starts every running app that reads secrets again, so it has the new value.
  _Reconnect_ reads the token from your vault again (after `bw-unlock`, or once the token is changed) without
  restarting anything.

`npm run secret:set NAME` (a hidden prompt) still works for scripts and pipes (`openssl … | npm run secret:set NAME`).

### `.env` and agents

- **`.env` holds no secret.** `npm run lint` and `npm run app` refuse a `.env*` at the top of a checkout with a line
  that looks like one (a documented secret's name, a name with TOKEN, SECRET, KEY and the like, or a value of a known
  secret form), saying the file, line and name, never the value (`scripts/env-check.mjs`); `npm run worktree -- add`
  doesn't copy such a `.env`. Move each to Bitwarden through the Secrets page and delete the line.
- **Agents never print a value.** That's a standing rule in every agent's brief (never read `.env*`, `.dev.vars*`,
  the environment or Bitwarden values; presence checks only), not a hook: the user decided against one (2026-10-24).

## How to read this

Each system has up to three parts: **Production**, **Dev**, and **Both environments** (one value that both use). A
system without one of them doesn't have that heading.

- **Where it's kept.** A production value is in the Bitwarden project `cougars`, named `NAME__PRODUCTION`. A dev
  value, and a value for both environments, is in `cougars-dev`. A dev value is named `NAME__DEV`, or plain `NAME`
  when production has its own `NAME__PRODUCTION` (`BACKUP_KEY`, say: dev's). Exceptions say so.
- **The code always reads the plain `NAME`:** `CLOUDFLARE_API_TOKEN`, never `CLOUDFLARE_API_TOKEN__PRODUCTION`.

Each entry opens with **what it's for**: what stops working without it. Then:

- **Comes from:** the provider, and the account and page where it's made or found. That's where you revoke or
  replace it. "We make it" means a value we generate ourselves, with no outside account.
- **Used by:** what reads it.
- **Gets there by:** how the value reaches what reads it.
- **Expires:** whether it stops working by itself.
- **Changing it:** what to do to replace it, and what breaks until you have.

**Not a secret** marks a value that's an ID or an address: harmless on its own. Such a value is committed, not kept
in Bitwarden: most in [`scripts/lib/settings.mjs`](../scripts/lib/settings.mjs), which `env-pull.mjs` hands to every
command and CI job beside the secrets, under the same name ([Plain settings](#plain-settings)). The exception is
personal data, such as an email address, which stays out of this public repo.

## Contents

- [Bitwarden](#bitwarden): the store itself, and the three tokens that open it
- [Cloudflare](#cloudflare): hosting, the database, Turnstile, Access
- [Google](#google): Gmail, YouTube, Firebase
- [Apple](#apple): the App Store app
- [Sentry](#sentry): error reports
- [Sanity](#sanity): the website's content
- [GitHub](#github): the website rebuild App
- [Instagram](#instagram): the website's photos
- [Web Push](#web-push): browser notifications
- [Our own keys](#our-own-keys): keys we make, with no outside account
- [Club data](#club-data): the starting roster
- [Plain settings](#plain-settings): values that aren't secret, committed in config
- [Setting up from scratch](#setting-up-from-scratch): the order to make everything in
- [Overview](#overview): everything in one table

---

## Bitwarden

Bitwarden is where every secret lives, and nowhere else. The club has one Bitwarden **organisation**, on Bitwarden's
EU server (log in at <https://vault.bitwarden.eu>), on the free plan: 3 projects, 3 machine accounts, 2 people.
People (organisation members) get access to the projects they look after. It has two halves: the **vault**
(Password Manager, the `bw` command), opened with your master password; and **Secrets Manager** (`bws`), which only
takes a **machine account's access token**. Secrets Manager holds what code reads; the vault holds the tokens for
your machine and the recovery copy of a key no code reads (the [Apple push key](#apple-push-key-recovery-copy), in
the organisation's vault, ADR 0002 point 1). Secrets Manager has two projects:

| Project       | Holds                                                                          | Read by                                         |
| ------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| `cougars`     | Production values, named `NAME__PRODUCTION`                                    | `cougars-ci`, `cougars-local`                   |
| `cougars-dev` | Dev values (`NAME__DEV`, or plain `NAME`) and the values both environments use | `cougars-ci`, `cougars-ci-dev`, `cougars-local` |

A production-only secret is always `NAME__PRODUCTION`, so the dev token can't see it.

The three tokens below open Secrets Manager: without them nothing can read the other secrets. One per machine
account, each named like the secret that holds it. None of them is in Secrets Manager itself. Project access is set in
Secrets Manager → **Machine accounts → _account_ → Projects**:

| Token                          | Machine account  | `cougars`       | `cougars-dev`   | Kept in                                             |
| ------------------------------ | ---------------- | --------------- | --------------- | --------------------------------------------------- |
| `BWS_ACCESS_TOKEN__PRODUCTION` | `cougars-ci`     | Can read        | Can read        | GitHub environment `production` (deploys `release`) |
| `BWS_ACCESS_TOKEN__DEV`        | `cougars-ci-dev` | No access       | Can read        | GitHub environment `preview` (`main` and PRs)       |
| `COUGARS_LOCAL_BW_TOKEN`       | `cougars-local`  | Can read, write | Can read, write | your vault: secure note `cougars/.env.local`        |

**How CI uses its token:** the job passes its environment's token to `bws` as `BWS_ACCESS_TOKEN` and runs
`scripts/env-pull.mjs --github-env --environment production|dev`, which exports every other secret into the job,
masked, and the [plain settings](#plain-settings) beside them (`.github/actions/secrets`). Used by every CI job (`deploy.yml`, `backup.yml`, `store.yml`). CI only reads: it
never changes a secret.

### Production

#### `BWS_ACCESS_TOKEN__PRODUCTION`

CI's token for production: deploys from `release`, production backups, the production store build. Without it,
nothing deploys to production.

- **Comes from:** Bitwarden: Secrets Manager → Machine accounts → `cougars-ci` → Access tokens. It reads both
  projects.
- **Kept in:** the GitHub environment `production` (Settings → Environments), which only `release` can use.
- **Used by:** every CI job that runs for production.
- **Gets there by:** GitHub hands it to the job; the job hands it to `bws`.
- **Expires:** as set when it was made. Check the machine account's token list.
- **Changing it:** make a new token on `cougars-ci`, `gh secret set BWS_ACCESS_TOKEN__PRODUCTION --env production`,
  run a deploy, then revoke the old token.

### Dev

#### `BWS_ACCESS_TOKEN__DEV`

CI's token for dev: deploys from `main`, PR previews, dev backups. It can't see `cougars` at all, so a pull request
can never reach a production secret.

- **Comes from:** Bitwarden: Secrets Manager → Machine accounts → `cougars-ci-dev` → Access tokens. It reads
  `cougars-dev` only.
- **Kept in:** the GitHub environment `preview`.
- **Used by:** every CI job on `main` and pull requests.
- **Gets there by:** GitHub hands it to the job; the job hands it to `bws`.
- **Expires:** as set when it was made.
- **Changing it:** make a new token on `cougars-ci-dev`, `gh secret set BWS_ACCESS_TOKEN__DEV --env preview`, run a
  deploy, then revoke the old token.

### Both environments (one value)

#### `COUGARS_LOCAL_BW_TOKEN`

Your machine's token. It can read and write both projects, so you add secrets from the shell
(`npm run secret:set NAME`) and run production scripts (`--environment production`).

- **Comes from:** Bitwarden: Secrets Manager → Machine accounts → `cougars-local` → Access tokens.
- **Kept in:** your Bitwarden vault (not Secrets Manager, not GitHub): the secure note `cougars/.env.local`, as a line
  `COUGARS_LOCAL_BW_TOKEN=...`.
- **Used by:** every script on your machine that needs a secret.
- **Gets there by:** **`bw-unlock` is the login** (once per container start, your master password): the scripts read
  the token from the vault note, and ask for your master password if the vault is locked. Then
  `node scripts/env-pull.mjs -- <command>` runs a command with the dev secrets in memory; add
  `--environment production` for production's.
- **Expires:** as set when it was made.
- **Changing it:** make a new token on `cougars-local`, update the vault note, then revoke the old token.

---

## Cloudflare

Cloudflare runs both apps: the Workers, the D1 database, the domain, Turnstile and Access. There are two accounts, so
dev can never touch production: **Cougars** (production) and **Cougars Dev**. Log in at <https://dash.cloudflare.com>;
the club account and a maintainer are Super Administrators on both. Tokens are **account API tokens** (Manage Account →
**Account API Tokens**): they belong to the account, not a person.

### Production

#### `CLOUDFLARE_API_TOKEN__PRODUCTION`

Deploying anything to production needs it: the Workers, the database, the domain's settings. Without it, nothing
deploys.

- **Comes from:** Cloudflare: the Cougars account → Manage Account → Account API Tokens, named
  `CLOUDFLARE_API_TOKEN__PRODUCTION`. One per account, because a token's deploy rights cover its whole account.
- **Permissions** (account tokens use role-style permissions, grouped by what they apply to):

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

- **Used by:** `deploy.yml` on `release` and Studio publishes (`target.mjs`, migrations, `wrangler deploy`);
  `backup.yml`; `scripts/admin-break-glass.mjs`, `scripts/club-snapshot.mjs` (through `scripts/lib/d1-api.mjs`) and
  the `scripts/*-setup.mjs` scripts, with `--environment production`.
- **Gets there by:** CI pull from Bitwarden. On your machine,
  `node scripts/env-pull.mjs --environment production -- <script>`.
- **Expires:** no, unless you set a TTL.
- **Changing it:** roll it in the dashboard, `npm run secret:set CLOUDFLARE_API_TOKEN__PRODUCTION`, run one deploy.

#### `CLOUDFLARE_ACCOUNT_ID` (production's)

Cloudflare's API addresses everything by account, so every call needs the account's ID beside the token. **Not a
secret: an ID**, on the account's home page and in every dashboard URL; useless without a token. It lives in
`scripts/lib/settings.mjs` (`CLOUDFLARE_ACCOUNT_ID.production`), not in Bitwarden.

- **Comes from:** Cloudflare: the Cougars account's ID (dashboard → Account home → ⋮ → Copy account ID). Not
  something we make; it identifies the account.
- **Used by:** everything that uses the API token above (wrangler reads it too), and the team app's Usage page (with
  the analytics token).
- **Gets there by:** `env-pull.mjs` hands it over beside the secrets, in CI and on your machine; `target.mjs` puts it
  on the team Worker as a var.
- **Expires:** never.
- **Changing it:** only for a new account: edit `scripts/lib/settings.mjs`, commit.

#### `CLOUDFLARE_ANALYTICS_TOKEN__PRODUCTION`

The team app's Usage page, and its hourly check, read today's Worker requests and database rows from Cloudflare, to
warn the admins before the free allowance runs out ([ADR 0059](adr/0059-usage-page-and-check.md)). Read-only. It
lives inside the Worker, so it's never the deploy token. Without it the page says "Not set up yet".

- **Comes from:** Cloudflare: the Cougars account → Manage Account → Account API Tokens, named
  `CLOUDFLARE_ANALYTICS_TOKEN__PRODUCTION`. Permission: **Account Analytics Read** on the entire Cougars account.
- **Used by:** the team Worker (`apps/team/worker/settings/usage.ts`), with `CLOUDFLARE_ACCOUNT_ID`.
- **Gets there by:** a Worker secret, put on by `deploy.yml` when the team app deploys.
- **Expires:** no, unless you set a TTL.
- **Changing it:** roll it in the dashboard, update Bitwarden, deploy the team app.

#### `TURNSTILE_SECRET_KEY__PRODUCTION`

Production's [Turnstile](#turnstile) secret: it checks that a person, not a bot, filled in a form. Without it,
production's website sends no auto-replies, and production's team app refuses sign-in.

- **Comes from:** Cloudflare: the Cougars account → Turnstile → the widget `cougars` → secret key.
  `turnstile-setup.mjs` makes the widget and stores this.
- **Used by:** the website's `/api/join`, and the team app's `/api/auth/start` and `/api/auth/request`
  (`worker/auth/auth.turnstile.ts`), to check each form's answer with Cloudflare.
- **Gets there by:** CI pull, then `deploy.yml` puts it on both Workers as a secret on every deploy.
- **Expires:** no.
- **Changing it:** the widget → **Rotate secret key**, update Bitwarden, deploy.

#### `CF_ACCESS_CLIENT_ID__PRODUCTION`, `CF_ACCESS_CLIENT_SECRET__PRODUCTION`

Until launch, production is behind [Cloudflare Access](#cloudflare-access). The deploy's smoke tests send this service
token as two headers to get past it. Without it, production's smoke tests fail. Goes away at launch. The client ID is
**not a secret on its own** (half of a pair, useless without the secret).

- **Comes from:** Cloudflare: the Cougars account → Zero Trust → Access → Service Auth → the service token.
  `access-setup.mjs` makes it and stores both values.
- **Used by:** `scripts/ci/smoke-test.mjs` and the team job's smoke test in `deploy.yml`.
- **Gets there by:** CI pull.
- **Expires:** a year after it's made.
- **Changing it:** `node scripts/env-pull.mjs --environment production -- node scripts/access-setup.mjs` creates
  the token and stores both values straight in Bitwarden (nobody sees the secret). Run again with the secret
  missing, it rotates the token and stores the new one.
- **At launch:** `access-setup.mjs --remove` deletes the token; then delete both secrets.

### Dev

#### `CLOUDFLARE_API_TOKEN__DEV`

Deploying anything to dev: the Workers and the database, on `main`, for pull requests (preview versions) and from
your machine.

- **Comes from:** Cloudflare: the Cougars Dev account → Manage Account → Account API Tokens, named
  `CLOUDFLARE_API_TOKEN__DEV`.
- **Permissions:** scope **Entire Cougars Dev account**; **Workers Admin** (Editor can't create a new worker),
  **D1 Write**, **Turnstile Write** (`scripts/turnstile-setup.mjs`).
- **Used by:** `deploy.yml` on `main` and pull requests, `backup.yml`, `scripts/deploy-dev.sh`, and the scripts
  above run for dev.
- **Gets there by:** CI pull. On your machine, `node scripts/env-pull.mjs -- bash scripts/deploy-dev.sh`.
- **Expires:** no, unless you set a TTL.
- **Changing it:** roll it in the dashboard, `npm run secret:set CLOUDFLARE_API_TOKEN__DEV`, run one deploy.

#### `CLOUDFLARE_ACCOUNT_ID` (dev's)

The Cougars Dev account's ID, for the same reasons as production's. **Not a secret: an ID.** It lives in
`scripts/lib/settings.mjs` (`CLOUDFLARE_ACCOUNT_ID.dev`), not in Bitwarden.

- **Comes from:** Cloudflare: the Cougars Dev account's ID (dashboard → Account home → ⋮ → Copy account ID). Not
  something we make.
- **Used by:** everything that uses the dev token, and dev's Usage page.
- **Gets there by:** `env-pull.mjs`, as production's.
- **Expires:** never.

#### `CLOUDFLARE_ANALYTICS_TOKEN__DEV`

Dev's Usage page, as production's, and the CPU time per route.

- **Comes from:** Cloudflare: the Cougars Dev account → Manage Account → Account API Tokens, named
  `CLOUDFLARE_ANALYTICS_TOKEN__DEV`. Permissions, on the entire Cougars Dev account: **Account Analytics Read**
  (today's Worker requests and D1 rows) and **Workers Observability Read** (CPU time per route,
  `scripts/cpu-by-route.mjs`, ADR 0059). Cloudflare lists Workers Observability under its legacy permissions; it still
  works. Production's doesn't need it.
- **Used by:** the dev team Worker (`worker/settings/usage.ts`); `scripts/cpu-by-route.mjs` and the load tests'
  report.
- **Gets there by:** a Worker secret, put on by `deploy.yml`. On your machine,
  `node scripts/env-pull.mjs -- npm run dev -w @cougars/team` passes it to the dev server (`vite.config.ts`), in
  memory, never to a file.
- **Expires:** no, unless you set a TTL.
- **Changing it:** roll it in the dashboard, update Bitwarden, deploy the team app.

#### `TURNSTILE_SECRET_KEY`

Dev's [Turnstile](#turnstile) secret (a plain name, but dev's: production has its own).

- **Comes from:** Cloudflare: the Cougars Dev account → Turnstile → the widget `cougars` → secret key.
- **Used by:** the dev website and team app, as production's.
- **Gets there by:** CI pull, then `deploy.yml` puts it on both Workers. Your machine has none: see
  [Turnstile](#turnstile).
- **Expires:** no.
- **Changing it:** the widget → **Rotate secret key**, `npm run secret:set TURNSTILE_SECRET_KEY`, deploy.

### Turnstile

Cloudflare Turnstile tells people from bots on the "Try a session" form, and only people get the automatic reply
([ADR 0028](adr/0028-turnstile-and-auto-reply.md)). Free. The team app's sign-in and Ask to join use the same widget
and secret (#13), and refuse a failed check. One widget per account, named `cougars`. Its hostnames cover the website
and the team app (`team.cougars-dev.workers.dev`, `team.batterseacougars.com`), so there's no second widget.

Without the secret, nobody counts as verified on the website: enquiries are still saved and emailed to the club, but
nobody gets an auto-reply. The team app on your machine then checks nothing; a deployed production team app refuses
sign-in until it has one. Your machine uses Cloudflare's test site key (always passes) and no secret, so no
auto-replies locally; the team app on your machine has no site key and no secret, so it shows no widget and checks
nothing.

**Setting it up:** `node scripts/env-pull.mjs [--environment production] -- node scripts/turnstile-setup.mjs
dev|production`. It stores the secret key straight in Bitwarden (nobody sees it) and prints the **site key**, which is
public and goes in `deploy.yml` as `TURNSTILE_SITE_KEY` (the website's job and the team app's). The account's
`CLOUDFLARE_API_TOKEN` needs **Turnstile Write**. By hand instead: sidebar **Turnstile** (under _Application
security_ in the new dashboard) → **Add widget**: name `cougars-website`, hostname the site's (Cougars Dev:
`cougars-dev.workers.dev`, which covers `web.` and its PR previews; Cougars: `batterseacougars.com`), widget mode
**Managed**, pre-clearance **No** → **Create**. Put the site key in `deploy.yml`, then
`npm run secret:set TURNSTILE_SECRET_KEY` (dev) or `TURNSTILE_SECRET_KEY__PRODUCTION`.

### Cloudflare Access

Until launch, production is behind Cloudflare Access ([setup.md](setup.md)): only people on its list get in, and CI
gets past it with the service token above. At launch the gate and the token go.

---

## Google

One Google Cloud project for the whole club: _Battersea Cougars_, ID `battersea-cougars` (permanent, so no "website"
or "dev" in it), at <https://console.cloud.google.com>. It's owned by **the developer account** (the Gmail account
kept for the club's technical work), with the club's Gmail account as a second Owner (**IAM → Grant access**), so the
club can always reach it. Free, no billing account. The Gmail clients, the YouTube keys and Firebase all live in it.

### Production

#### `YOUTUBE_API_KEY__PRODUCTION`

The live website lists the club's YouTube videos ([YouTube](#youtube)). Without it the site still works, and shows
only the videos in Sanity.

- **Comes from:** Google: the project `battersea-cougars` → APIs & Services → Credentials → the API key named
  `YOUTUBE_API_KEY__PRODUCTION`, restricted to the YouTube Data API v3.
- **Used by:** the website Worker's `/videos` page and the home video reel, and the build. It reads public data only
  and never reaches the browser.
- **Gets there by:** CI pull, then `deploy.yml` puts it on the Worker as a secret on every deploy.
- **Expires:** no.
- **Changing it:** Credentials → the key → **Regenerate key**, update Bitwarden, deploy.

### Dev

#### `YOUTUBE_API_KEY__DEV`

The same for dev, previews and your machine, so a leaked dev key can be revoked without touching production.

- **Comes from:** Google: the project `battersea-cougars` → APIs & Services → Credentials → the API key named
  `YOUTUBE_API_KEY__DEV`.
- **Used by:** the dev website, as production's.
- **Gets there by:** CI pull, then `deploy.yml`. On your machine, `node scripts/env-pull.mjs -- npm run dev`.
- **Expires:** no.
- **Changing it:** **Regenerate key**, update Bitwarden, deploy.

### Both environments (one value)

The [Gmail](#gmail) values are one copy for both environments: production sends from the developer account too, so
resetting the club account's password breaks nothing (ADR 0027).

#### `GMAIL_REFRESH_TOKEN`

The deployed token: it lets both apps send email as the developer account. It can send mail as that account and
nothing else: it can't read the mailbox. Used only while no admin has [reconnected](#gmail) a token in D1.

- **Comes from:** Google: issued to the developer Gmail account when it consents in `scripts/gmail-auth.mjs`; it
  shows in that account's [third-party access](https://myaccount.google.com/connections), where you revoke it. It
  works only with the client that made it: the Web client.
- **Used by:** the website's enquiry form (Worker) and the team app's sign-in codes and notices.
- **Gets there by:** CI pull (both environments read the same token), then `deploy.yml` puts it on both Workers as a
  secret on every deploy. On your machine, `node scripts/env-pull.mjs -- npm run dev`. The team app's dev server never
  gets it, so only a token reconnected on your machine sends from there.
- **Expires:** no, but Google cancels a token when the account's password changes, when access is removed in
  third-party access, or after 6 months unused.
- **Changing it:** re-run `node scripts/gmail-auth.mjs`, then deploy both environments. Usually an admin reconnects in
  the app instead ([Gmail](#gmail)).

#### `GMAIL_WEB_CLIENT_ID`, `GMAIL_WEB_CLIENT_SECRET`

The **Web client**, the one Google client: `scripts/gmail-auth.mjs` signs in with it to make the deployed token, and
the team app with it when an admin presses **Reconnect email**. The Workers refresh either token with it. Without it,
no email is sent at all (they're logged). The ID is **not a secret** (Google's consent page shows it in its URL), but
it's kept beside its secret, which is.

- **Comes from:** Google: the project `battersea-cougars` → Google Auth Platform → Clients → the Web client
  `GMAIL_WEB_CLIENT_ID`.
- **Used by:** both Workers, to send with either token; the team Worker (Reconnect email, `worker/mail`);
  `scripts/gmail-auth.mjs`.
- **Gets there by:** CI pull, then `deploy.yml` puts them on both Workers. On your machine the team app's dev server
  gets them through `env-pull.mjs`, in memory.
- **Expires:** no.
- **Changing it:** **Clients → the client → Add secret**, update Bitwarden, deploy, delete the old secret.

#### `FIREBASE_SERVICE_ACCOUNT`

The JSON key of a Google service account, `firebase-service-account` (Google allows no capitals), role **Firebase
Cloud Messaging API Admin** only. The team Worker signs an hour's token with it to send a notification to the store
app ([Firebase](#firebase)). Without it, the store app gets no notifications. **A leaked key could** send our
members notifications, nothing else.

- **Comes from:** Google: the project `battersea-cougars` → IAM → Service accounts → `firebase-service-account` →
  Keys. `firebase-setup.mjs` makes it and stores it.
- **Used by:** the team Worker (`worker/push/fcm.ts`, `worker/push/push.ts`).
- **Gets there by:** CI pull, then `deploy.yml` puts it on the team Worker as a secret.
- **Expires:** no.
- **Changing it:** add a new key to the service account, store it, deploy `team`, delete the old key.

#### `FIREBASE_IOS_CONFIG`

The iOS app's `GoogleService-Info.plist`. Without it the store app can't be built. **Not much of a secret** (it ships
inside the app, and its API key is limited to this app), but it stays out of the public repo.

- **Comes from:** Google: the Firebase console → project `battersea-cougars` → Project settings → Your apps → the
  iOS app. `firebase-setup.mjs` makes the app and stores this.
- **Used by:** `store.yml`, which writes it into the Xcode project for the build.
- **Gets there by:** CI pull.
- **Expires:** no.
- **Changing it:** download it again and store it (`node scripts/secret-set.mjs FIREBASE_IOS_CONFIG < file`).

### Gmail

The website emails the club inbox about each enquiry and auto-replies to the enquirer; the team app sends sign-in
codes and notices. Both send through the Gmail API (HTTPS, not SMTP; no password is stored anywhere), as the
developer account. Without a token, emails are logged, not sent ([ADR 0027](adr/0027-email-through-gmail-api.md)).
Outside production every email goes to one safe inbox, and dev can only ever send from its own test account, never
the club's.

There's one Google "client" (an app that may ask for a token), the **Web client** (`GMAIL_WEB_CLIENT_ID`,
`GMAIL_WEB_CLIENT_SECRET`), and two places a token it made can be:

- The **deployed token**, `GMAIL_REFRESH_TOKEN`, made with `scripts/gmail-auth.mjs` (the first one, and the way back
  in from a terminal). It's in Bitwarden.
- The **reconnected token**, made when an admin presses **Reconnect email** in the team app. It's kept in D1, sealed
  with [`GMAIL_TOKEN_KEY`](#gmail_token_key) (ADR 0002 point 8, `packages/shared/gmail-token.ts`).

The reconnected one wins once it exists. A token only works with the client that made it, so a new client means
making the deployed token again.

**When Google cancels the token**, an admin fixes it in the team app: **Settings → Email → Reconnect email**. Google's
consent page opens; they sign in as the developer account and tick _Send email on your behalf_. It works at once in
both Workers, with no deploy; each environment keeps its own. The admins hear about it on Home and on their phones.
Settings → Email also shows the sending account, the From address and the last send or failure. From a terminal
instead: re-run `gmail-auth.mjs`, then deploy both environments (it's only used while no reconnected token is in D1).

**Setting up Gmail**, once, in the Google Cloud console as the developer account:

1. **APIs & Services → Library → Gmail API → Enable**.
2. **Google Auth Platform → Get started**: app name _Battersea Cougars_ (both apps share it), support and contact
   email the developer account's, audience **External**.
3. **Data access → Add or remove scopes**: `.../auth/gmail.send` only (_Send email on your behalf_). Save.
4. **Branding**: application home page and privacy policy, the site's `/` and `/privacy/` (the dev site's
   `https://web.cougars-dev.workers.dev` until there's a domain; switch them, and the authorised domain, when there
   is). Save.
5. **Audience → Publish app**, to **In production**. In _Testing_, Google cancels tokens after 7 days. It stays
   unverified (Google warns on the consent screen, which is fine: only the developer account ever signs in).
6. **Clients → Create client → Web application**, named `GMAIL_WEB_CLIENT_ID`. **Authorised redirect URIs:**
   `https://team.batterseacougars.com/api/mail/callback` and `https://team.cougars-dev.workers.dev/api/mail/callback`
   (reconnecting from the team app), and `http://localhost:4590/` (`gmail-auth.mjs`). No JavaScript origins needed.
   Create, then `npm run secret:set GMAIL_WEB_CLIENT_ID`, then `GMAIL_WEB_CLIENT_SECRET`.
7. **The first token:** `node scripts/gmail-auth.mjs`, signed in as the developer account. It opens Google's consent
   page, catches the answer on `http://localhost:4590` and saves `GMAIL_REFRESH_TOKEN` straight to Bitwarden;
   nothing is printed. It refuses the club's account. This is also the way back in from a terminal if no admin can
   sign in.
8. **The club's address as the sender:** in the developer account's Gmail, **Settings → Accounts and Import → Send
   mail as → Add another email address**: name _Battersea Cougars_, address the club's Gmail address, **Treat as an
   alias** ticked. Gmail emails the club account a confirmation link; open it there. Production then sends as the
   club's address, and replies land in the club inbox. Without it, production sends as the developer account. The
   club's address is the Studio's **Club → Contact email**: change both together.

### YouTube

The website lists the club's YouTube videos live (`apps/web/src/lib/server/videos.ts`,
[ADR 0016](adr/0016-photos-and-videos-read-live.md)). One key per environment.

**Setting it up:** **APIs & Services → Library → YouTube Data API v3 → Enable**, then **Credentials → Create
credentials → API key**. Name it like the secret, and under **API restrictions** pick **Restrict key → YouTube Data
API v3** only. No application restriction: CI has no fixed IP address. Both keys share the project's free quota of
10,000 units a day; with the 10-minute cache the site uses a few hundred at most.

### Firebase

The team Worker sends notifications to the store app through Firebase Cloud Messaging
([ADR 0108](adr/0108-store-apps.md)). Firebase is switched on in the same Google Cloud project, at
<https://console.firebase.google.com>.

**Setting it up:** `node scripts/firebase-setup.mjs`, signed in with `gcloud auth login` as an Owner of
`battersea-cougars`. It turns Firebase on, makes the iOS app and the service account, and stores both secrets
straight in Bitwarden. The one step it can't do is upload the [Apple push key](#apple-push-key-recovery-copy) in
the Firebase console; it prints the link.

---

## Apple

The team app in the App Store ([ADR 0108](adr/0108-store-apps.md)): built and sent to TestFlight by `store.yml`.
Owned, for now, by a maintainer's Apple Developer membership (log in at <https://developer.apple.com> and
<https://appstoreconnect.apple.com>); making it the club's is #103. One copy each, used by both environments, except
the App Review pair, which is production's alone.

**Android, later:** `PLAY_SERVICE_ACCOUNT` (Play Console upload), `PLAY_UPLOAD_KEY` and `FIREBASE_ANDROID_CONFIG`
join these (ADR 0108).

### Production

#### `APP_REVIEW_EMAIL__PRODUCTION`, `APP_REVIEW_CODE__PRODUCTION`

Apple's reviewers sign in to the app, and can't read our email. So this one member's email takes this fixed six-digit
code instead of an emailed one (ADR 0023, 0108), with every other sign-in limit as ever. The member is a plain Member
in production's roster. The email is **not a secret** but it's an address, so it stays out of this public repo.
**Not in Bitwarden yet:** they're made when the app first goes to review.

- **Comes from:** we make them: the code at random, the email a member address we pick. Both then go to Apple in App
  Store Connect's App Review Information.
- **Used by:** the team Worker's sign-in (`worker/auth/auth.ts`).
- **Gets there by:** CI pull, then `deploy.yml` puts both on the team Worker.
- **Expires:** no. Change the code after each review if you like.
- **Setting it up:**
  `node -e 'process.stdout.write(String(require("crypto").randomInt(1e5, 1e6)))' | node scripts/secret-set.mjs APP_REVIEW_CODE__PRODUCTION`,
  and `npm run secret:set APP_REVIEW_EMAIL__PRODUCTION`.

### Both environments (one value)

#### `APP_STORE_CONNECT_KEY`

So CI can sign and upload the app with no certificates to keep. Without it, `store.yml` can't build. **A leaked key
could** upload builds and change the app's store listing, not release one past Apple's review.

- **Comes from:** Apple: App Store Connect → Users and Access → Integrations → Team Keys, the key named
  `APP_STORE_CONNECT_KEY`, access **App Manager**: its `.p8` file, which Apple lets you download once only.
- **Used by:** `store.yml` and `scripts/store-setup.mjs`.
- **Gets there by:** CI pull.
- **Expires:** no.
- **Changing it:** make a new key, store it (and its ID below), revoke the old one.
- **Setting it up:** download the `.p8`, then `node scripts/secret-set.mjs APP_STORE_CONNECT_KEY < AuthKey_XXXX.p8`
  and delete the file.

#### `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`

Which key that is, and whose: Apple asks for both beside the `.p8`. **Not a secret: IDs**, useless without the key.
They live in `scripts/lib/settings.mjs`, not in Bitwarden.

- **Comes from:** Apple: the same Team Keys page. The Key ID is in the key's row; the Issuer ID is at the top of the
  page.
- **Used by:** `store.yml` and `scripts/store-setup.mjs`.
- **Gets there by:** `env-pull.mjs` hands them over beside the secrets.
- **Expires:** never (a new key has a new ID: edit `settings.mjs` with it, and commit).

#### `APPLE_TEAM_ID`

The Apple Developer team's ID. Without it, the build can't be signed, and phones won't open team app links in the app
or use its passkeys. **Not a secret: an ID** (every app link carries it). It lives in `scripts/lib/settings.mjs`, one
copy, not in Bitwarden.

- **Comes from:** Apple: Apple Developer → Account → Membership details → Team ID. Not something we make;
  `scripts/store-setup.mjs` reads it from Apple (the bundle id's prefix) and checks the committed one.
- **Used by:** `store.yml` (signing), and the team Worker, which serves it to phones at
  `/.well-known/apple-app-site-association` (`worker/store/store.links.ts`).
- **Gets there by:** `env-pull.mjs` hands it to `store.yml`; `target.mjs` puts it on the team Worker as a var. Your
  machine's team app has none, so it serves no app links.
- **Expires:** never.

#### Apple push key (recovery copy)

The APNs key, uploaded to Firebase (Project settings → Cloud Messaging → Apple app configuration), which uses it to
reach iPhones. **No code reads it**, so it isn't in Secrets Manager (nothing should export it into a CI job). It's
kept only as a recovery copy, because Apple lets you download it once (ADR 0002 point 1). Its Key ID is **not a
secret**. **A leaked key could** send notifications to the app's users, given their phones' tokens.

- **Comes from:** Apple: Apple Developer → Certificates, IDs & Profiles → Keys → the APNs key (its `.p8`, and its Key
  ID).
- **Kept in:** the club's Bitwarden **vault** (Password Manager), in the organisation's collection, as the secure note
  **Apple push key (APNs)**: the `.p8`'s text in the note, the Key ID in a field `Key ID`. Both organisation members
  can open it.
- **Used by:** nothing; Firebase holds its own copy.
- **Expires:** no.
- **Changing it:** make a new key, upload it to Firebase, replace the note's contents, revoke the old one (Apple allows
  two at a time).
- **Setting it up:** Keys → +, **Apple Push Notifications service**, Sandbox & Production; download the `.p8`, paste it
  into the vault note with its Key ID, upload it to Firebase, then delete the file.

---

## Sentry

Errors from both apps, server and browser, and the down alerts ([ADR 0110](adr/0110-structured-logging.md)). One
organisation, `battersea-cougars`, in Sentry's **EU region** (log in at <https://de.sentry.io>), on the free Developer
plan (one user: the developer account, which forwards the alerts). Projects `web` and `team`; each event says its
environment. Alerts email on a new issue in **production** or **dev**, and on a spike in production; the team
Worker's hourly cron has a cron monitor. Without these, errors only go to the log. Everything here is one copy for
both environments.

### Both environments (one value)

#### `SENTRY_AUTH_TOKEN`

Sets Sentry up and uploads source maps, so error reports show our code, not minified code.

- **Comes from:** Sentry: the developer account's User settings → Personal Tokens, named `SENTRY_AUTH_TOKEN`, with
  Project Admin, Team Read & Write, Release Admin, Issue & Event Read, Organization Read and Alerts Read & Write.
- **Used by:** `scripts/sentry-setup.mjs` (projects, the alerts, the cron and uptime monitors) and the deploy's
  "Source maps" steps.
- **Gets there by:** CI pull. Set with `npm run secret:set SENTRY_AUTH_TOKEN`.
- **Expires:** no.
- **Changing it:** make a new one, set it, revoke the old.

#### `SENTRY_ISSUES_TOKEN`

Lets the team app's Worker read the open issues in both projects for Settings → Errors
([ADR 0110](adr/0110-structured-logging.md)). **Read-only**, so a leak shows our error titles and nothing more: never
the deploy's `SENTRY_AUTH_TOKEN`. Without it the page says it isn't set up; errors still go to Sentry and the alerts
still email.

- **Comes from:** Sentry: the developer account's User settings → Personal Tokens → Create New Token, named
  `SENTRY_ISSUES_TOKEN`, with one scope, **Issue & Event: Read** (`event:read`), and every other permission left at
  No Access. (An organisation token can't read issues.)
- **Used by:** the team Worker (`apps/team/worker/settings/errors.ts`), asking `de.sentry.io` at most every five
  minutes, whoever opens the page.
- **Gets there by:** CI pull; `deploy.yml` puts it on the team Worker as a secret (one value, so dev and production
  read the same organisation and each shows its own environment's issues). On your machine, a team app started
  through `env-pull.mjs` has it in memory (`vite.config.ts`).
- **Expires:** no.
- **Changing it:** make a new one with the same name and scope, `npm run secret:set SENTRY_ISSUES_TOKEN`, deploy (or
  re-run the team job), then revoke the old one. Until the deploy, the page says Sentry didn't accept the token.

#### `SENTRY_DSN_WEB`

Where the website sends its errors. **Not really secret**, but none of it reaches a browser, so it's kept out of this
public repo: nobody can fill our free quota with fake errors.

- **Comes from:** Sentry: the project `web` → Settings → Client Keys (DSN). `sentry-setup.mjs` reads it and stores
  it.
- **Used by:** the website Worker (as `SENTRY_DSN`).
- **Gets there by:** CI pull; `deploy.yml` puts it on the Worker as `SENTRY_DSN`. Unset (your machine): no reports,
  only the log.
- **Expires:** no.
- **Setting up or checking:** `node scripts/env-pull.mjs -- node scripts/sentry-setup.mjs` (add `--uptime` for the
  monitors).

#### `SENTRY_DSN_TEAM`

Where the team app sends its errors, from the Worker and the browser. **Not a secret:** it's in the team app's
browser code for anyone to read, so it lives in `scripts/lib/settings.mjs`, not in Bitwarden.

- **Comes from:** Sentry: the project `team` → Settings → Client Keys (DSN). `sentry-setup.mjs` checks the committed
  one and says what to put there if it differs.
- **Used by:** the team Worker (as `SENTRY_DSN`), and the team app in the browser (built in as `VITE_SENTRY_DSN`).
- **Gets there by:** `env-pull.mjs` hands it to the deploy, which builds the team app with `VITE_SENTRY_DSN`;
  `target.mjs` puts it on the Worker as the var `SENTRY_DSN`. Unset (your machine): no reports, only the log.
- **Expires:** no.

---

## Sanity

Two Sanity projects hold the website's content: **Cougars** (`ah165efl`, production) and **Cougars Dev**
(`zmg6rbe3`), each with one public `production` dataset (log in at <https://www.sanity.io/manage>). Their IDs aren't
secret (`packages/shared/sanity.ts`), and public datasets need no read token. The club account and a maintainer are
Administrators.

### Production

#### `SANITY_DEPLOY_TOKEN__PRODUCTION`

Lets CI send the Studio's schema to Sanity on every push to `release`, so Sanity's own tools know the fields. The
Studio itself is self-hosted at <https://studio.batterseacougars.com> ([ADR 0112](adr/0112-self-hosted-studio.md)),
deployed with Cloudflare's token. Without it, the schema deploy step fails.

- **Comes from:** Sanity: manage → project **Cougars** → API → Tokens, role **Deploy Studio**, named
  `SANITY_DEPLOY_TOKEN__PRODUCTION`.
- **Used by:** the `studio` job in `deploy.yml` (`sanity schemas deploy`, which reads it as `SANITY_AUTH_TOKEN`).
- **Gets there by:** CI pull; the job maps `SANITY_DEPLOY_TOKEN` to `SANITY_AUTH_TOKEN`. Never name it
  `SANITY_STUDIO_*`: the Studio build puts those variables in its public JavaScript.
- **Expires:** no.
- **Changing it:** add a new Deploy Studio token with the same name, update Bitwarden, push `release` (or re-run the
  job), delete the old token.

---

## GitHub

The repository `battersea-cougars/ark`, in the `battersea-cougars` organisation. GitHub holds only the two
[Bitwarden tokens](#bitwarden), one per GitHub environment. Everything else is in Bitwarden.

### Both environments (one value)

#### `GITHUB_APP_PRIVATE_KEY`

The private key of the GitHub App **Cougars rebuilds**. The team Worker signs a short request with it and swaps that
for a token that lasts an hour, to start a website rebuild when a result changes
([ADR 0100](adr/0100-website-reads-tournament-results.md)). Without it, results reach the website only at the daily
rebuild. Nothing needs a different value per environment.

- **Comes from:** GitHub: the `battersea-cougars` organisation (not a person, so it outlives any maintainer) →
  Settings → Developer settings → GitHub Apps → Cougars rebuilds → Private keys. Installed on `battersea-cougars/ark`
  only, webhook off.

  | Applies to              | Permission          | Why                                                |
  | ----------------------- | ------------------- | -------------------------------------------------- |
  | `battersea-cougars/ark` | Actions: read/write | Running `deploy.yml` for the website (`apps: web`) |
  | `battersea-cougars/ark` | Metadata: read      | Required by GitHub for every App                   |

  **A leaked key could** start or cancel workflow runs, and delete runs and their artifacts (old backups,
  [ADR 0106](adr/0106-database-backups.md)). Not push code, not read secrets, not change settings. Each token the
  Worker takes asks for Actions: write on this repo alone. `main` and `release` refuse force-pushes and deletion
  (repository ruleset), and only `release` deploys production.

- **Used by:** the team Worker (`worker/website/website.ts`), with the App's Client ID and installation ID (not
  secret, [Plain settings](#plain-settings)).
- **Gets there by:** a Worker secret when the team app deploys.
- **Expires:** no.
- **Changing it:** generate a new key on the App, store it as below, redeploy, then delete the old key on the App.
- **Format:** PKCS#8 (`-----BEGIN PRIVATE KEY-----`), which the Workers runtime imports. GitHub hands out PKCS#1, so
  convert when storing (never save the file in the repo; `*.pem` is gitignored):
  `openssl pkcs8 -topk8 -nocrypt -in KEY.pem | node scripts/secret-set.mjs GITHUB_APP_PRIVATE_KEY`

---

## Instagram

The website's photos are the club's Instagram posts (`apps/web/src/lib/server/instagram.ts`,
[ADR 0016](adr/0016-photos-and-videos-read-live.md)). The club account owns the Instagram account (Professional); the
developer account owns the Meta app "Battersea Cougars website" at <https://developers.facebook.com>. Production
only: without it, dev, previews and your machine show a sample feed, and production shows "No photos yet".

### Production

#### `INSTAGRAM_TOKEN__PRODUCTION`

The first read-only token. The Worker renews it weekly by itself and keeps the renewed one in D1, sealed with
[`INSTAGRAM_TOKEN_KEY__PRODUCTION`](#instagram_token_key__production) (the exception to Bitwarden-only, ADR 0002
point 8). **Not in Bitwarden yet.**

- **Comes from:** Meta: the app "Battersea Cougars website" (developer account) → **API setup with Instagram login**
  → Generate access tokens, for the club's Instagram account (permission `instagram_business_basic` only: read its own
  posts).
- **Used by:** the website Worker (`/photos/`, the home strip, `/api/photos/<id>`); its cron renews it.
- **Gets there by:** CI pull, then `deploy.yml` puts it on the Worker as a secret.
- **Expires:** after 60 days, but the Worker renews it weekly, so never in practice. If renewal fails, Sentry alerts
  with the days left.
- **Changing or revoking it:** the Meta app → **API setup with Instagram login** → remove the account, then make a
  new token as below.
- **Setting it up**, once:
  1. As the club account in the Instagram app: **Settings → Account type and tools → Switch to professional
     account** (Creator or Business; free, posts unchanged).
  2. As the developer account at developers.facebook.com: **My Apps → Create app** ("Battersea Cougars website", use
     case **Manage messaging & content on Instagram**), then **Instagram → API setup with Instagram login**.
  3. **App roles → Roles → Add people → Instagram Tester**: the club's Instagram account; accept it in Instagram
     (**Settings → Website permissions → Apps and websites → Tester invites**).
  4. Back in **API setup with Instagram login → Generate access tokens → Add account**, sign in as the club's
     Instagram, and copy the token.
  5. `npm run secret:set INSTAGRAM_TOKEN__PRODUCTION`, then run a production deploy.

---

## Web Push

Notifications in a browser ([ADR 0108](adr/0108-store-apps.md), #24): Android's Chrome or Firefox, a desktop, an
iPhone with the app on its Home Screen. The team Worker sends straight to each browser's push service
(`worker/push/webpush.ts`), signed with the club's VAPID key pair. No account anywhere: the key pair is all there is.
Without it, browser notifications are logged, not sent.

### Both environments (one value)

#### `VAPID_PRIVATE_KEY`

The pair's private key (P-256, its 32-byte `d`, base64url). Its public key is no secret: `VAPID_PUBLIC_KEY` in
`apps/team/wrangler.jsonc`'s vars, which the Worker reads and the app's build bakes in. One pair for dev and
production: a browser's subscription belongs to the address that made it, so the two never share one.

- **Comes from:** we make it: `node scripts/webpush-setup.mjs` puts the private key straight into Bitwarden and the
  public key into `wrangler.jsonc` (safe to run again: with both in place it only checks they're a pair); commit
  `wrangler.jsonc` after.
- **Used by:** the team Worker (`worker/push/push.ts`).
- **Gets there by:** CI pull, then `deploy.yml` puts it on the team Worker as a secret. On your machine, the team
  app's dev server has it when started with dev secrets (`npm run app`), so `localhost` can try it.
- **Expires:** no.
- **Changing it:** delete the secret, run the script, commit, deploy. Each browser takes the new key the next time it
  opens the app (until then its sends fail and are logged). **A leaked key could** send notifications to members'
  browsers, but only given their subscriptions too, which are only in the club's database.

---

## Our own keys

Random keys we make ourselves, with no outside account, so each **comes from** us. Each has one job: never reuse one
for another. Make one with 32 random bytes, never seen by anyone, for example
`openssl rand -base64 32 | npm run secret:set NAME`.

### Production

#### `BACKUP_KEY__PRODUCTION`

Seals production's database backups ([ADR 0106](adr/0106-database-backups.md)). A backup is the whole database,
members' names and emails included, kept as an artifact on this public repo, so it's encrypted
(`scripts/lib/backup.mjs`). One per environment, so a dev key can't open production's backups. Without it, backups
fail.

- **Comes from:** we make it:
  `node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))' | node scripts/secret-set.mjs BACKUP_KEY__PRODUCTION`.
- **Used by:** `scripts/db-backup.mjs` (`backup.yml` nightly, and `deploy.yml` before it changes the schema) and
  `scripts/db-restore.mjs`, which opens one ([db/README.md](../db/README.md#backups)).
- **Gets there by:** CI pull. On your machine,
  `node scripts/env-pull.mjs --environment production -- node scripts/db-restore.mjs …`.
- **Expires:** no.
- **Changing it:** only if it leaks. A new key can't open the old backups: keep the old one (as `BACKUP_KEY_OLD…`)
  until they've aged out, 90 days.

#### `GMAIL_TOKEN_KEY__PRODUCTION`

Seals the Gmail token an admin reconnects in production, in D1 (AES-GCM, `packages/shared/sealed-tokens.ts`; see
[Gmail](#gmail)). Without it, **Reconnect email** says it isn't set up, and only `GMAIL_REFRESH_TOKEN` sends.

- **Comes from:** we make it: `openssl rand -base64 32 | npm run secret:set GMAIL_TOKEN_KEY__PRODUCTION`.
- **Used by:** both production Workers (`packages/shared/gmail-token.ts`).
- **Gets there by:** CI pull, then `deploy.yml` puts it on both Workers.
- **Expires:** no.
- **Changing it:** set a new value and deploy. The sealed token then won't open: the Workers fall back to
  `GMAIL_REFRESH_TOKEN` (an error says so), and an admin reconnects to seal a fresh one.

#### `INSTAGRAM_TOKEN_KEY__PRODUCTION`

Seals the renewed Instagram token in D1 (AES-GCM; see [Instagram](#instagram)). Production only.

- **Comes from:** we make it: `openssl rand -base64 32 | npm run secret:set INSTAGRAM_TOKEN_KEY__PRODUCTION`.
- **Used by:** the website Worker (`apps/web/src/lib/server/instagram-token.ts`).
- **Gets there by:** CI pull, then `deploy.yml` puts it on the Worker.
- **Expires:** no.
- **Changing it:** set a new value and deploy. The sealed token then won't open: the Worker falls back to the
  Bitwarden token (an error says so) and seals a fresh one at the next weekly renewal. If the Bitwarden one has
  expired by then, make a new token.

### Dev

#### `BACKUP_KEY`

Dev's backup key (a plain name, but dev's), as production's above.

- **Comes from:** we make it, as production's, with `BACKUP_KEY` as the name.
- **Used by:** the same scripts, for dev's backups and your local D1's (`node scripts/env-pull.mjs -- node
scripts/db-restore.mjs …`).
- **Gets there by:** CI pull; on your machine, through `env-pull.mjs`.
- **Expires:** no.
- **Changing it:** as production's.

#### `GMAIL_TOKEN_KEY`

Dev's key for the reconnected Gmail token (a plain name, but dev's), as production's above.

- **Comes from:** we make it: `openssl rand -base64 32 | npm run secret:set GMAIL_TOKEN_KEY`.
- **Used by:** both dev Workers, and the team app's dev server on your machine.
- **Gets there by:** CI pull, then `deploy.yml` puts it on both Workers; on your machine, through `env-pull.mjs`.
- **Expires:** no.
- **Changing it:** as production's.

### Both environments (one value)

#### `SMOKE_TOKEN`

Lets the deploy's smoke test send a real "Try a session" enquiry (`scripts/ci/smoke-test.mjs`,
`apps/web/src/lib/server/smoke.ts`, [ADR 0027](adr/0027-email-through-gmail-api.md)). With it in the
`X-Cougars-Smoke` header, the enquiry is saved, both emails go out **to the sending account only** (in production
too), and the row is deleted. The deploy fails unless both emails were sent.

- **Comes from:** we make it, at random, on every website deploy (`deploy.yml`, "Smoke key"), which puts it on the
  Worker and hands it to the smoke test. **Not stored anywhere**, not in Bitwarden either.
- **Spent** straight after the test, pass or fail: the Worker gets a new random value nobody ever sees, so a key
  works for its own deploy's test only. A smoke header with any other key is refused (403), never taken as an
  ordinary enquiry.
- **PR previews** share dev's Worker, so they skip the form test.

---

## Club data

The club's own data, not a credential, but personal, so it never goes in this public repo
([ADR 0029](adr/0029-personal-data.md)).

### Production

#### `TEAM_ROSTER__PRODUCTION`

The club's starting players as one line of JSON: name, position (F/D/G), rating, and optionally an email and roles.
Only production's two admins: everyone else is imported in the app (Members → Manage → Import members,
[ADR 0050](adr/0050-schema-and-seed-until-launch.md)). Format and local use:
[db/seed/README.md](../db/seed/README.md). Dev has no roster in Bitwarden: its database already holds its people, so
its deploys skip the seed.

- **Comes from:** the club: the admins write it. Not issued by anyone.
- **Used by:** `scripts/seed-roster.mjs`, which adds players who aren't in D1 yet and changes no one; and
  `scripts/access-setup.mjs`, which starts the Access gate's list from it, once (after that the list is managed in
  the dashboard). Your machine seeds them anonymized from `db/seed/roster.local.json` (made-up names bar the admins,
  ADR 0029), or, without one, the made-up club in `db/seed/roster.example.json`.
- **Gets there by:** CI pull, then the "Seed the team roster" step in `deploy.yml`, after the migrations, on every
  deploy. Your machine seeds from the local copy (`npm run db:seed:local`).
- **Expires:** no. Once the app is live, members join and are edited in the app; the roster only covers the starting
  players.
- **Changing it:** from a local file of that shape,
  `node -e "console.log(JSON.stringify(require('./admins.local.json')))" | node scripts/secret-set.mjs TEAM_ROSTER__PRODUCTION`,
  then delete the file.

---

## Plain settings

Values that aren't secret, committed in config, one copy each.

**In [`scripts/lib/settings.mjs`](../scripts/lib/settings.mjs)**, which `env-pull.mjs` hands to every command and CI
job beside the secrets (a CI job refuses to start while one isn't filled in), under the names the code reads:

| Name                          | Per environment | What                                                                                    |
| ----------------------------- | --------------- | --------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`       | yes             | [The Cougars and Cougars Dev accounts' IDs](#cloudflare_account_id-productions)         |
| `APPLE_TEAM_ID`               | no              | [The Apple Developer team](#apple_team_id)                                              |
| `APP_STORE_CONNECT_KEY_ID`    | no              | [The App Store Connect key's ID](#app_store_connect_key_id-app_store_connect_issuer_id) |
| `APP_STORE_CONNECT_ISSUER_ID` | no              | [Its issuer](#app_store_connect_key_id-app_store_connect_issuer_id)                     |
| `SENTRY_DSN_TEAM`             | no              | [Where the team app's errors go](#sentry_dsn_team)                                      |

**Elsewhere:**

| Name                                   | Where                       | What                                                                                                            |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                             | `deploy.yml`                | `https://batterseacougars.com` on production; dev's workers.dev                                                 |
| `TURNSTILE_SITE_KEY`                   | `deploy.yml`                | Each account's Turnstile site key; your machine uses Cloudflare's test key                                      |
| `BWS_SERVER_URL`                       | GitHub variable, your shell | `https://vault.bitwarden.eu` if the vault is on the EU server (the scripts' default)                            |
| `SANITY_PROJECT_ID` / `SANITY_DATASET` | `packages/shared/sanity.ts` | Picked from `SITE_ENV`: Cougars on production, Cougars Dev else                                                 |
| `SANITY_STUDIO_SITE_ENV`               | CI (Studio deploy)          | `production` builds the live Studio; unset is the dev project                                                   |
| `DEMO_CONTENT`                         | `.env`, CI                  | Sample content + `noindex`; `true` on dev and PR builds, never on production                                    |
| `PUBLIC_BUILD_VERSION`                 | Set by CI                   | Shown in `<meta name="generator">`; checked by the smoke test; its commit is the team app's build id (ADR 0104) |
| `GITHUB_APP_CLIENT_ID`                 | team `wrangler.jsonc`       | `Iv23liuUhxYcTesso0TW`, the Cougars rebuilds App                                                                |
| `GITHUB_APP_INSTALLATION_ID`           | team `wrangler.jsonc`       | `169599165`, its installation on `battersea-cougars/ark`                                                        |
| `VAPID_PUBLIC_KEY`                     | team `wrangler.jsonc`       | Web Push's public key ([Web Push](#web-push))                                                                   |

`.env` is optional and holds your own non-secret overrides only ([.env.example](../.env.example)). Never a secret.

---

## Setting up from scratch

The accounts first ([setup.md](setup.md)), then the secrets, in this order. Each step stores its values straight in
Bitwarden; `npm run secrets` (and `-- --environment production`) lists the names to check.

1. **Bitwarden:** the organisation, the two projects, the three machine accounts and their
   [tokens](#bitwarden). Put the two CI tokens in GitHub, the local one in your vault, then `bw-unlock`.
2. **Cloudflare**, in each account: the API token ([production](#cloudflare_api_token__production),
   [dev](#cloudflare_api_token__dev)), the account ID into
   [`settings.mjs`](#plain-settings), then the analytics token. Then `turnstile-setup.mjs`
   ([Turnstile](#turnstile)), and, for production before launch, `access-setup.mjs`
   ([Cloudflare Access](#cf_access_client_id__production-cf_access_client_secret__production)).
3. **Our own keys:** [`BACKUP_KEY`](#our-own-keys), `GMAIL_TOKEN_KEY` and `INSTAGRAM_TOKEN_KEY`, for each
   environment.
4. **The roster:** [`TEAM_ROSTER__PRODUCTION`](#team_roster__production).
5. **Google:** [Gmail](#gmail) steps 1 to 8, then the [YouTube](#youtube) keys, then `firebase-setup.mjs`
   ([Firebase](#firebase)).
6. **Sanity:** [`SANITY_DEPLOY_TOKEN__PRODUCTION`](#sanity_deploy_token__production).
7. **GitHub:** the Cougars rebuilds App and its [key](#github_app_private_key).
8. **Sentry:** [`SENTRY_AUTH_TOKEN`](#sentry_auth_token), then `sentry-setup.mjs`, which stores the website's DSN and
   says the team app's, for [`settings.mjs`](#plain-settings); then the read-only
   [`SENTRY_ISSUES_TOKEN`](#sentry_issues_token).
9. **Web Push:** `webpush-setup.mjs` ([Web Push](#web-push)).
10. **Instagram**, production only: [`INSTAGRAM_TOKEN__PRODUCTION`](#instagram_token__production).
11. **Apple**, when the store app is built: the [App Store Connect key](#app_store_connect_key) (its IDs into
    `settings.mjs`), `store-setup.mjs`
    ([`APPLE_TEAM_ID`](#apple_team_id)), the [push key](#apple-push-key-recovery-copy), and the
    [App Review sign-in](#app_review_email__production-app_review_code__production).

Adding a new secret: create the token at its provider with the secret's exact name, store it with
`npm run secret:set NAME` (a hidden prompt; it picks the project from the name), and add its entry here, under its
system and environment, and in the Overview, in the same change.

---

## Overview

Every name. **Env** is which environment's value it is: _prod_ (`NAME__PRODUCTION`, project `cougars`), _dev_
(`NAME__DEV`, or a plain `NAME` with a production value beside it, project `cougars-dev`), or _both_ (one plain
`NAME` for both, project `cougars-dev`). A value marked `settings.mjs` isn't in Bitwarden at all: it's committed in
[`scripts/lib/settings.mjs`](../scripts/lib/settings.mjs).

| Name                                                                                                          | System     | Env  | Secret?                          | Used by                                   |
| ------------------------------------------------------------------------------------------------------------- | ---------- | ---- | -------------------------------- | ----------------------------------------- |
| [`BWS_ACCESS_TOKEN__PRODUCTION`](#bws_access_token__production)                                               | Bitwarden  | prod | yes (in GitHub)                  | Production CI jobs                        |
| [`BWS_ACCESS_TOKEN__DEV`](#bws_access_token__dev)                                                             | Bitwarden  | dev  | yes (in GitHub)                  | `main` and PR CI jobs                     |
| [`COUGARS_LOCAL_BW_TOKEN`](#cougars_local_bw_token)                                                           | Bitwarden  | both | yes (your vault)                 | Your machine                              |
| [`CLOUDFLARE_API_TOKEN__PRODUCTION`](#cloudflare_api_token__production)                                       | Cloudflare | prod | yes                              | Production deploys, scripts               |
| [`CLOUDFLARE_API_TOKEN__DEV`](#cloudflare_api_token__dev)                                                     | Cloudflare | dev  | yes                              | Dev deploys, PR previews, scripts         |
| [`CLOUDFLARE_ACCOUNT_ID`](#cloudflare_account_id-productions) (production's)                                  | Cloudflare | prod | no (`settings.mjs`)              | Production deploys, Usage page            |
| [`CLOUDFLARE_ACCOUNT_ID`](#cloudflare_account_id-devs) (dev's)                                                | Cloudflare | dev  | no (`settings.mjs`)              | Dev deploys, Usage page                   |
| [`CLOUDFLARE_ANALYTICS_TOKEN__PRODUCTION`](#cloudflare_analytics_token__production)                           | Cloudflare | prod | yes                              | Team app: Usage page                      |
| [`CLOUDFLARE_ANALYTICS_TOKEN__DEV`](#cloudflare_analytics_token__dev)                                         | Cloudflare | dev  | yes                              | Team app: Usage page, `cpu-by-route.mjs`  |
| [`TURNSTILE_SECRET_KEY__PRODUCTION`](#turnstile_secret_key__production)                                       | Cloudflare | prod | yes                              | Website, team app: forms, sign-in         |
| [`TURNSTILE_SECRET_KEY`](#turnstile_secret_key)                                                               | Cloudflare | dev  | yes                              | Website, team app: forms, sign-in         |
| [`CF_ACCESS_CLIENT_ID__PRODUCTION`](#cf_access_client_id__production-cf_access_client_secret__production)     | Cloudflare | prod | no                               | Production smoke tests, until launch      |
| [`CF_ACCESS_CLIENT_SECRET__PRODUCTION`](#cf_access_client_id__production-cf_access_client_secret__production) | Cloudflare | prod | yes                              | Production smoke tests, until launch      |
| [`YOUTUBE_API_KEY__PRODUCTION`](#youtube_api_key__production)                                                 | Google     | prod | yes                              | Website: videos                           |
| [`YOUTUBE_API_KEY__DEV`](#youtube_api_key__dev)                                                               | Google     | dev  | yes                              | Website: videos                           |
| [`GMAIL_REFRESH_TOKEN`](#gmail_refresh_token)                                                                 | Google     | both | yes                              | Website, team app: email                  |
| [`GMAIL_WEB_CLIENT_ID`](#gmail_web_client_id-gmail_web_client_secret)                                         | Google     | both | no                               | Website, team app: reconnected email      |
| [`GMAIL_WEB_CLIENT_SECRET`](#gmail_web_client_id-gmail_web_client_secret)                                     | Google     | both | yes                              | Website, team app: reconnected email      |
| [`FIREBASE_SERVICE_ACCOUNT`](#firebase_service_account)                                                       | Google     | both | yes                              | Team app: store app notifications         |
| [`FIREBASE_IOS_CONFIG`](#firebase_ios_config)                                                                 | Google     | both | no                               | `store.yml`                               |
| [`APP_REVIEW_EMAIL__PRODUCTION`](#app_review_email__production-app_review_code__production) (not set yet)     | Apple      | prod | no (personal)                    | Team app: App Review sign-in              |
| [`APP_REVIEW_CODE__PRODUCTION`](#app_review_email__production-app_review_code__production) (not set yet)      | Apple      | prod | yes                              | Team app: App Review sign-in              |
| [`APP_STORE_CONNECT_KEY`](#app_store_connect_key)                                                             | Apple      | both | yes                              | `store.yml`, `store-setup.mjs`            |
| [`APP_STORE_CONNECT_KEY_ID`](#app_store_connect_key_id-app_store_connect_issuer_id)                           | Apple      | both | no (`settings.mjs`)              | `store.yml`, `store-setup.mjs`            |
| [`APP_STORE_CONNECT_ISSUER_ID`](#app_store_connect_key_id-app_store_connect_issuer_id)                        | Apple      | both | no (`settings.mjs`)              | `store.yml`, `store-setup.mjs`            |
| [`APPLE_TEAM_ID`](#apple_team_id)                                                                             | Apple      | both | no (`settings.mjs`)              | `store.yml`, team app: app links          |
| [Apple push key](#apple-push-key-recovery-copy) (the `.p8` and its Key ID)                                    | Apple      | both | yes (vault, not Secrets Manager) | Nothing: recovery copy of Firebase's      |
| [`SENTRY_AUTH_TOKEN`](#sentry_auth_token)                                                                     | Sentry     | both | yes                              | Deploys (source maps), `sentry-setup.mjs` |
| [`SENTRY_ISSUES_TOKEN`](#sentry_issues_token) (not set yet)                                                   | Sentry     | both | yes                              | Team app: Settings → Errors               |
| [`SENTRY_DSN_WEB`](#sentry_dsn_web)                                                                           | Sentry     | both | no                               | Website Worker                            |
| [`SENTRY_DSN_TEAM`](#sentry_dsn_team)                                                                         | Sentry     | both | no (`settings.mjs`)              | Team Worker and app                       |
| [`SANITY_DEPLOY_TOKEN__PRODUCTION`](#sanity_deploy_token__production)                                         | Sanity     | prod | yes                              | Studio schema deploy                      |
| [`GITHUB_APP_PRIVATE_KEY`](#github_app_private_key)                                                           | GitHub     | both | yes                              | Team app: website rebuilds                |
| [`INSTAGRAM_TOKEN__PRODUCTION`](#instagram_token__production) (not set yet)                                   | Instagram  | prod | yes                              | Website: photos                           |
| [`VAPID_PRIVATE_KEY`](#vapid_private_key)                                                                     | Web Push   | both | yes                              | Team app: browser notifications           |
| [`BACKUP_KEY__PRODUCTION`](#backup_key__production)                                                           | Us         | prod | yes                              | Database backups                          |
| [`BACKUP_KEY`](#backup_key)                                                                                   | Us         | dev  | yes                              | Database backups                          |
| [`GMAIL_TOKEN_KEY__PRODUCTION`](#gmail_token_key__production)                                                 | Us         | prod | yes                              | Website, team app: reconnected email      |
| [`GMAIL_TOKEN_KEY`](#gmail_token_key)                                                                         | Us         | dev  | yes                              | Website, team app: reconnected email      |
| [`INSTAGRAM_TOKEN_KEY__PRODUCTION`](#instagram_token_key__production)                                         | Us         | prod | yes                              | Website: photos                           |
| [`SMOKE_TOKEN`](#smoke_token) (never stored)                                                                  | Us         | both | yes                              | Deploy smoke test of the form             |
| [`TEAM_ROSTER__PRODUCTION`](#team_roster__production)                                                         | Club data  | prod | personal data                    | Deploys (D1 seed), `access-setup.mjs`     |
