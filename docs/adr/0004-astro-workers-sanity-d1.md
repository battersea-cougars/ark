# 0004. The website: Astro on a Cloudflare Worker, club facts in Sanity rebuilt daily, the club's data from D1

- **Status:** Accepted
- **Date:** 2026-10-05 (decided at project start) · updated 2026-11-02
- **Merges:** 0014, 0018, 0020, 0109, 0112, 0132

## Context

We copy the architecture of gwenda-hackney/ark, simplified. The club needs a fast promo site that a non-developer can
edit, plus a little server logic (the join form, live photos and videos), and a team app that records the schedule,
the roster and the Kumite. Two copies of any fact, one in Sanity and one in D1, would drift.

Most pages are built ahead of time, so a Studio change only reaches the live site when production rebuilds. Rebuilding
on every publish would need a Sanity webhook calling GitHub, with a GitHub token stored in Sanity and renewed yearly.

## Decision

**The stack**

- **Astro** with `@astrojs/cloudflare`, deployed as a **Cloudflare Worker with static assets**, not Pages: one Worker
  serves the prerendered pages and the few server routes (`prerender = false`) together. Server routes run in workerd,
  so Node-only libraries don't work there.
- **D1** holds operational data, in plain SQL through `packages/shared/d1.ts`, no ORM
  ([ADR 0050](0050-schema-and-seed-until-launch.md)).
- **Share pictures are drawn at build time**: every page's `og:image` is a 1200×630 card from facts the site already
  shows (`lib/og.ts`, `satori` and `sharp`, only in the build, never in the Worker); a page with its own photo shares
  that instead.
- **Page views are counted by Cloudflare Web Analytics**, free and cookieless, from a beacon in the website's own
  layout on production's pages only (its public token in `deploy.yml`); automatic setup is off, so the team app,
  whose CSP refuses the script, carries none.

**Who owns which content**

- **Sanity (free plan) holds what the team manager edits: club facts**, one small singleton each with a fixed `_id`
  (Club, Fridays, Pub, Team, Kumite), and videos and past events. All other wording (headlines, jokes, page intros)
  lives in the website's code, where it changes with the design.
- **What the team app runs comes from D1**: the schedule and What's on, the roster, the Kumite's awards and tournament
  results ([ADR 0016](0016-how-the-website-gets-its-data.md)). Ops-only data (enquiries, attendance, payments, ratings)
  lives in D1 and is never shown publicly as it is.
- **The site builds without Sanity**: each singleton merges with its defaults in `src/lib/sanity/fallback.ts`, field
  by field ([ADR 0134](0134-a-fresh-clone-runs-after-npm-install.md)).
- **Until launch, the repo owns the words**: every website deploy sends `fallback.ts`'s words to its environment's
  Sanity before the build (`scripts/sanity-copy.mjs`), so a copy change is a commit. At launch the step leaves
  `deploy.yml` and the Studio owns them.
- **Parts of the site are switches in the Studio** (the team, the Kumite): `getSections()` in `lib/sanity/content.ts`
  is the one place pages ask, and an off section's page isn't built (rest routes, `[...page].astro`, so
  `getStaticPaths` can leave it out). What each switch does is in [the website notes](../../apps/web/src/README.md).
- **The team app may write public content to Sanity through its API**, with a write token per project; schemas avoid
  anything that would block an API write.

**The Studio**

- **A Worker of its own, `studio`**, static assets only (`apps/studio/wrangler.jsonc`), at studio.batterseacougars.com
  from `release` and `studio.cougars-dev.workers.dev` from `main`. Sanity's own sign-in guards it, not Cloudflare
  Access; each project allows its Studio's origin by CORS, set by hand once. The schema still goes to Sanity from
  `release` (`sanity schemas deploy`).

**When changes go live**

- **Production rebuilds daily** (the `schedule` in `deploy.yml`) and on every release
  ([ADR 0010](0010-environments-and-deploys.md)), so a Studio change is live the next morning.
- **Anything urgent, the editor puts live themselves**: the Studio's Put changes live tab links to the team app's
  Settings → Website, whose Rebuild now (`edit:Content`) starts the same rebuild a tournament result does, as the
  club's GitHub App running `deploy.yml` ([ADR 0016](0016-how-the-website-gets-its-data.md)).
- **No Sanity publish webhook**: it would need a signing secret and a check of Sanity's free plan; it can come later
  through the same `wantRebuild`.
- Photos and videos don't wait for a rebuild: they're read live ([ADR 0016](0016-how-the-website-gets-its-data.md)).

## Consequences

- The team manager edits facts, not prose: fewer ways to break the design. The Studio's required fields and the
  website's list of optional fields (`merge.ts`) must be kept in step.
- No GitHub token in Sanity and none in the Studio, nothing to renew yearly. The daily rebuild matters: if it fails,
  Studio changes don't go live.
- A content change takes a rebuild (about five minutes); pressing Rebuild now while one is building starts no second.
- Share cards cost about a second of build per ten cards; the TTF copies of the fonts satori needs must stay in step
  with the WOFF2 files.
- One more Worker to deploy for the Studio, files only.
- Dev, PR previews and a laptop count no page views.
