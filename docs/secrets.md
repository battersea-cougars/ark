# Secrets: reference

Every secret the website, the team app, the scripts and CI use: why it exists, whose account it comes from, its
name in Bitwarden, who reads it, how it gets there, whether it expires, and how to change it. Checked against
Bitwarden and the code on 2026-10-22.

- How secrets work, in short: [README.md#secrets](../README.md#secrets).
- The rules, and why: [ADR 0002](adr/0002-secrets-in-bitwarden.md). The two environments:
  [ADR 0010](adr/0010-environments-and-deploys.md).
- Every outside service and who owns it: [accounts.md](accounts.md). Account setup, step by step: [setup.md](setup.md).

## How to read an entry

Each entry opens with **why** it exists: what stops working without it. Then:

- **Owner:** the account it was issued under. That is where you revoke or replace it. "Us" means a value we make
  ourselves, with no outside account.
- **Bitwarden:** its name in Secrets Manager, and which project holds it. `cougars` holds production values
  (`NAME__PRODUCTION`); `cougars-dev` holds dev values (`NAME__DEV`) and shared ones (plain `NAME`, one value for
  both). See [Bitwarden](#bitwarden).
- **Used by:** what reads it.
- **Gets there by:** how the value reaches what reads it.
- **Expires:** whether it stops working by itself.
- **Changing it:** what to do to replace it, and what breaks until you have.

The code always reads the plain `NAME`: `CLOUDFLARE_API_TOKEN`, never `CLOUDFLARE_API_TOKEN__PRODUCTION`.

## Contents

- [Bitwarden](#bitwarden): the store itself, and the three tokens that open it
- [Cloudflare](#cloudflare): hosting, the database, Turnstile, Access
- [Google](#google): Gmail, YouTube, Firebase
- [Apple](#apple): the App Store app
- [Sanity](#sanity): the website's content
- [GitHub](#github): the website rebuild App
- [Sentry](#sentry): error reports
- [Instagram](#instagram): the website's photos
- [Web Push](#web-push): browser notifications
- [Our own keys](#our-own-keys): keys we make, with no outside account
- [Club data](#club-data): the starting roster
- [Plain settings](#plain-settings): values that aren't secret
- [Setting up from scratch](#setting-up-from-scratch): the order to make everything in
- [Overview](#overview): everything in one table

---

## Bitwarden

Bitwarden Secrets Manager is where every secret lives, and nowhere else. It has two projects:

| Project       | Holds                                                                    | Read by                                         |
| ------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| `cougars`     | Production values, named `NAME__PRODUCTION`                              | `cougars-ci`, `cougars-local`                   |
| `cougars-dev` | Dev values (`NAME__DEV`) and shared values (plain `NAME`, both use them) | `cougars-ci`, `cougars-ci-dev`, `cougars-local` |

A production-only secret is always `NAME__PRODUCTION`, so the dev token can't see it. A plain `NAME` with a
`NAME__PRODUCTION` beside it is, in effect, dev's value (for example `BACKUP_KEY`).

The free plan allows 3 projects, 3 machine accounts and 2 people. People (organisation members) get access to the
projects they look after. The organisation is on Bitwarden's EU server.

### Bitwarden tokens

Without them nothing can read the other secrets. Bitwarden has two halves: your **vault** (Password Manager, the
`bw` command), opened with your master password; and **Secrets Manager** (`bws`), which only takes a
**machine account's access token**. These are those tokens, one per machine account, each named like the secret
that holds it:

| Token                          | Machine account  | `cougars`       | `cougars-dev`   | Stored in                                           |
| ------------------------------ | ---------------- | --------------- | --------------- | --------------------------------------------------- |
| `BWS_ACCESS_TOKEN__PRODUCTION` | `cougars-ci`     | Can read        | Can read        | GitHub environment `production` (deploys `release`) |
| `BWS_ACCESS_TOKEN__DEV`        | `cougars-ci-dev` | No access       | Can read        | GitHub environment `preview` (`main` and PRs)       |
| `COUGARS_LOCAL_BW_TOKEN`       | `cougars-local`  | Can read, write | Can read, write | your vault: secure note `cougars/.env.local`        |

- **Owner:** the club's Bitwarden organisation. Project access is set in Secrets Manager → **Machine accounts →
  _account_ → Projects**. CI only reads: it never changes a secret. `cougars-local` can write, so you add secrets
  from the shell (`npm run secret:set NAME`).
- **Used by:** every CI job (`deploy.yml`, `backup.yml`, `store.yml`) and every script on your machine that needs a
  secret.
- **Gets there by:** in CI, the job passes its environment's token to `bws` as `BWS_ACCESS_TOKEN` and runs
  `scripts/env-pull.mjs --github-env --environment production|dev`, which exports every other secret into the job,
  masked (`.github/actions/secrets`). On your machine, **`bw-unlock` is the login** (once per container start): the
  scripts read the token from the vault note `cougars/.env.local` (a line `COUGARS_LOCAL_BW_TOKEN=...`), and ask
  for your master password if the vault is locked. Then `node scripts/env-pull.mjs -- <command>` runs a command
  with the dev secrets in memory; add `--environment production` for production's.
- **Expires:** as set when each was made. Check each machine account's token list.
- **Changing it:** make a new token on the machine account, `gh secret set <name> --env <environment>` (or update
  your vault note), run a deploy, then revoke the old token.

---

## Cloudflare

Both apps run on Cloudflare (Workers, the D1 database, the domain). There are two accounts, so dev can never touch
production: **Cougars** (production) and **Cougars Dev**. The club account and a maintainer are Super
Administrators on both. Tokens are **account API tokens** (Manage Account → **Account API Tokens**): they belong to
the account, not a person.

### `CLOUDFLARE_API_TOKEN`

Deploying anything needs it: the Workers, the database, the domain's settings. One per account, because a token's
deploy rights cover its whole account.

- **Owner:** each Cloudflare account. Token names `CLOUDFLARE_API_TOKEN__PRODUCTION` (Cougars) and
  `CLOUDFLARE_API_TOKEN__DEV` (Cougars Dev).
- **Bitwarden:** `CLOUDFLARE_API_TOKEN__PRODUCTION` in `cougars`; `CLOUDFLARE_API_TOKEN__DEV` in `cougars-dev`.
- **Permissions, production** (account tokens use role-style permissions, grouped by what they apply to):

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

- **Permissions, dev:** scope **Entire Cougars Dev account**; **Workers Admin** (Editor can't create a new worker),
  **D1 Write**, **Turnstile Write** (`scripts/turnstile-setup.mjs`).
- **Used by:** production: `deploy.yml` on `release` and Studio publishes (`target.mjs`, migrations,
  `wrangler deploy`). Dev: `deploy.yml` on `main` and pull requests (preview versions), `scripts/deploy-dev.sh`.
  Both: `scripts/admin-break-glass.mjs`, `scripts/club-snapshot.mjs` (through `scripts/lib/d1-api.mjs`), the
  `scripts/*-setup.mjs` scripts.
- **Gets there by:** CI pull from Bitwarden. On your machine, `node scripts/env-pull.mjs -- bash
scripts/deploy-dev.sh` (dev), or `--environment production` for a production script.
- **Expires:** no, unless you set a TTL.
- **Changing it:** roll it in the dashboard, `npm run secret:set` the new value, run one deploy.

### `CLOUDFLARE_ACCOUNT_ID`

Cloudflare's API addresses everything by account, so every call needs the account's ID beside the token. **Not
secret**: it's on the account's home page. See [Plain settings](#plain-settings).

- **Owner:** each account. An ID, not issued to anyone.
- **Bitwarden:** `CLOUDFLARE_ACCOUNT_ID__PRODUCTION` in `cougars`; `CLOUDFLARE_ACCOUNT_ID__DEV` in `cougars-dev`.
- **Used by:** everything that uses the API token above, and the team app's Usage page (with the analytics token).
- **Expires:** never.

### `CLOUDFLARE_ANALYTICS_TOKEN`

The team app's Usage page, and its hourly check, read today's Worker requests and database rows from Cloudflare, to
warn the admins before the free allowance runs out ([ADR 0059](adr/0059-usage-page-and-check.md)). Read-only. It
lives inside the Worker, so it's never the deploy token. Without it the page says "Not set up yet".

- **Owner:** each account. Token names `CLOUDFLARE_ANALYTICS_TOKEN__PRODUCTION` / `CLOUDFLARE_ANALYTICS_TOKEN__DEV`.
- **Bitwarden:** `CLOUDFLARE_ANALYTICS_TOKEN__PRODUCTION` in `cougars`; `CLOUDFLARE_ANALYTICS_TOKEN__DEV` in
  `cougars-dev`.
- **Permissions:**

  | Applies to                   | Permission                       | Why                                                   |
  | ---------------------------- | -------------------------------- | ----------------------------------------------------- |
  | Entire Cougars (Dev) account | Account Analytics Read           | Today's Worker requests and D1 rows                   |
  | Entire Cougars Dev account   | Workers Observability Read (dev) | CPU time per route, `scripts/cpu-by-route.mjs` (0059) |

  Cloudflare lists Workers Observability under its legacy permissions; it still works. Production doesn't need it.

- **Used by:** the team Worker (`apps/team/worker/settings/usage.ts`), with `CLOUDFLARE_ACCOUNT_ID`; on dev, also
  `scripts/cpu-by-route.mjs`.
- **Gets there by:** a Worker secret, put on by `deploy.yml` when the team app deploys. On your machine,
  `node scripts/env-pull.mjs -- npm run dev -w @cougars/team` passes it to the dev server (`vite.config.ts`), in
  memory, never to a file.
- **Expires:** no, unless you set a TTL.
- **Changing it:** roll it in the dashboard, update Bitwarden, deploy the team app.

### Turnstile

Cloudflare Turnstile tells people from bots on the "Try a session" form, and only people get the automatic reply
([ADR 0028](adr/0028-turnstile-and-auto-reply.md)). Free. The team app's sign-in and Ask to join use the same widget
and secret (#13), and refuse a failed check.

Without the secret, nobody counts as verified on the website: enquiries are still saved and emailed to the club, but
nobody gets an auto-reply. The team app on your machine then checks nothing; a deployed production team app refuses
sign-in until it has one.

- **Owner:** each Cloudflare account: one widget per account, named `cougars`. Its hostnames cover the website and
  the team app (`team.cougars-dev.workers.dev`, `team.batterseacougars.com`), so there's no second widget.
- **Bitwarden:** `TURNSTILE_SECRET_KEY__PRODUCTION` in `cougars`; `TURNSTILE_SECRET_KEY` (dev's) in `cougars-dev`.
- **Used by:** the website's `/api/join`, and the team app's `/api/auth/start` and `/api/auth/request`
  (`worker/auth/auth.turnstile.ts`), to check each form's answer with Cloudflare.
- **Gets there by:** CI pull, then `deploy.yml` puts it on both Workers as a secret on every deploy. Your machine
  uses Cloudflare's test site key (always passes) and no secret, so no auto-replies locally; the team app on your
  machine has no site key and no secret, so it shows no widget and checks nothing.
- **Expires:** no.
- **Changing it:** the widget → **Rotate secret key**, update Bitwarden, deploy.
- **Setting it up:** `node scripts/env-pull.mjs [--environment production] -- node scripts/turnstile-setup.mjs
dev|production`. It stores the secret key straight in Bitwarden (nobody sees it) and prints the **site key**,
  which is public and goes in `deploy.yml` as `TURNSTILE_SITE_KEY` (the website's job and the team app's). The
  account's `CLOUDFLARE_API_TOKEN` needs **Turnstile Write**. By hand instead: sidebar **Turnstile** (under
  _Application security_ in the new dashboard) → **Add widget**: name `cougars-website`, hostname the site's
  (Cougars Dev: `cougars-dev.workers.dev`, which covers `web.` and its PR previews; Cougars:
  `batterseacougars.com`), widget mode **Managed**, pre-clearance **No** → **Create**. Put the site key in
  `deploy.yml`, then `npm run secret:set TURNSTILE_SECRET_KEY` (dev) or `TURNSTILE_SECRET_KEY__PRODUCTION`.

### Cloudflare Access

Until launch, production is behind Cloudflare Access ([setup.md](setup.md)). The deploy's smoke tests send this
service token as two headers to get past it. Without it, production's smoke tests fail. Goes away at launch.

- **Owner:** the Cougars account, Zero Trust → Access → Service Auth.
- **Bitwarden:** `CF_ACCESS_CLIENT_ID__PRODUCTION` (not really secret on its own) and
  `CF_ACCESS_CLIENT_SECRET__PRODUCTION`, both in `cougars`.
- **Used by:** `scripts/ci/smoke-test.mjs` and the team job's smoke test in `deploy.yml`.
- **Gets there by:** CI pull.
- **Expires:** a year after it's made.
- **Changing it:** `node scripts/env-pull.mjs --environment production -- node scripts/access-setup.mjs` creates
  the token and stores both values straight in Bitwarden (nobody sees the secret). Run again with the secret
  missing, it rotates the token and stores the new one.
- **At launch:** `access-setup.mjs --remove` deletes the token; then delete both secrets.

---

## Google

One Google Cloud project for the whole club: _Battersea Cougars_, ID `battersea-cougars` (permanent, so no
"website" or "dev" in it). It's owned by **the developer account** (the Gmail account kept for the club's technical
work), with the club's Gmail account as a second Owner (**IAM → Grant access**), so the club can always reach it.
Free, no billing account. The Gmail clients, the YouTube keys and Firebase all live in it.

### Gmail

The website emails the club inbox about each enquiry and auto-replies to the enquirer; the team app sends sign-in
codes and notices. Both send through the Gmail API (HTTPS, not SMTP; no password is stored anywhere), as the
developer account. Without these, emails are logged, not sent ([ADR 0027](adr/0027-email-through-gmail-api.md)).
Outside production every email goes to one safe inbox, and dev can only ever send from its own test account, never
the club's.

There are two Google "clients" (apps that may ask for a token) and two places a token can be:

- The **Desktop client** (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`) made the first token, `GMAIL_REFRESH_TOKEN`,
  with `scripts/gmail-auth.mjs`. That token is in Bitwarden.
- The **Web client** (`GMAIL_WEB_CLIENT_ID`, `GMAIL_WEB_CLIENT_SECRET`) makes a token when an admin presses
  **Reconnect email** in the team app. That token is kept in D1, sealed with
  [`GMAIL_TOKEN_KEY`](#gmail_token_key) (ADR 0002 point 8, `packages/shared/gmail-token.ts`).

A token only works with the client that made it, so each keeps its own. The reconnected one wins once it exists.

**When Google cancels the token** (see _Expires_), an admin fixes it in the team app: **Settings → Email → Reconnect
email**. Google's consent page opens; they sign in as the developer account and tick _Send email on your behalf_.
It works at once in both Workers, with no deploy; each environment keeps its own. The admins hear about it on Home
and on their phones. Settings → Email also shows the sending account, the From address and the last send or
failure.

- **Owner:** the developer account: the Google Cloud project (clients) and its Gmail (tokens). Revoke a token in
  [the account's third-party access](https://myaccount.google.com/connections); a client in **Google Auth Platform
  → Clients**.
- **Bitwarden:** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_WEB_CLIENT_ID`,
  `GMAIL_WEB_CLIENT_SECRET`, all shared, in `cougars-dev`. One token for both environments: production sends from
  this account too, so resetting the club account's password breaks nothing (ADR 0027).
- **Used by:** the website's enquiry form (Worker) and the team app's sign-in codes and notices. The token can send
  mail as its account and nothing else: it can't read the mailbox.
- **Gets there by:** CI pull (both environments read the same clients and token), then `deploy.yml` puts them on
  both Workers as secrets on every deploy. On your machine, `node scripts/env-pull.mjs -- npm run dev` (the dev
  account). The team app's dev server gets only the Web client and `GMAIL_TOKEN_KEY`, never
  `GMAIL_REFRESH_TOKEN`, so only a token reconnected on your machine sends from it.
- **Expires:** no, but Google cancels a token when the account's password changes, when access is removed in
  [third-party access](https://myaccount.google.com/connections), or after 6 months unused.
- **Changing it:** the token: an admin presses **Settings → Email → Reconnect email** in each environment; no
  deploy. From a terminal instead: re-run `gmail-auth.mjs`, then deploy both environments (it's only used while no
  reconnected token is in D1). A client secret: **Clients → the client → Add secret**, update Bitwarden, deploy,
  delete the old secret (a client holds two at once, so there's no gap).

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
6. **Clients → Create client → Desktop app**, named `cougars-website`. Save both values:
   `npm run secret:set GMAIL_CLIENT_ID`, then `GMAIL_CLIENT_SECRET`. It's only for `gmail-auth.mjs`, the first
   token.
7. **Clients → Create client → Web application**, named `GMAIL_WEB_CLIENT_ID`, for reconnecting from the team app.
   **Authorised redirect URIs:** `https://team.batterseacougars.com/api/mail/callback` and
   `https://team.cougars-dev.workers.dev/api/mail/callback` (no JavaScript origins needed). Create, then
   `npm run secret:set GMAIL_WEB_CLIENT_ID`, then `GMAIL_WEB_CLIENT_SECRET`.
8. **The first token:** `node scripts/gmail-auth.mjs`, signed in as the developer account. It opens Google's consent
   page, catches the answer on `http://localhost:4590` and saves `GMAIL_REFRESH_TOKEN` straight to Bitwarden;
   nothing is printed. It refuses the club's account. This is also the way back in from a terminal if no admin can
   sign in.
9. **The club's address as the sender:** in the developer account's Gmail, **Settings → Accounts and Import → Send
   mail as → Add another email address**: name _Battersea Cougars_, address the club's Gmail address, **Treat as an
   alias** ticked. Gmail emails the club account a confirmation link; open it there. Production then sends as the
   club's address, and replies land in the club inbox. Without it, production sends as the developer account. The
   club's address is the Studio's **Club → Contact email**: change both together.

### YouTube

The website lists the club's YouTube videos live (`apps/web/src/lib/server/videos.ts`,
[ADR 0016](adr/0016-photos-and-videos-read-live.md)). Without a key the site still works, and shows only the videos
in Sanity. One key per environment, so a leaked dev key can be revoked without touching production.

- **Owner:** the Google Cloud project `battersea-cougars` → **APIs & Services → Credentials**.
- **Bitwarden:** `YOUTUBE_API_KEY__PRODUCTION` in `cougars`; `YOUTUBE_API_KEY__DEV` in `cougars-dev`.
- **Used by:** the website Worker's `/videos` page and the home video reel, and the build. It reads public data only
  and never reaches the browser.
- **Gets there by:** CI pull, then `deploy.yml` puts it on the Worker as a secret on every deploy. On your machine,
  `node scripts/env-pull.mjs -- npm run dev` (dev key).
- **Expires:** no.
- **Changing it:** Credentials → the key → **Regenerate key**, update Bitwarden, deploy.
- **Setting it up:** **APIs & Services → Library → YouTube Data API v3 → Enable**, then **Credentials → Create
  credentials → API key**. Name it like the secret, and under **API restrictions** pick **Restrict key → YouTube
  Data API v3** only. No application restriction: CI has no fixed IP address. Both keys share the project's free
  quota of 10,000 units a day; with the 10-minute cache the site uses a few hundred at most.

### Firebase

The team Worker sends notifications to the store app through Firebase Cloud Messaging
([ADR 0108](adr/0108-store-apps.md)). Firebase is switched on in the same Google Cloud project. Without these, the
store app gets no notifications and can't be built.

**`FIREBASE_SERVICE_ACCOUNT`**: the JSON key of a Google service account, `firebase-service-account` (Google allows
no capitals), role **Firebase Cloud Messaging API Admin** only. The Worker signs an hour's token with it to send a
notification. **A leaked key could** send our members notifications, nothing else.

- **Owner:** the Google Cloud project `battersea-cougars` → IAM → Service accounts.
- **Bitwarden:** `FIREBASE_SERVICE_ACCOUNT`, shared, in `cougars-dev`.
- **Used by:** the team Worker (`worker/push/fcm.ts`, `worker/push/push.ts`).
- **Gets there by:** CI pull, then `deploy.yml` puts it on the team Worker as a secret.
- **Expires:** no.
- **Changing it:** add a new key to the service account, store it, deploy `team`, delete the old key.

**`FIREBASE_IOS_CONFIG`**: the iOS app's `GoogleService-Info.plist`. Not much of a secret (its API key is limited to
this app), but it stays out of the public repo.

- **Owner:** the Firebase project (Project settings → Your apps).
- **Bitwarden:** `FIREBASE_IOS_CONFIG`, shared, in `cougars-dev`.
- **Used by:** `store.yml`, which writes it into the Xcode project for the build.
- **Gets there by:** CI pull.
- **Expires:** no.
- **Changing it:** download it again and store it (`node scripts/secret-set.mjs FIREBASE_IOS_CONFIG < file`).

**Setting up Firebase:** `node scripts/firebase-setup.mjs`, signed in with `gcloud auth login` as an Owner of
`battersea-cougars`. It turns Firebase on, makes the iOS app and the service account, and stores both secrets
straight in Bitwarden. The one step it can't do is upload the Apple push key ([APNs](#apple-push-key)) in the
Firebase console; it prints the link.

---

## Apple

The team app in the App Store ([ADR 0108](adr/0108-store-apps.md)): built and sent to TestFlight by `store.yml`.
Owned, for now, by a maintainer's Apple Developer membership; making it the club's is #103.

One copy each, shared (production reads `cougars-dev` too), except the App Review pair, which is production's alone.

### App Store Connect key

So CI can sign and upload the app with no certificates to keep. Without it, `store.yml` can't build.

- **Owner:** App Store Connect → Users and Access → Integrations → Team Keys, key named `APP_STORE_CONNECT_KEY`,
  access **App Manager**.
- **Bitwarden:** `APP_STORE_CONNECT_KEY` (the `.p8` file), `APP_STORE_CONNECT_KEY_ID` and
  `APP_STORE_CONNECT_ISSUER_ID` (both [not secret](#plain-settings)), shared, in `cougars-dev`.
- **Used by:** `store.yml` and `scripts/store-setup.mjs`.
- **Gets there by:** CI pull.
- **Expires:** no.
- **Changing it:** make a new key, store it, revoke the old one. **A leaked key could** upload builds and change the
  app's store listing, not release one past Apple's review.
- **Setting it up:** download the `.p8` (Apple lets you, once only), then
  `node scripts/secret-set.mjs APP_STORE_CONNECT_KEY < AuthKey_XXXX.p8` and delete the file. The key's ID and the
  page's Issuer ID go in the other two.

### `APPLE_TEAM_ID`

The Apple Developer team's ID. **Not secret** (every app link carries it), kept here so there's one copy. Without it,
the build can't be signed, and phones won't open team app links in the app or use its passkeys.

- **Owner:** the Apple Developer membership.
- **Bitwarden:** `APPLE_TEAM_ID`, shared, in `cougars-dev`.
- **Used by:** `store.yml` (signing), and the team Worker, which serves it to phones at
  `/.well-known/apple-app-site-association` (`worker/store/store.links.ts`).
- **Gets there by:** `scripts/store-setup.mjs` stores it; CI pull; `deploy.yml` puts it on the team Worker.
- **Expires:** never.

### Apple push key

The APNs key, uploaded to Firebase (Project settings → Cloud Messaging → Apple app configuration), which uses it to
reach iPhones. **No code reads it.** It's kept only as a recovery copy, because Apple lets you download it once
(ADR 0002 point 1).

- **Owner:** Apple Developer → Certificates, IDs & Profiles → Keys.
- **Bitwarden:** `APNS_KEY` and `APNS_KEY_ID` (not secret), shared, in `cougars-dev`.
- **Used by:** nothing; Firebase holds its own copy.
- **Expires:** no.
- **Changing it:** make a new key, upload it to Firebase, store it here, revoke the old one (Apple allows two at a
  time). **A leaked key could** send notifications to the app's users, given their phones' tokens.
- **Setting it up:** Keys → +, **Apple Push Notifications service**, Sandbox & Production;
  `node scripts/secret-set.mjs APNS_KEY < AuthKey_XXXX.p8`, the Key ID in `APNS_KEY_ID`, then delete the file.

### App Review sign-in

Apple's reviewers sign in to the app, and can't read our email. So this one member's email takes this fixed
six-digit code instead of an emailed one (ADR 0023, 0108), with every other sign-in limit as ever. The member is a
plain Member in production's roster. **Not in Bitwarden yet:** they're made when the app first goes to review.

- **Owner:** us.
- **Bitwarden:** `APP_REVIEW_EMAIL__PRODUCTION` and `APP_REVIEW_CODE__PRODUCTION`, in `cougars`.
- **Used by:** the team Worker's sign-in (`worker/auth/auth.ts`).
- **Gets there by:** CI pull, then `deploy.yml` puts both on the team Worker.
- **Expires:** no. Change the code after each review if you like.
- **Setting it up:**
  `node -e 'process.stdout.write(String(require("crypto").randomInt(1e5, 1e6)))' | node scripts/secret-set.mjs APP_REVIEW_CODE__PRODUCTION`,
  and `npm run secret:set APP_REVIEW_EMAIL__PRODUCTION`. Both go to Apple in App Store Connect's App Review
  Information.

**Android, later:** `PLAY_SERVICE_ACCOUNT` (Play Console upload), `PLAY_UPLOAD_KEY` and `FIREBASE_ANDROID_CONFIG`
join these (ADR 0108).

---

## Sanity

Two Sanity projects hold the website's content: **Cougars** (`ah165efl`, production) and **Cougars Dev**
(`zmg6rbe3`), each with one public `production` dataset. Their IDs aren't secret (`packages/shared/sanity.ts`), and
public datasets need no read token. The club account and a maintainer are Administrators.

### `SANITY_DEPLOY_TOKEN`

Lets CI send the Studio's schema to Sanity on every push to `release`, so Sanity's own tools know the fields. The
Studio itself is self-hosted at https://studio.batterseacougars.com ([ADR 0112](adr/0112-self-hosted-studio.md)),
deployed with Cloudflare's token. Without it, the schema deploy step fails.

- **Owner:** Sanity → manage → project **Cougars** → API → Tokens, role **Deploy Studio**, named
  `SANITY_DEPLOY_TOKEN__PRODUCTION`.
- **Bitwarden:** `SANITY_DEPLOY_TOKEN__PRODUCTION` in `cougars`. Production only.
- **Used by:** the `studio` job in `deploy.yml` (`sanity schemas deploy`, which reads it as `SANITY_AUTH_TOKEN`).
- **Gets there by:** CI pull; the job maps `SANITY_DEPLOY_TOKEN` to `SANITY_AUTH_TOKEN`. Never name it
  `SANITY_STUDIO_*`: the Studio build puts those variables in its public JavaScript.
- **Expires:** no.
- **Changing it:** add a new Deploy Studio token with the same name, update Bitwarden, push `release` (or re-run the
  job), delete the old token.

---

## GitHub

GitHub holds only the two [Bitwarden tokens](#bitwarden-tokens), one per GitHub environment. Everything else is in
Bitwarden.

### `GITHUB_APP_PRIVATE_KEY`

The private key of the GitHub App **Cougars rebuilds**. The team Worker signs a short request with it and swaps that
for a token that lasts an hour, to start a website rebuild when a result changes
([ADR 0100](adr/0100-website-reads-tournament-results.md)). Without it, results reach the website only at the daily
rebuild.

- **Owner:** the `battersea-cougars` organisation (not a person, so it outlives any maintainer): Settings →
  Developer settings → GitHub Apps → Cougars rebuilds → Private keys. Installed on `battersea-cougars/ark` only,
  webhook off.

  | Applies to              | Permission          | Why                                                |
  | ----------------------- | ------------------- | -------------------------------------------------- |
  | `battersea-cougars/ark` | Actions: read/write | Running `deploy.yml` for the website (`apps: web`) |
  | `battersea-cougars/ark` | Metadata: read      | Required by GitHub for every App                   |

  **A leaked key could** start or cancel workflow runs, and delete runs and their artifacts (old backups,
  [ADR 0106](adr/0106-database-backups.md)). Not push code, not read secrets, not change settings. Each token the
  Worker takes asks for Actions: write on this repo alone. `main` and `release` refuse force-pushes and deletion
  (repository ruleset), and only `release` deploys production.

- **Bitwarden:** `GITHUB_APP_PRIVATE_KEY`, shared, in `cougars-dev`: nothing needs a different value.
- **Used by:** the team Worker (`worker/website/website.ts`), with the App's Client ID and installation ID (not
  secret, [Plain settings](#plain-settings)).
- **Gets there by:** a Worker secret when the team app deploys.
- **Expires:** no.
- **Changing it:** generate a new key on the App, store it as below, redeploy, then delete the old key on the App.
- **Format:** PKCS#8 (`-----BEGIN PRIVATE KEY-----`), which the Workers runtime imports. GitHub hands out PKCS#1, so
  convert when storing (never save the file in the repo; `*.pem` is gitignored):
  `openssl pkcs8 -topk8 -nocrypt -in KEY.pem | node scripts/secret-set.mjs GITHUB_APP_PRIVATE_KEY`

---

## Sentry

Errors from both apps, server and browser, and the down alerts ([ADR 0111](adr/0111-errors-and-uptime.md)). One
organisation, `battersea-cougars`, in Sentry's **EU region** (`de.sentry.io`), on the free Developer plan (one user:
the developer account, which forwards the alerts). Projects `web` and `team`; each event says its environment.
Alerts email on a new issue in **production** or **dev**, and on a spike in production; the team Worker's hourly
cron has a cron monitor. Without these, errors only go to the log.

### `SENTRY_AUTH_TOKEN`

Sets Sentry up and uploads source maps, so error reports show our code, not minified code.

- **Owner:** the developer account's personal token (User settings → Personal Tokens), named `SENTRY_AUTH_TOKEN`,
  with Project Admin, Team Read & Write, Release Admin, Issue & Event Read, Organization Read and Alerts Read &
  Write.
- **Bitwarden:** `SENTRY_AUTH_TOKEN`, shared, in `cougars-dev`.
- **Used by:** `scripts/sentry-setup.mjs` (projects, the alerts, the cron and uptime monitors) and the deploy's
  "Source maps" steps.
- **Gets there by:** CI pull. Set with `npm run secret:set SENTRY_AUTH_TOKEN`.
- **Expires:** no.
- **Changing it:** make a new one, set it, revoke the old.

### `SENTRY_DSN_WEB`, `SENTRY_DSN_TEAM`

Where each app sends its errors. **Not really secret** (the team app's is in its browser code), but kept out of
this public repo, so nobody can fill our free quota with fake errors.

- **Owner:** the Sentry projects `web` and `team`.
- **Bitwarden:** `SENTRY_DSN_WEB`, `SENTRY_DSN_TEAM`, shared, in `cougars-dev`.
- **Used by:** each Worker (as `SENTRY_DSN`), and the team app in the browser (built in as `VITE_SENTRY_DSN`).
- **Gets there by:** `sentry-setup.mjs` makes and stores them; CI pull; `deploy.yml` puts each on its Worker as
  `SENTRY_DSN` and builds the team app with `VITE_SENTRY_DSN`. Unset (your machine): no reports, only the log.
- **Expires:** no.
- **Setting up or checking:** `node scripts/env-pull.mjs -- node scripts/sentry-setup.mjs` (add `--uptime` for the
  monitors).

---

## Instagram

The website's photos are the club's Instagram posts (`apps/web/src/lib/server/instagram.ts`,
[ADR 0113](adr/0113-photos-from-instagram.md)). Production only: without it, dev, previews and your machine show a
sample feed, and production shows "No photos yet".

### `INSTAGRAM_TOKEN`

The first read-only token. The Worker renews it weekly by itself and keeps the renewed one in D1, sealed with
[`INSTAGRAM_TOKEN_KEY`](#instagram_token_key) (the exception to Bitwarden-only, ADR 0002 point 8). **Not in
Bitwarden yet.**

- **Owner:** the club account owns the Instagram account (Professional); the developer account owns the Meta app
  "Battersea Cougars website" at developers.facebook.com.
- **Bitwarden:** `INSTAGRAM_TOKEN__PRODUCTION` in `cougars`.
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
     Instagram, and copy the token (permission `instagram_business_basic` only: read its own posts).
  5. `npm run secret:set INSTAGRAM_TOKEN__PRODUCTION`, then run a production deploy.

---

## Web Push

Notifications in a browser ([ADR 0108](adr/0108-store-apps.md), #24): Android's Chrome or Firefox, a desktop, an
iPhone with the app on its Home Screen. The team Worker sends straight to each browser's push service
(`worker/push/webpush.ts`), signed with the club's VAPID key pair. No account anywhere: the key pair is all there is.
Without it, browser notifications are logged, not sent.

### `VAPID_PRIVATE_KEY`

The pair's private key (P-256, its 32-byte `d`, base64url). Its public key is no secret: `VAPID_PUBLIC_KEY` in
`apps/team/wrangler.jsonc`'s vars, which the Worker reads and the app's build bakes in.

- **Owner:** us.
- **Bitwarden:** `VAPID_PRIVATE_KEY`, shared, in `cougars-dev`. One pair for dev and production: a browser's
  subscription belongs to the address that made it, so the two never share one.
- **Used by:** the team Worker (`worker/push/push.ts`).
- **Gets there by:** CI pull, then `deploy.yml` puts it on the team Worker as a secret. On your machine, the team
  app's dev server has it when started with dev secrets (`npm run app`), so `localhost` can try it.
- **Expires:** no.
- **Changing it:** delete the secret, run the script below, commit, deploy. Each browser takes the new key the next
  time it opens the app (until then its sends fail and are logged). **A leaked key could** send notifications to
  members' browsers, but only given their subscriptions too, which are only in the club's database.
- **Setting it up:** `node scripts/webpush-setup.mjs` puts the private key straight into Bitwarden and the public key
  into `wrangler.jsonc` (safe to run again: with both in place it only checks they're a pair); commit
  `wrangler.jsonc` after.

---

## Our own keys

Random keys we make ourselves, with no outside account. Each has one job: never reuse one for another.
Make one with 32 random bytes, never seen by anyone, for example
`openssl rand -base64 32 | npm run secret:set NAME`.

### `BACKUP_KEY`

Seals the database's backups ([ADR 0106](adr/0106-database-backups.md)). A backup is the whole database, members'
names and emails included, kept as an artifact on this public repo, so it's encrypted (`scripts/lib/backup.mjs`).
One per environment, so a dev key can't open production's backups. Without it, backups fail.

- **Owner:** us.
- **Bitwarden:** `BACKUP_KEY__PRODUCTION` in `cougars`; `BACKUP_KEY` (dev's) in `cougars-dev`.
- **Used by:** `scripts/db-backup.mjs` (`backup.yml` nightly, and `deploy.yml` before it changes the schema) and
  `scripts/db-restore.mjs`, which opens one ([db/README.md](../db/README.md#backups)).
- **Gets there by:** CI pull. On your machine, `node scripts/env-pull.mjs -- node scripts/db-restore.mjs …`
  (`--environment production` for a production backup).
- **Expires:** no.
- **Changing it:** only if it leaks. A new key can't open the old backups: keep the old one (as `BACKUP_KEY_OLD…`)
  until they've aged out, 90 days.
- **Setting it up:**
  `node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))' | node scripts/secret-set.mjs BACKUP_KEY__PRODUCTION`
  (and `BACKUP_KEY` for dev).

### `GMAIL_TOKEN_KEY`

Seals the Gmail token an admin reconnects, in D1 (AES-GCM, `packages/shared/sealed-tokens.ts`; see [Gmail](#gmail)).
One per environment. Without it, **Reconnect email** says it isn't set up, and only `GMAIL_REFRESH_TOKEN` sends.

- **Owner:** us.
- **Bitwarden:** `GMAIL_TOKEN_KEY__PRODUCTION` in `cougars`; `GMAIL_TOKEN_KEY` (dev's) in `cougars-dev`.
- **Used by:** both Workers (`packages/shared/gmail-token.ts`), and the team app's dev server on your machine.
- **Gets there by:** CI pull, then `deploy.yml` puts it on both Workers.
- **Expires:** no.
- **Changing it:** set a new value and deploy. The sealed token then won't open: the Workers fall back to
  `GMAIL_REFRESH_TOKEN` (an error says so), and an admin reconnects to seal a fresh one.
- **Setting it up:** `openssl rand -base64 32 | npm run secret:set GMAIL_TOKEN_KEY__PRODUCTION`, and the same for
  `GMAIL_TOKEN_KEY`.

### `INSTAGRAM_TOKEN_KEY`

Seals the renewed Instagram token in D1 (AES-GCM; see [Instagram](#instagram)). Production only.

- **Owner:** us.
- **Bitwarden:** `INSTAGRAM_TOKEN_KEY__PRODUCTION` in `cougars`.
- **Used by:** the website Worker (`apps/web/src/lib/server/instagram-token.ts`).
- **Gets there by:** CI pull, then `deploy.yml` puts it on the Worker.
- **Expires:** no.
- **Changing it:** set a new value and deploy. The sealed token then won't open: the Worker falls back to the
  Bitwarden token (an error says so) and seals a fresh one at the next weekly renewal. If the Bitwarden one has
  expired by then, make a new token.
- **Setting it up:** `openssl rand -base64 32 | npm run secret:set INSTAGRAM_TOKEN_KEY__PRODUCTION`.

### `SMOKE_TOKEN`

Lets the deploy's smoke test send a real "Try a session" enquiry (`scripts/ci/smoke-test.mjs`,
`apps/web/src/lib/server/smoke.ts`, [ADR 0027](adr/0027-email-through-gmail-api.md)). With it in the
`X-Cougars-Smoke` header, the enquiry is saved, both emails go out **to the sending account only** (in production
too), and the row is deleted. The deploy fails unless both emails were sent.

- **Not stored anywhere**, not in Bitwarden either. Every website deploy makes one at random (`deploy.yml`, "Smoke
  key"), puts it on the Worker and hands it to the smoke test.
- **Spent** straight after the test, pass or fail: the Worker gets a new random value nobody ever sees, so a key
  works for its own deploy's test only. A smoke header with any other key is refused (403), never taken as an
  ordinary enquiry.
- **PR previews** share dev's Worker, so they skip the form test.

---

## Club data

### Team roster

The club's starting players as one line of JSON: name, position (F/D/G), rating, and optionally an email and roles.
Not a credential, but personal data (names and skill ratings), so it never goes in this public repo
([ADR 0029](adr/0029-personal-data.md)). Format and local use: [db/seed/README.md](../db/seed/README.md).

- **Owner:** the club (the admins).
- **Bitwarden:** only `TEAM_ROSTER__PRODUCTION`, in `cougars`: production's two admins. Everyone else is imported in
  the app (Members → Manage → Import members, [ADR 0050](adr/0050-schema-and-seed-until-launch.md)). Dev has no
  roster in Bitwarden: its database already holds its people, so its deploys skip the seed.
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

Values that aren't secret. Most are committed in config. Some are kept in Bitwarden anyway, so there's one copy
beside the secret they go with.

### Kept in Bitwarden, but not secret

Each is an ID or address that is public, or useless without its secret:

| Name                                | System     | Why it isn't secret                                                 |
| ----------------------------------- | ---------- | ------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID__PRODUCTION` | Cloudflare | An account's ID, on its home page; useless without a token          |
| `CLOUDFLARE_ACCOUNT_ID__DEV`        | Cloudflare | The same, for Cougars Dev                                           |
| `CF_ACCESS_CLIENT_ID__PRODUCTION`   | Cloudflare | Half of a pair; useless without `CF_ACCESS_CLIENT_SECRET`           |
| `GMAIL_CLIENT_ID`                   | Google     | An OAuth client ID: Google's consent page shows it in its URL       |
| `GMAIL_WEB_CLIENT_ID`               | Google     | The same, for the Web client                                        |
| `FIREBASE_IOS_CONFIG`               | Google     | Ships inside the app; its API key is limited to this app            |
| `APP_STORE_CONNECT_KEY_ID`          | Apple      | Names the key; useless without the `.p8`                            |
| `APP_STORE_CONNECT_ISSUER_ID`       | Apple      | The team's issuer, shown in App Store Connect                       |
| `APPLE_TEAM_ID`                     | Apple      | In every app link the team Worker serves                            |
| `APNS_KEY_ID`                       | Apple      | Names the key; useless without it                                   |
| `SENTRY_DSN_WEB`, `SENTRY_DSN_TEAM` | Sentry     | Only lets someone send errors in; the team's is in its browser code |

`APP_REVIEW_EMAIL__PRODUCTION` isn't secret either, but it's an email address, so it stays out of this public repo.

### Committed in config

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
   [tokens](#bitwarden-tokens). Put the two CI tokens in GitHub, the local one in your vault, then `bw-unlock`.
2. **Cloudflare**, in each account: [`CLOUDFLARE_API_TOKEN`](#cloudflare_api_token) and
   [`CLOUDFLARE_ACCOUNT_ID`](#cloudflare_account_id), then [`CLOUDFLARE_ANALYTICS_TOKEN`](#cloudflare_analytics_token).
   Then `turnstile-setup.mjs` ([Turnstile](#turnstile)), and, for production before launch, `access-setup.mjs`
   ([Cloudflare Access](#cloudflare-access)).
3. **Our own keys:** [`BACKUP_KEY`](#backup_key), [`GMAIL_TOKEN_KEY`](#gmail_token_key) and
   [`INSTAGRAM_TOKEN_KEY`](#instagram_token_key), for each environment.
4. **The roster:** [`TEAM_ROSTER__PRODUCTION`](#team-roster).
5. **Google:** [Gmail](#gmail) steps 1 to 9, then the [YouTube](#youtube) keys, then `firebase-setup.mjs`
   ([Firebase](#firebase)).
6. **Sanity:** [`SANITY_DEPLOY_TOKEN__PRODUCTION`](#sanity_deploy_token).
7. **GitHub:** the Cougars rebuilds App and its [key](#github_app_private_key).
8. **Sentry:** [`SENTRY_AUTH_TOKEN`](#sentry_auth_token), then `sentry-setup.mjs`, which makes the DSNs.
9. **Web Push:** `webpush-setup.mjs` ([Web Push](#web-push)).
10. **Instagram**, production only: [`INSTAGRAM_TOKEN__PRODUCTION`](#instagram_token).
11. **Apple**, when the store app is built: the [App Store Connect key](#app-store-connect-key), `store-setup.mjs`
    ([`APPLE_TEAM_ID`](#apple_team_id)), the [push key](#apple-push-key), and the [App Review sign-in](#app-review-sign-in).

Adding a new secret: create the token at its provider with the secret's exact name, store it with
`npm run secret:set NAME` (a hidden prompt; it picks the project from the name), and add its entry here in the same
change.

---

## Overview

Every name. **Env** is which environment's value it is: _prod_ (`NAME__PRODUCTION`, project `cougars`), _dev_
(`NAME__DEV`, or a plain `NAME` with a production value beside it, project `cougars-dev`), or _shared_ (one plain
`NAME` for both, project `cougars-dev`).

| Name                                                                    | System     | Env    | Secret?          | Used by                                   |
| ----------------------------------------------------------------------- | ---------- | ------ | ---------------- | ----------------------------------------- |
| [`BWS_ACCESS_TOKEN__PRODUCTION`](#bitwarden-tokens)                     | Bitwarden  | prod   | yes (in GitHub)  | Production CI jobs                        |
| [`BWS_ACCESS_TOKEN__DEV`](#bitwarden-tokens)                            | Bitwarden  | dev    | yes (in GitHub)  | `main` and PR CI jobs                     |
| [`COUGARS_LOCAL_BW_TOKEN`](#bitwarden-tokens)                           | Bitwarden  | both   | yes (your vault) | Your machine                              |
| [`CLOUDFLARE_API_TOKEN__PRODUCTION`](#cloudflare_api_token)             | Cloudflare | prod   | yes              | Production deploys, scripts               |
| [`CLOUDFLARE_API_TOKEN__DEV`](#cloudflare_api_token)                    | Cloudflare | dev    | yes              | Dev deploys, PR previews, scripts         |
| [`CLOUDFLARE_ACCOUNT_ID__PRODUCTION`](#cloudflare_account_id)           | Cloudflare | prod   | no               | Production deploys, Usage page            |
| [`CLOUDFLARE_ACCOUNT_ID__DEV`](#cloudflare_account_id)                  | Cloudflare | dev    | no               | Dev deploys, Usage page                   |
| [`CLOUDFLARE_ANALYTICS_TOKEN__PRODUCTION`](#cloudflare_analytics_token) | Cloudflare | prod   | yes              | Team app: Usage page                      |
| [`CLOUDFLARE_ANALYTICS_TOKEN__DEV`](#cloudflare_analytics_token)        | Cloudflare | dev    | yes              | Team app: Usage page, `cpu-by-route.mjs`  |
| [`TURNSTILE_SECRET_KEY__PRODUCTION`](#turnstile)                        | Cloudflare | prod   | yes              | Website, team app: forms, sign-in         |
| [`TURNSTILE_SECRET_KEY`](#turnstile)                                    | Cloudflare | dev    | yes              | Website, team app: forms, sign-in         |
| [`CF_ACCESS_CLIENT_ID__PRODUCTION`](#cloudflare-access)                 | Cloudflare | prod   | no               | Production smoke tests, until launch      |
| [`CF_ACCESS_CLIENT_SECRET__PRODUCTION`](#cloudflare-access)             | Cloudflare | prod   | yes              | Production smoke tests, until launch      |
| [`GMAIL_CLIENT_ID`](#gmail)                                             | Google     | shared | no               | Website, team app: email                  |
| [`GMAIL_CLIENT_SECRET`](#gmail)                                         | Google     | shared | yes              | Website, team app: email                  |
| [`GMAIL_REFRESH_TOKEN`](#gmail)                                         | Google     | shared | yes              | Website, team app: email                  |
| [`GMAIL_WEB_CLIENT_ID`](#gmail)                                         | Google     | shared | no               | Website, team app: reconnected email      |
| [`GMAIL_WEB_CLIENT_SECRET`](#gmail)                                     | Google     | shared | yes              | Website, team app: reconnected email      |
| [`YOUTUBE_API_KEY__PRODUCTION`](#youtube)                               | Google     | prod   | yes              | Website: videos                           |
| [`YOUTUBE_API_KEY__DEV`](#youtube)                                      | Google     | dev    | yes              | Website: videos                           |
| [`FIREBASE_SERVICE_ACCOUNT`](#firebase)                                 | Google     | shared | yes              | Team app: store app notifications         |
| [`FIREBASE_IOS_CONFIG`](#firebase)                                      | Google     | shared | no               | `store.yml`                               |
| [`APP_STORE_CONNECT_KEY`](#app-store-connect-key)                       | Apple      | shared | yes              | `store.yml`, `store-setup.mjs`            |
| [`APP_STORE_CONNECT_KEY_ID`](#app-store-connect-key)                    | Apple      | shared | no               | `store.yml`, `store-setup.mjs`            |
| [`APP_STORE_CONNECT_ISSUER_ID`](#app-store-connect-key)                 | Apple      | shared | no               | `store.yml`, `store-setup.mjs`            |
| [`APPLE_TEAM_ID`](#apple_team_id)                                       | Apple      | shared | no               | `store.yml`, team app: app links          |
| [`APNS_KEY`](#apple-push-key)                                           | Apple      | shared | yes              | Nothing: recovery copy of Firebase's      |
| [`APNS_KEY_ID`](#apple-push-key)                                        | Apple      | shared | no               | Nothing: recovery copy of Firebase's      |
| [`APP_REVIEW_EMAIL__PRODUCTION`](#app-review-sign-in) (not set yet)     | Apple      | prod   | no (personal)    | Team app: App Review sign-in              |
| [`APP_REVIEW_CODE__PRODUCTION`](#app-review-sign-in) (not set yet)      | Apple      | prod   | yes              | Team app: App Review sign-in              |
| [`SANITY_DEPLOY_TOKEN__PRODUCTION`](#sanity_deploy_token)               | Sanity     | prod   | yes              | Studio schema deploy                      |
| [`GITHUB_APP_PRIVATE_KEY`](#github_app_private_key)                     | GitHub     | shared | yes              | Team app: website rebuilds                |
| [`SENTRY_AUTH_TOKEN`](#sentry_auth_token)                               | Sentry     | shared | yes              | Deploys (source maps), `sentry-setup.mjs` |
| [`SENTRY_DSN_WEB`](#sentry_dsn_web-sentry_dsn_team)                     | Sentry     | shared | no               | Website Worker                            |
| [`SENTRY_DSN_TEAM`](#sentry_dsn_web-sentry_dsn_team)                    | Sentry     | shared | no               | Team Worker and app                       |
| [`INSTAGRAM_TOKEN__PRODUCTION`](#instagram_token) (not set yet)         | Instagram  | prod   | yes              | Website: photos                           |
| [`VAPID_PRIVATE_KEY`](#vapid_private_key)                               | Web Push   | shared | yes              | Team app: browser notifications           |
| [`BACKUP_KEY__PRODUCTION`](#backup_key)                                 | Us         | prod   | yes              | Database backups                          |
| [`BACKUP_KEY`](#backup_key)                                             | Us         | dev    | yes              | Database backups                          |
| [`GMAIL_TOKEN_KEY__PRODUCTION`](#gmail_token_key)                       | Us         | prod   | yes              | Website, team app: reconnected email      |
| [`GMAIL_TOKEN_KEY`](#gmail_token_key)                                   | Us         | dev    | yes              | Website, team app: reconnected email      |
| [`INSTAGRAM_TOKEN_KEY__PRODUCTION`](#instagram_token_key)               | Us         | prod   | yes              | Website: photos                           |
| [`SMOKE_TOKEN`](#smoke_token) (never stored)                            | Us         | both   | yes              | Deploy smoke test of the form             |
| [`TEAM_ROSTER__PRODUCTION`](#team-roster)                               | Club data  | prod   | personal data    | Deploys (D1 seed), `access-setup.mjs`     |
