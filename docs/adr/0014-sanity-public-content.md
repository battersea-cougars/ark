# 0014. Sanity holds the site's editable content; only club facts are editable

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-20
- **Builds on:** [0004](0004-astro-workers-sanity-d1.md)

## Context

The team manager should run the site from the Studio without a developer, and a team app (`apps/ops`) is coming
that will record Kumite results, events and the roster. The single `siteSettings` document mixed club facts
(times, venue, kit, fees) with page wording (headlines, the "about" text), kept Kumite winners as an ordered list
inside it ("the first one is the reigning champion"), and some of its facts had never been checked. Two copies of
any fact, one in Sanity and one in D1, would drift.

## Decision

- **Sanity holds what the team manager edits**: club facts, videos and past events (photos are the club's Instagram,
  [ADR 0113](0113-photos-from-instagram.md)). The site reads it at build
  time ([ADR 0004](0004-astro-workers-sanity-d1.md)), or live for videos
  ([ADR 0016](0016-photos-and-videos-read-live.md)). What the team app runs comes from D1 instead: the schedule and
  What's on ([ADR 0042](0042-website-reads-the-club-agenda.md)), the roster ([ADR 0043](0043-roster-and-names.md))
  the Kumite's awards ([ADR 0044](0044-champions-and-awards.md)) and tournament results
  ([ADR 0100](0100-website-reads-tournament-results.md)).
- **Only club facts are editable**, one small singleton each, in the club's own terms: **Club** (founded, contact
  email, socials, YouTube channel ID), **Fridays** (sessions, venue, kit rules, first-timers' kit, fees), **Pub**,
  **Team** and **Kumite**. Singletons have fixed `_id`s equal to their type. All other wording (headlines, jokes,
  page intros) lives in the website code, where it can change with the design.
- **Copy that depends on a fact reads the fact.** For example the "we lend you the kit" lines appear only while
  _Kit for first-timers_ is filled in.
- **Tournament results aren't in Sanity**: the team app records them in D1 and the website reads them live
  ([ADR 0100](0100-website-reads-tournament-results.md)).
- **The team app may write public content to Sanity through its API** (club facts, roster cards; #53),
  with a write token per project ([ADR 0010](0010-environments-and-deploys.md)) documented in the README when it lands. Schemas avoid anything that would block an API write
  (read-only fields, values only the Studio can make).
- **Ops-only data lives in D1**: enquiries, attendance, payments, ratings. It is never shown publicly as is.
- **Fallbacks.** Each singleton merges with its own defaults (`apps/web/src/lib/sanity/fallback.ts`) field by
  field: a missing required field falls back; an optional field left empty stays empty.

## Consequences

- The team manager edits facts, not prose: fewer ways to break the design, and anything else is a code change.
- Facts live in one place. A Studio change reaches the prerendered pages at the daily rebuild
  ([ADR 0004](0004-astro-workers-sanity-d1.md)).
- The Studio's required fields and the website's list of optional fields (`merge.ts`) must be kept in step.
- Moving off `siteSettings` needs a one-off migration per dataset (`apps/studio/migrate-settings.ts`).

## History

- 2026-10-05: Sanity is the source for public content; only club facts are editable.
- 2026-10-05: One Sanity project per environment, so a dev token can't touch live content (was 0017, now in 0010).
- 2026-10-06: Events left Sanity for D1; the website reads the club's agenda live (was 0025, now 0030 and 0042).
- 2026-10-07: The roster and the Kumite's awards come from the team app's data, not Sanity (0043, 0044).
- 2026-10-09: Kumite results left Sanity: `kumiteResult` retired, the website reads results from D1 (0100).
- 2026-10-18: Events, Players and Videos are off the Studio's sidebar and its "New document" menu: the first two are
  the team app's data, and videos come from the YouTube playlists. The types stay so the website's queries still read.
- 2026-10-20: The `album` type is gone: the website's photos are the club's Instagram ([ADR 0113](0113-photos-from-instagram.md)).
