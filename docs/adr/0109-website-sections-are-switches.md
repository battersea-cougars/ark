# 0109. The team and the Kumite are switches in the Studio, off until the team manager turns them on

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

The website went to production before the official team's page was ready (no team photo, a roster the club isn't
ready to show), and for a while with no Kumite scheduled. Deleting those parts would mean a developer putting
them back later; the team manager should be able to bring them back from the Studio
([ADR 0014](0014-sanity-public-content.md)).

## Decision

- The Team and Kumite singletons each have **Show on the website** (`onWebsite`). Unset, the website treats it as off
  (`FALLBACK_TEAM`, `FALLBACK_KUMITE`). `getSections()` in `lib/sanity/content.ts` is the one place pages ask.
- Off, that part isn't on the website at all: its page isn't built (so the address is a 404 and out of the sitemap),
  and there's no home page section, menu link or share card. The team off also takes the team page out of the
  privacy page; the Kumite off takes the Kumite out of the Fridays, 404, events, photos and videos wording.
- `/results/` is built while the Kumite is on or there are results; a result's own page whenever it exists.
- The club's league stays among the home page's quick facts: it's a fact about the club.
- What's on reads the club's agenda live ([ADR 0042](0042-website-reads-the-club-agenda.md)) and isn't switched: a
  public tournament or social an admin schedules shows there, Kumite switch or not.
- On, everything comes back as it was. Like every Studio change, it shows after the next build (a deploy, or the
  daily rebuild, [ADR 0004](0004-astro-workers-sanity-d1.md)).

## Consequences

- Bringing a part back is a tick in the Studio, not a code change.
- `/team/`, `/kumite/` and `/results/` are rest routes (`[...page].astro`) only so that `getStaticPaths` can leave them
  out.
- The roster and Kumite snapshots are still taken each build ([ADR 0043](0043-roster-and-names.md)); they just
  aren't shown.

## History

- 2026-10-17: Decided, to launch the website with the team section hidden.
- 2026-10-17: The Kumite too, and the results with it: launch is Friday sessions only. The club seed no longer
  schedules a Kumite.
- 2026-10-17: The Kumite is switched back on in production's Studio: only the fake Kumite (the seed's) was meant to
  go, and it's deleted from the database. The team stays off.
