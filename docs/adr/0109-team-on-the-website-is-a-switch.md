# 0109. The team's place on the website is a switch in the Studio, off until the team manager turns it on

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

The website is going to production before the official team's page is ready: no team photo, and a roster the club
isn't ready to show. Deleting the page would mean a developer putting it back later; the team manager should be able to
bring it back from the Studio ([ADR 0014](0014-sanity-public-content.md)).

## Decision

- The Team singleton has **Show on the website** (`onWebsite`). Unset, the website treats it as off
  (`FALLBACK_TEAM`).
- Off, the team isn't on the website at all: no `/team/` page (it isn't built, so the address is a 404 and out of the
  sitemap), no "Final whistle" section on the home page, no menu link, no share card, and the privacy page doesn't
  mention the team page. The club's league stays among the home page's quick facts: it's a fact about the club.
- On, all of it comes back as it was. Like every Studio change, it shows after the next build (a deploy, or the daily
  rebuild, [ADR 0004](0004-astro-workers-sanity-d1.md)).

## Consequences

- Bringing the team back is a tick in the Studio, not a code change.
- `/team/` is a rest route (`pages/team/[...page].astro`) only so that `getStaticPaths` can leave it out.
- The roster snapshot is still taken each build ([ADR 0043](0043-roster-and-names.md)); it just isn't shown.

## History

- 2026-10-17: Decided, to launch the website with the team section hidden.
