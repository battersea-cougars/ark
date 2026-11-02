# 0010. Two environments on two Cloudflare accounts and two Sanity projects; `main` deploys dev, `release` production

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-11-02
- **Merges:** 0005, 0013, 0017, 0075, 0123

## Context

We need somewhere to try things (pull-request previews, merged work, a developer's machine) that can never damage the
live site or its data. A Cloudflare token's D1 rights cover a whole account, so on one account a dev token could write
to the production database. Sanity tokens and members likewise belong to a **project**, not a dataset, so one project
with two datasets would let a dev write token change the live site, and every editor could edit both copies.
gwenda-hackney/ark hit both problems and split into two Cloudflare accounts and two Sanity projects.

A hand-run deploy from a laptop skips the checks and can ship uncommitted work. And merged work needs a stable place to
be checked before it goes live. Ark deploys `main` to dev and production from a `release` branch.

## Decision

|                     | Production                                          | Dev                                                                  |
| ------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| Cloudflare account  | **Cougars**                                         | **Cougars Dev** (free)                                               |
| Website worker / D1 | `web` / `cougars`, at batterseacougars.com          | `web` / `cougars-dev`, at `web.cougars-dev.workers.dev`              |
| Team app worker     | `team`, at team.batterseacougars.com                | `team`, on dev's D1, at `team.cougars-dev.workers.dev`               |
| Studio worker       | `studio`, at studio.batterseacougars.com (ADR 0004) | `studio`, at `studio.cougars-dev.workers.dev`                        |
| Deploys from        | `release`, the daily rebuild, by `deploy.yml` only  | `main`, PRs (preview versions), `scripts/deploy-dev.sh`              |
| Secret names        | `NAME__PRODUCTION`                                  | `NAME__DEV`                                                          |
| Bitwarden project   | `cougars`                                           | `cougars-dev` (also holds shared plain `NAME`s)                      |
| GitHub environment  | `production` (`release` only): `cougars-ci`         | `preview` (`main` and PRs): `cougars-ci-dev`, reads dev only         |
| Sanity project      | **Cougars** (`ah165efl`), the live Studio           | **Cougars Dev** (`zmg6rbe3`): dev site, PRs, machines, local Studios |
| Content             | Sanity                                              | Sanity, sample content where it's empty; always `noindex`            |

**Deploys** (`.github/workflows/deploy.yml`, which builds, rebuilds D1 from the schema when it changed and smoke-tests;
`pr.yml` runs the checks):

| Trigger                  | Environment | Deploys                                                                     |
| ------------------------ | ----------- | --------------------------------------------------------------------------- |
| Pull request into `main` | dev         | a preview version of `web` (`pr-<n>` alias), linked on the PR               |
| Push to `main`           | dev         | `web`, the team app as `team`, and the Studio as `studio`                   |
| Push to `release`        | production  | `web`, the team app as `team`, and the Studio as `studio`                   |
| Daily, after 04:37 UTC   | production  | `web`, rebuilt from `release` ([ADR 0004](0004-astro-workers-sanity-d1.md)) |

- **The club's outside accounts have no dev copy.** There's one club Instagram, one YouTube channel, one Google
  project: we can't make dev versions of them, and a fake one would show nothing real. So dev, PR previews and your
  machine read the **real** accounts, read-only, and show the club's real photos and videos, as production does.
  Only credentials that can read and nothing more are shared like this: Instagram's token is one value for both
  (plain `INSTAGRAM_TOKEN`), YouTube's key is one each (`__DEV` and `__PRODUCTION`, so a leaked dev key is revoked
  alone), of the same channel. Anything that writes to an outside account (Gmail's send-only token is the one
  exception, ADR 0027) is decided case by case. What dev keeps apart is our own data: its D1, its Sanity project.
- **One job per app, and only the apps a change touches.** `deploy.yml`'s `changes` job reads the files a push or PR
  changed (both sides of a move): `apps/web/` and the club snapshot's scripts deploy the website, `apps/team/` (and its
  build's budget and dev-server scripts) the team app, `apps/studio/` the Studio, and shared code, `db/`, the
  lockfile, the workflow and its actions, and the scripts every job runs (`scripts/ci/`'s target, smoke test and
  links; `env-pull.mjs`) deploy every app. The rest of `scripts/` (the show switch, setup and load scripts) deploys
  nothing. A manual run picks with its `apps` input;
  a rebuild deploys the website only. The shared D1 database is its own `database` job (rebuild from the schema, seed
  the roster), run only when `db/` or its scripts change, or on a manual `all`; both apps wait for it then, and
  otherwise deploy side by side.
