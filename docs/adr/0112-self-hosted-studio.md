# 0112. The Studio is self-hosted on its own Worker, at studio.batterseacougars.com

- **Status:** Accepted
- **Date:** 2026-10-18

## Context

The Studio was hosted by Sanity at `battersea-cougars.sanity.studio`: free, but a technical address to give the club's
editors. A Studio hosted on `*.sanity.studio` can't take a custom domain on the free plan. The Studio is a static app
(`sanity build`), so anything that serves files can host it; Cloudflare already serves the website and the team app,
and static assets are free and unlimited (ADR 0003).

## Decision

- **A third Worker, `studio`**, static assets only (`apps/studio/wrangler.jsonc`), every unknown path answered with
  `index.html` (the Studio routes in the browser). No code of ours runs on it.
- **Production** deploys from `release` to **studio.batterseacougars.com** (a Workers custom domain), with no workers.dev
  address. **Dev** deploys from `main` to `studio.cougars-dev.workers.dev`, editing Cougars Dev.
- **Sanity's own sign-in guards it**, not Cloudflare Access: editors sign in with their Sanity account as before, and
  Access would put a second sign-in in front of people who aren't on the admins list.
- **CORS:** each project allows its Studio's origin with credentials (`docs/setup.md`), added by hand once: the deploy
  token can't manage CORS.
- **The schema** still goes to Sanity from `release` (`sanity schemas deploy`, `SANITY_DEPLOY_TOKEN__PRODUCTION`), so
  Sanity's own tools know the fields.
- `autoUpdates` stays on: the Studio loads Sanity's latest compatible code from its CDN, wherever it's hosted.
- The old `battersea-cougars.sanity.studio` is undeployed once the new address is proven, so there's one Studio.

## Consequences

- Editors get an address that says what it is. Nothing changes in who can edit (Sanity members, ADR 0014).
- One more Worker to deploy, but it's files only: no requests counted, nothing to break at runtime.
- Sanity's manage page no longer lists the Studio as hosted by Sanity; its link is ours.

## History

- 2026-10-18: Moved off `battersea-cougars.sanity.studio` to the `studio` Worker; a dev Studio from `main` too.
