# 0004. Astro on Cloudflare Workers, content in Sanity rebuilt daily, data in D1

- **Status:** Accepted
- **Date:** 2026-10-05 (decided at project start) · updated 2026-10-09
- **Merges:** 0018

## Context

We copy the architecture of gwenda-hackney/ark, simplified. The club needs a fast promo site that a non-developer
can edit, plus a small amount of server logic (the join form now; attendance, payments and Kumite scoring later).

Most pages are built ahead of time from Sanity, so a Studio change only reaches the live site when production
rebuilds. Rebuilding on every publish would need a Sanity webhook calling GitHub, with a GitHub token
(`SANITY_WEBHOOK_GITHUB_TOKEN__PRODUCTION`) stored in Sanity and renewed yearly. Gwenda solves the same problem
differently: editors work in its ops app, which asks a small Worker to start the GitHub build, batched after ten
quiet minutes, with the GitHub token held by that Worker. The Cougars team app is where the team manager will
eventually edit events, players and Kumite results, so it's the natural owner of this trigger too.

## Decision

- **Astro** with `@astrojs/cloudflare`, deployed as a **Cloudflare Worker with static assets**, not Pages:
  Cloudflare now steers new projects to Workers, and one Worker serves prerendered pages and the few server routes
  (`prerender = false`) together.
- **Sanity** (free plan) holds editable content. The site reads it at build time. The site still builds without
  Sanity, from `src/lib/sanity/fallback.ts`.
- **Production rebuilds daily** (the `schedule` in `deploy.yml`, some time after 04:37 UTC) and on every release
  ([ADR 0010](0010-environments-and-deploys.md)). A Studio change is live the next morning. Anything urgent is rebuilt
  by hand: **Actions → Deploy → Run workflow → `release`** (or `gh workflow run deploy.yml --ref release`).
- **No Sanity publish webhook.** The team app starts rebuilds when a tournament result changes, batched, as the
  club's GitHub App (running `deploy.yml` for the website, [ADR 0100](0100-website-reads-tournament-results.md)).
- Photos and videos don't wait for a rebuild: they're read live ([ADR 0016](0016-photos-and-videos-read-live.md)).
- **D1** holds operational data. Plain SQL through `packages/shared/d1.ts`, no ORM. Until launch the database is
  `db/schema.sql` plus seed, with no migrations ([ADR 0050](0050-schema-and-seed-until-launch.md)).

## Consequences

- Content changes need a rebuild (about 2 minutes), and the team manager waits until the next morning to see Studio
  changes (the editor guide says so), or asks the developer for a rebuild.
- No GitHub token in Sanity, and nothing to renew yearly.
- The daily rebuild matters for content as well as YouTube uploads; if it fails, Studio changes don't go live.
- Server routes run in workerd, so Node-only libraries don't work there. Editors only ever touch the Studio.
- The team app picks up the rebuild trigger and its token later.

## History

- 2026-10-05: Astro on a Worker with static assets, Sanity read at build time with a publish triggering a rebuild,
  D1 with additive migrations (0004).
- 2026-10-05: No Sanity publish webhook; production rebuilds daily and on release until the team app triggers builds
  (0018).
- 2026-10-07: Migrations replaced by schema plus seed until launch (ADR 0050).
- 2026-10-09: The team app's rebuild trigger exists: `website-rebuild`, from its GitHub App, for dev and production
  (0100); the unused `sanity-publish` trigger is gone.