- **PR checks run what a change can reach** (`pr.yml`, `scripts/ci/pr-plan.mjs`): the tiers of `npm run merge:check`
  ([ADR 0115](0115-worktrees-and-the-show-switch.md)). Docs alone get a format check; code gets lint, knip and the tests,
  then the checks and builds of its apps (a website change the team app's too); anything outside the apps, everything.
  One job, so its name never changes.
- **Every job restores its `node_modules`** from a cache keyed on the OS, Node and the lockfile (`.github/actions/setup`),
  and runs `npm ci` only on a miss, saving the tree straight after: the install was most of every job.
- **Every app is linked from GitHub's Deployments page**, under its own name: `web (dev)`, `web (PR preview)`,
  `web (production)`, `team (dev)`, `team (production)`, `studio (dev)`, `studio (production)` (`scripts/ci/link-deployment.sh`), and each run's summary
  lists them. Jobs read their GitHub environment's secrets with `deployment: false`, so `preview` and `production`
  list nothing of their own.
- **Never deploy production by hand.** Going live is on purpose: a pull request from `main` into `release`, merged
  once its PR checks pass (a merge commit, so `release` keeps `main`'s commits as they are). Work reaches `main` by
  pull request too. GitHub enforces it: `release` takes changes only through a pull request whose checks pass
  (a ruleset, `scripts/branch-rules.mjs`), the `production` environment accepts deployments from
  `release` only, and the `preview` environment holds only the dev Bitwarden token ([ADR 0002](0002-secrets-in-bitwarden.md)).
  `scripts/ci/target.mjs` points a build at one environment; only CI runs it for production.
- A scheduled or dispatched rebuild runs on the default branch, so its only job starts the workflow again on `release`.
  Unreleased code on `main` never goes live by accident.
- We skip Ark's prod-preview-then-promote step: one site, one maintainer.
- **A developer's machine is dev**: `scripts/env-pull.mjs` defaults to `--environment dev`. A production-only secret is
  always `NAME__PRODUCTION`, so the dev token can't see it.
- **The environment picks the Sanity project**, the same way it picks the Cloudflare account: `packages/shared/sanity.ts` maps
  `SITE_ENV=production` to Cougars and everything else to Cougars Dev. Each project has one public dataset,
  `production`. The website build reads `SITE_ENV` (set by `deploy.yml`); the Studio reads `SANITY_STUDIO_SITE_ENV`,
  set to `production` only by the Studio deploy job. Project IDs live in code: they aren't secret (every image URL
  contains one), and public datasets need no read token.
- **Workers are named for the app, not the club**: `web` and `team` in both accounts, since the account's workers.dev
  subdomain already says which environment (`cougars-dev`). Databases and Bitwarden projects keep their names.
- **The team app deploys like the website**, as its own job: `main` to dev, `release` to production at
  `team.<the site's domain>`, a Workers custom domain (`scripts/ci/target.mjs <environment> team`). Its secrets come
  from that environment's project (`GMAIL_*`, `CLOUDFLARE_ANALYTICS_TOKEN`, `GITHUB_APP_PRIVATE_KEY`); a missing one is
  skipped. On dev `SITE_ENV` is `dev`, so every email goes to the safe address
  ([ADR 0027](0027-email-through-gmail-api.md)). No PR previews: it deploys with `wrangler deploy`, not a
  previews-only upload, so the live hub's Durable Object migration is applied ([ADR 0053](0053-how-the-team-app-gets-its-data.md)), and
  `pr.yml` checks PRs instead (`svelte-check`, the Worker's `tsc`, a build).
- **Every deploy is smoke-tested.** The team app's `/api/health` reads the database, so a broken D1 binding fails the
  deploy; without a session the club answers 401, and the local sign-in doesn't answer at all
  ([ADR 0023](0023-sign-in-and-sessions.md)).
- **CI trusts as little as it can** (#70): every action is pinned to a commit SHA (its tag in a comment), the
  Bitwarden CLI is checked against its published checksum before it runs, each workflow starts with
  `contents: read` and a job widens only what it needs, the PR comment goes through GitHub's own `gh`, every commit is scanned for secrets (gitleaks, the same way pinned
  and checked; `pr.yml`, `secrets.yml`, [0002](0002-secrets-in-bitwarden.md)), and Dependabot
  proposes updates weekly, grouped, checked by `pr.yml`. `main` and `release` refuse force-pushes and deletion (a
  repository ruleset, `scripts/branch-rules.mjs`).
- **The team app is behind Cloudflare Access until launch**, so it can be deployed and tried for real first (the
  website, `batterseacougars.com` and `www.`, has been open since 2026-10-30): it asks for an email and a one-time code and let in only the emails on its Admins policy, which
  is managed by hand in the Zero Trust dashboard (`scripts/access-setup.mjs` starts it once, docs/accounts.md). CI gets past it with a service token
  (`CF_ACCESS_CLIENT_ID/SECRET__PRODUCTION`) for the smoke tests. Until the `production` environment's variable
  `LAUNCHED` is `true`, production's database rebuilds like dev's ([ADR 0050](0050-schema-and-seed-until-launch.md)).
  Launch: `db-launch.mjs`, `access-setup.mjs --remove`, `LAUNCHED=true`.
- **Rolling back is a workflow too**: Actions → _Roll back_ (`.github/workflows/rollback.yml`), run on `release` for
  production or `main` for dev, puts one worker (`web` or `team`) back to the version before the last deploy, or to a
  version id, with a reason. It is code only: the database stays as it is. The next deploy from that branch replaces
  it, so revert the bad commit on `main` too, then release again.
- **Team-app screens still on demo data are dev-only.** Dues, Fees, Unpaid fees and Upload have no backend yet; the
  bootstrap's `unfinished` flag (true unless `SITE_ENV` is `production`) shows them on dev and locally to try, and
  production leaves them, and every link to them, out ([#63](https://github.com/battersea-cougars/ark/issues/63)). Each comes
  back for everyone when its backend lands.
- **A corner ribbon says which copy you're on**: a small sticker-yellow band in the bottom-right corner (above the tabs
  on a phone), and the same word in front of the tab's title, `LOCAL` on your machine and `DEV` on the dev account;
  production has neither (`packages/shared/ribbon.ts`). Only a positive sign shows one: the website's build reads
  `SITE_ENV` (`dev` from `deploy.yml` and `scripts/deploy-dev.sh`, none on a machine), so production's pages carry no
  ribbon markup; the team app's reads `VITE_SITE_ENV` (`deploy.yml`), and none plus Vite's dev server is your machine.
  Anything else, a team build on a machine included, shows nothing. On your machine the band has a second line, the
  branch of the checkout the dev server runs from (ADR 0115), and the tab says it too (`[LOCAL team/review] Home`);
  "own data" joins LOCAL when that checkout runs on its own local D1 (`npm run app -- --own-db`, or a worktree without
  the show switch's `COUGARS_LOCAL_STATE`) rather than main's shared one. The configs read it from git once, when the
  dev server starts (`packages/shared/ribbon.checkout.ts`); a deploy's build never does, so DEV and production are as
  they were.
- `DEMO_CONTENT` (sample events, videos, players and placeholder photos) is never on for production: what Sanity
  doesn't have yet, production doesn't show.
- **A dev-only tool isn't there in production.** It exists only where the environment says so in so many words: a
  deploy's `SITE_ENV` is `dev`, or your own machine's server says `TEAM_ENV` `local` with no `SITE_ENV`. Anything else
  (production, a missing or unknown environment) counts as production: fail closed. A route says
  `only: (env) => boolean` (`api.route.ts`) and the router leaves it out before matching, so production answers 404 to
  anyone before reading who's asking; the handler checks again, and it still needs its action like any admin job. The
  bootstrap says whether it's there for you, and the app shows it only then. (Email fails the other way, safe by
  sending less: outside production it reaches only the safe inbox, [ADR 0027](0027-email-through-gmail-api.md).) What
  the Kumite simulator and Dev tools do is in [the Settings notes](../../apps/team/worker/settings/README.md).

## Consequences

- Two Cloudflare logins, two Sanity projects and their tokens to look after, documented in
  [docs/secrets.md](../secrets.md). Webhooks, CORS origins, tokens and members are set up per Sanity
  project ([accounts.md](../accounts.md#sanity)); each counts against the free plan separately.
- Each environment has its own database: a PR rebuilds dev, never production. Dev's data is rebuilt on each deploy
  from the schema and seed ([ADR 0050](0050-schema-and-seed-until-launch.md)).
- Merged work lands on the dev site first; production lags until someone pushes `release`.
- A local Studio, a dev build or a dev token can't touch live content. Write tokens will be one per project:
  `SANITY_API_TOKEN__DEV` and `SANITY_API_TOKEN__PRODUCTION`. The team manager sees one Studio, the live one, and
  practises in Cougars Dev, which they're invited to separately. Content doesn't flow between the projects; copying
  live content into dev, if ever wanted, is a script, not a deploy step.
- On dev, the team app's sign-in codes arrive in the dev sending account's inbox, not the member's.
- The dev site is `web.<dev subdomain>.workers.dev`, the team app `team.<dev subdomain>.workers.dev`; PR previews are
  aliases on `web`. Run `scripts/deploy-dev.sh`
  once before the first PR on a fresh account, so the worker exists.
