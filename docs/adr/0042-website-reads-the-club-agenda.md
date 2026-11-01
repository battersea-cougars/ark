# 0042. The website's What's on and events page read one club agenda, live

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-22
- **Merges:** 0045, 0062

## Context

The club calendar lives in D1 and is kept in the team app
([ADR 0030](0030-training-and-tournament-schedule.md)): training sessions, tournaments and one-off events. Dates
change too often for a rebuild. The website's home page and `/events` had read Sanity events as of the last build,
so they went empty or out of date once the calendar moved to the app.

What's on and when was also worked out twice, with different rules: the website's own SQL and the team app's
calendar and Home (in the browser). They disagreed on what's public, finished tournaments, paused trainings and
cut-off times, and neither showed a tournament's draft night or sign-up deadline.

## Decision

- **One `agenda` table**: one row per thing on a day (a training session, a tournament's day, its draft night, its
  sign-up deadline, a one-off event), with its time, place, TBC or season, public, cancelled, and who it's for
  (`everyone` or `captains`).
- **Every change pushes its own rows** (`packages/shared/agenda.ts`): a training's sessions when the series or a session
  changes, a tournament's when it or its series changes or its draft opens or closes, an event's when it changes; all
  of them when a venue changes. The rules (own place else the series', seasons, finished tournaments off) live
  there, once. An empty agenda (a rebuilt database) fills itself on the first read.
- **The home page's What's on** (`components/WhatsOn.astro`, `lib/server/whats-on.ts`) shows the next 3 training
  sessions, the next 3 tournaments (each by its own name, never "Tournament") and the next 4 one-off events, in date
  order. The home page stays prerendered with a placeholder; its script swaps in `/whats-on/`, rendered live on the
  Worker.
- **`/events`** is rendered live (`prerender = false`) with the same component: the next 4 training sessions (they're
  every week) and every public tournament and one-off event. Past events with their own pages (`/events/<slug>`)
  still come from Sanity, listed below, as does the Kumite page's poster, until they move over.
- Only public rows reach the website: a training series' and a tournament's `public`, and an event's _Show on the
  website_, on by default. Cancelled ones stay listed, marked, so nobody turns up to nothing.
- Reads are cached like every live read: fresh a minute, the last good copy kept an hour
  ([ADR 0053](0053-live-reads-are-cached.md)).
- The team app's bootstrap gets an `agenda` part from today; a draft night only for that tournament's captains and
  those running the draft. A change to anything on the calendar replies with the agenda too
  ([ADR 0057](0057-team-app-loading-and-changes.md)), and live pages read it again; a change that can't move
  anything on it, though its part is on the calendar (an answer, a draft pick or the draw, anything while a game is
  scored), says so on its route (`calendar: false`, `api.route.ts`), and the agenda isn't read for it.
- In the team app a one-off event (`club_events`) has a title, date, start and end, location, a short description,
  _Show on the website_ and _Members say in or out_. People with `update:Event` edit it and cancel or restore it.

## Consequences

- The website and the app can't disagree about what's on, and the home page and `/events` always agree. A change in
  the app is on the website within a minute: no publish, no rebuild.
- A new kind of dated thing is a new `kind` and one sync function.
- A write path that forgets to push leaves the agenda stale: each one is covered by a use-case test.
- Without JavaScript the home section shows only a link to all events. If D1 fails, `/events` says the calendar
  didn't load, points to Fridays, and still shows past events.
- Future training sessions exist only once the team app has made them, 12 weeks ahead, when it loads. There is no
  Cron Trigger for it, so the website shows Fridays as long as someone opens the app every few months.
- Two calendars until the rest moves over: past event pages and the Kumite poster still come from Sanity `event`
  documents (to import once, then retire the type).

## History

- 2026-10-07: The home page's What's on reads the club calendar in D1 live; one-off events gain a description,
  an end, a website switch and cancelling (was 0042).
- 2026-10-07: `/events` reads the same calendar live, with past Sanity events below (was 0045).
- 2026-10-07: One `agenda` table that every change pushes to replaces the website's and the app's separate rules
  (was 0062).
- 2026-10-07: Caches run everywhere, not only in production ([ADR 0053](0053-live-reads-are-cached.md)).
- 2026-10-21: Answers, picks and scoring no longer bring the agenda with them (`calendar: false`): they never push to
  it, and every live phone read it again for each (about 35 rows a read on a draft night; docs/load-testing.md).
- 2026-10-22: The agenda also answers what clashes with a new time, before an editor saves it
  ([0122](0122-asked-about-clashes.md)).
