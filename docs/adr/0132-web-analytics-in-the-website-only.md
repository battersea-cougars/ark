# 0132. Cloudflare Web Analytics counts the website's pages from a beacon in its own layout, never the team app's

- **Status:** Accepted
- **Date:** 2026-10-24

## Context

The website counts page views with Cloudflare Web Analytics: free, no cookies, nothing to ask visitors (the privacy
page says so). It was set up with automatic setup, where Cloudflare adds its beacon to every HTML page on the zone.
That includes `team.batterseacougars.com`, whose content security policy refuses the script, so members' browsers
logged a CSP error on every page and nothing was counted there anyway (#92). A rule excluding a hostname from automatic
setup needs a paid plan ([ADR 0003](0003-free-tiers-only.md)). Web Analytics' API refuses the account tokens we use.

## Decision

- **The beacon is in the website's layout** (`apps/web/src/layouts/Base.astro`, `lib/analytics.ts`), on production's
  pages only, with the site's token, which is public (it's in every page): `WEB_ANALYTICS_TOKEN` in `deploy.yml`, not a
  secret. No token, no beacon; a token that isn't hex is left out.
- **Automatic setup is off** for the site, once the token is in, so nothing reaches the team app and no page counts
  twice (docs/setup.md, Web Analytics: by hand, as its API can't be used).
- The website's CSP allows the script (`static.cloudflareinsights.com`) and its reports (`cloudflareinsights.com`)
  ([ADR 0036](0036-api-security.md)); the team app's doesn't, and doesn't need to.

## Consequences

- The team app's pages carry no beacon and log no CSP errors; the website's page views are counted as before.
- Dev, PR previews and a laptop count nothing.
- The token is copied by hand from the dashboard; if the site is ever made again there, it changes in `deploy.yml`.

## History

- 2026-10-24: Decided (#92), after automatic setup put the beacon on the team app's pages too.
