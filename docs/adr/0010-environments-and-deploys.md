# 0010. Two environments on two Cloudflare accounts and two Sanity projects; `main` deploys dev, `release` production

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-17
- **Merges:** 0005, 0013, 0017, 0075

## Context

We need somewhere to try things (pull-request previews, merged work, a developer's machine) that can never damage the
live site or its data. A Cloudflare token's D1 rights cover a whole account, so on one account a dev token could write
to the production database. Sanity tokens and members likewise belong to a **project**, not a dataset, so one project
with two datasets would let a dev write token change the live site, and every editor could edit both copies.
gwenda-hackney/ark hit both problems and split into two Cloudflare accounts and two Sanity projects.

A hand-run deploy from a laptop skips the checks and can ship uncommitted work. And merged work needs a stable place to
be checked before it goes live. Ark deploys `main` to dev and production from a `release` branch.

## Decision

|                     | Production                                         | Dev                                                                  |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| Cloudflare account  | **Cougars**                                        | **Cougars Dev** (free)                                               |
| Website worker / D1 | `web` / `cougars`, at batterseacougars.com         | `web` / `cougars-dev`, at `web.cougars-dev.workers.dev`              |
| Team app worker     | `team`, at team.batterseacougars.com               | `team`, on dev's D1, at `team.cougars-dev.workers.dev`               |
| Deploys from        | `release`, the daily rebuild, by `deploy.yml` only | `main`, PRs (preview versions), `scripts/deploy-dev.sh`              |
| Secret names        | `NAME__PRODUCTION`                                 | `NAME__DEV`                                                          |
| Bitwarden project   | `cougars`                                          | `cougars-dev` (also holds shared plain `NAME`s)                      |
| GitHub environment  | `production` (`release` only): `cougars-ci`        | `preview` (`main` and PRs): `cougars-ci-dev`, reads dev only         |
| Sanity project      | **Cougars** (`ah165efl`), the hosted Studio        | **Cougars Dev** (`zmg6rbe3`): dev site, PRs, machines, local Studios |
| Content             | Sanity                                             | Sanity, sample content where it's empty; always `noindex`            |

**Deploys** (`.github/workflows/deploy.yml`, which runs the checks, rebuilds D1 from the schema and smoke-tests):

| Trigger                  | Environment | Deploys                                                                     |
| ------------------------ | ----------- | --------------------------------------------------------------------------- |
| Pull request into `main` | dev         | a preview version of `web` (`pr-<n>` alias), linked on the PR               |
| Push to `main`           | dev         | `web`, then the team app as `team`                                          |
| Push to `release`        | production  | `web`, the team app as `team`, and the hosted Studio                        |
| Daily, 04:30 UTC         | production  | `web`, rebuilt from `release` ([ADR 0004](0004-astro-workers-sanity-d1.md)) |

- **One job per app, and only the apps a change touches.** `deploy.yml`'s `changes` job reads the files a push or PR
  changed: `apps/web/` and `scripts/` deploy the website, `apps/team/` the team app, `apps/studio/` the Studio, and
  shared code, `db/`, the lockfile and the workflow itself deploy every app. A manual run picks with its `apps` input;
  a rebuild deploys the website only. The shared D1 database is its own `database` job (rebuild from the schema, seed
  the roster), run only when `db/` or its scripts change, or on a manual `all`; both apps wait for it then, and
  otherwise deploy side by side.
- **Every app is linked from GitHub's Deployments page**, under its own name: `web (dev)`, `web (PR preview)`,
  `web (production)`, `team (dev)`, `team (production)`, `studio (production)` (`scripts/ci/link-deployment.sh`), and each run's summary
  lists them. Jobs read their GitHub environment's secrets with `deployment: false`, so `preview` and `production`
  list nothing of their own.
- **Never deploy production by hand.** Going live is on purpose: fast-forward `release` to `main`
  (`git push origin main:release`). GitHub enforces it: the `production` environment accepts deployments from
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
  previews-only upload, so the live hub's Durable Object migration is applied ([ADR 0072](0072-live-updates.md)), and
  `pr.yml` checks PRs instead (`svelte-check`, the Worker's `tsc`, a build).
- **Every deploy is smoke-tested.** The team app's `/api/health` reads the database, so a broken D1 binding fails the
  deploy; without a session the club answers 401, and the local sign-in doesn't answer at all
  ([ADR 0023](0023-sign-in-and-sessions.md)).
- **CI trusts as little as it can** (#70): every action is pinned to a commit SHA (its tag in a comment), the
  Bitwarden CLI is checked against its published checksum before it runs, each workflow starts with
  `contents: read` and a job widens only what it needs, the PR comment goes through GitHub's own `gh`, and Dependabot
  proposes updates weekly, grouped, checked by `pr.yml`. `main` and `release` refuse force-pushes and deletion (a
  repository ruleset).
- **Production is behind Cloudflare Access until launch**, so it can be deployed and tried for real first: the site,
  `www.` and the team app ask for an email and a one-time code and let in only production's admins
  (`scripts/access-setup.mjs`, docs/setup.md). CI gets past it with a service token
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
- `DEMO_CONTENT` (sample events, videos, players and placeholder photos) is never on for production: what Sanity
  doesn't have yet, production doesn't show.

## Consequences

- Two Cloudflare logins, two Sanity projects and their tokens to look after, documented in
  [README.md#secrets](../../README.md#secrets). Webhooks, CORS origins, tokens and members are set up per Sanity
  project ([setup.md](../setup.md#2-sanity-content-editing)); each counts against the free plan separately.
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

## History

- 2026-10-05: Production deploys only from `main` via `deploy.yml`; design previews on a separate `cougars-preview`
  worker on the same account (0005).
- 2026-10-05: Two environments on two Cloudflare accounts, with one Sanity project and two datasets; `cougars-preview`
  dropped for the dev account (0010, superseding 0005).
- 2026-10-05: `main` deploys dev and `release` production, so merged work has a stable place before it goes live
  (0013).
- 2026-10-05: Two Sanity projects, one per environment, so a dev token can't reach live content (0017).
- 2026-10-05: The Studio publish webhook dropped for a daily production rebuild (ADR 0004).
- 2026-10-08: The team app deploys to dev from `main` as `cougars-team-dev`; no production until launch (0075).
- 2026-10-09: Team-app screens still on demo data (dues, fees, Upload) are hidden in production (#63).
- 2026-10-09: Every app gets a link on the Deployments page: the team app and the Studio as their own environments;
  the Studio deploy moves into the production job.
- 2026-10-09: Workers renamed `web` and `team` in both accounts (were `cougars`, `cougars-dev`, `cougars-team-dev`), so
  dev is `web.cougars-dev.workers.dev`, not `cougars-dev.cougars-dev.workers.dev`.
- 2026-10-09: One job per app (`web`, `team`, `studio`); a push or PR deploys only the apps its files touch. Each app
  is listed as its own environment, and the jobs no longer list `preview` or `production` deploys.
- 2026-10-09: The database rebuild and roster seed move to their own `database` job, so the team app no longer waits
  for the website.
- 2026-10-10: The team app deploys to production from `release` at team.batterseacougars.com; PRs check it; health reads
  D1; rollback through `rollback.yml` (#27).
- 2026-10-10: Actions pinned by SHA, the Bitwarden CLI checksummed, least-privilege permissions, Dependabot; `main`
  and `release` protected from force-push and deletion (#70, #71).
- 2026-10-10: Production deployed before launch, behind Cloudflare Access (admins and CI's service token only).
- 2026-10-17: Production never builds with demo content; the `production` environment's `DEMO_CONTENT` variable is
  gone. Getting ready for launch, its placeholder photos and sample players must not ship.
