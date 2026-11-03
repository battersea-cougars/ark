# 0134. A fresh clone runs after npm install: no secrets, no magic environment variables, outside services faked or off

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The repo is public, and the people who work on it change: club volunteers, a developer who's never seen it, and AI
agents in fresh worktrees. Running the apps locally had come to depend on things a newcomer doesn't have: environment
variables set by hand or by the show switch, a `.env` copied from someone, and secrets from the club's Bitwarden for
services (Gmail, Firebase Cloud Messaging, Sentry, Instagram, YouTube) that a laptop has no business calling. A step
that lives only in someone's head breaks the first time someone else tries it.

## Decision

- **A fresh clone runs with `npm ci` and nothing else**: no environment variables, no files from someone else, no
  secrets. Local defaults are plain committed settings: `scripts/lib/settings.mjs`, the wrangler configs' vars and
  `astro.config` defaults ([ADR 0002](0002-secrets-in-bitwarden.md) keeps what isn't secret in committed config).
- **Each outside service is faked or off when its secret is missing**:
  - sign-in codes show on screen (`devCode`), so nobody needs an inbox;
  - emails are logged, never sent (`mail.logged`, [ADR 0027](0027-email-through-gmail-api.md));
  - Turnstile uses Cloudflare's test key;
  - Sentry, push (FCM and Web Push), Instagram and YouTube are off or show samples.
- **The website reads dev Sanity's public dataset with no token.** A build with no `SITE_ENV` falls back to
  `apps/web/src/lib/sanity/fallback.ts` when Sanity can't be read (warning `content.built_without_sanity`); deploy
  builds set `SITE_ENV` and still fail loudly ([ADR 0004](0004-astro-workers-sanity-d1.md)).
- **Unlocking the Bitwarden vault is an optional extra, never required.** `bw-unlock`, then `npm run app restart`,
  brings dev's real services to your machine.
- **Production is unchanged**: there a missing secret fails loudly or is reported (`mail.unconfigured`); faking is
  only ever for an environment that isn't production ([ADR 0010](0010-environments-and-deploys.md)).
- **CI keeps it true.** `pr.yml`'s `fresh-clone` job (`node scripts/ci/fresh-clone.mjs`) does a real `npm ci` with no
  secrets, builds the local D1, runs every build, starts the apps with `--private`, signs in and checks the seed is
  there. `scripts/install-scripts.test.mjs` keeps `package.json`'s `allowScripts` in step with the lockfile.

The local steps, as [docs/development.md](../development.md) has them:

```sh
npm ci                      # all you need: no secrets, no vault, no .env
npm run db:rebuild:local    # the local D1: db/schema.sql and the club seed
npm run db:seed:local       # a made-up club, its admin Ada Admin (admin@example.com)
npm run dev                 # the website, http://localhost:4500
npm run team                # the team app, http://localhost:4510: sign in as admin@example.com, the code shows on screen
npm run studio              # the Sanity Studio, http://localhost:4520 (to edit: npx sanity login)
npm test
```

## Consequences

- Anyone can clone, install and work with no access to the club's accounts.
- A change that makes a secret required locally fails the PR. The fix is a fake or an off-switch, not a docs step.
- Local builds may quietly show fallback content when Sanity is down; deploys still fail.
- Each code PR gets an uncached `npm ci` and a second set of builds, on free runners
  ([ADR 0003](0003-free-tiers-only.md)).
- A dependency bump that changes an install script needs `allowScripts` updated; the test says how.
