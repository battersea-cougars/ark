# 0118. Home: a slim hello, announcements, the calls to action, then a feed

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Home had grown a block at a time: a poster-sized greeting that filled the top of a phone, announcements, the store
app's notification ask, Friday's card, a titled "For you" list (with what you owe in it once it was over 60 days),
Teammates, and the next of each tournament series as another big card at the bottom. The user found it muddled: the
point of Home is the calls to action (are you in this Friday, are you in for the Kumite), with announcements up top,
and what you owe somewhere small, not in the feed. The rest is "more or less a feed of info".

## Decision

Home is, from the top (`apps/team/src/pages/Home.svelte`):

1. **A slim hello**: one line of greeting (the display face, not a poster; the kicker above it on a desktop only, so
   the title sits on every page's line, [0065](0065-page-frame-and-admin-actions.md)). On its right, **what you
   owe** as a quiet chip ("£24 to pay", its pound the only red, no fill colour), opening your tab; there's nothing
   when you're square. Whoever may post an announcement has a megaphone button beside it, opening the sheet over
   Home.
2. **Announcements**, compact: icon, title, a line, Got it on the right
   ([0107](0107-announcements.md)).
3. **The calls to action**: "Are you in this Friday?" (the soonest training's next session, with the locker room's
   quip), then "Are you in for the Kumite?" for each series' next tournament that is taking sign-ups, both full
   cards with In and Out (EventCard). A call you had already answered when you opened Home is a line in the feed
   instead ("You're in · Friday Training"), so the asks still open stand out; one you answer while you're there keeps
   its card for the rest of the visit, so nothing jumps under your thumb.
4. **The feed**: one stream of light rows (an icon, a line, a sub-line, a chevron when it opens something), no
   section titles. In order: where you stand on what you've answered; what's for you, your move first
   (`lib/home-feed.ts`: an open draft, a captain's draft day, a sign-up closing for a tournament not asked about up
   top, the draft being on, the teams being out, and what the club is owed for whoever sees Unpaid fees); the other
   trainings' next sessions; tournaments not yet taking sign-ups, teased; the store app's notification ask
   ([0108](0108-store-apps.md)), dismissible; and Teammates, last, a quiet row on the page itself.

## Consequences

- The first screen of a phone is the greeting, any announcement and Friday's card; a member who's answered sees a
  short page of lines.
- What you owe is always on Home while you owe something, but small: no longer only after 60 days, and never as a
  row in the feed ([0007](0007-dues-and-payments.md)).
- The feed's rules are pure and tested (`lib/home-feed.test.ts`); Home only lays them out.
- Answering from a line in the feed means opening the event's page, where In and Out are.

## History

- 2026-10-21: Home reordered around the calls to action, with a feed under them and the money owed as a chip in a
  slimmer header.
