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
   the title sits on every page's line, [0065](0065-page-frame-and-admin-actions.md)). On its right, a **Calendar**
   button (a phone's tabs have the Club in its place, [0022](0022-team-app-svelte-pwa.md)), and for whoever may post
   an announcement a megaphone button, opening the sheet over Home.
2. **Announcements**, compact: icon, title, a line, Got it on the right, and Past announcements, Home's own page
   ([0107](0107-announcements.md)).
3. **The calls to action**: **this Friday's card, always** (the soonest training's next session, with the locker
   room's quip, In and Out, and your team along its foot once the teams are out), answered or not, in its reserved
   room; then "Are you in for the Kumite?" for each series' next tournament that is taking sign-ups, a full card
   (EventCard). A tournament you had already answered when you opened Home is its row in what's coming up ("You're
   in") instead, so the asks still open stand out; one you answer while you're there keeps its card for the rest of
   the visit, so nothing jumps under your thumb.
4. **The feed** (`lib/home-feed.ts`), light rows (an icon or a date, a line, a sub-line, a chevron):
   - **What needs you now**, your move first: an open draft, the draft being on, the teams being out, a captain's
     draft day, a sign-up closing for a tournament not asked about up top; then **what you owe** ("£58 to pay",
     "Your tab · 3 nights", the £ the only red), opening your tab, none when you're square.
   - **Coming up**, in date order, each with its date on the left ("Fri" over "30 Oct", or "Summer 2027"): each
     training's next session and each tournament series' next one (however far off), and the club's events in the
     next six weeks; at most seven, then "See the calendar". What's a card up top isn't repeated: the Friday row is
     the one after the card's. The sub-line says the time and where you stand, or when sign-up opens.
   - The store app's notification ask ([0108](0108-store-apps.md)), dismissible.
   - **For admins**, at the foot under a quiet label, only for whoever they're for: running the draft, and what the
     club is owed (opening Unpaid fees).

## Consequences

- The first screen of a phone is the greeting, any announcement and Friday's card; under it, a short feed of what's
  next.
- What you owe is always on Home while you owe something: a row of the feed, after what's about the play, no longer
  only after 60 days ([0007](0007-dues-and-payments.md)). What the club is owed is an admin's, at the foot.
- The feed's rules are pure and tested (`lib/home-feed.test.ts`); Home only lays them out.
- Answering from a line in the feed means opening the event's page, where In and Out are.

## History

- 2026-10-21: Home reordered around the calls to action, with a feed under them and the money owed as a chip in a
  slimmer header.
- 2026-10-21: Friday's card is always on Home, answered or not, not folded to a feed row ("I want the Friday card
  back"); a tournament you'd answered still folds, now into its upcoming row. Teammates leaves the feed: the club is a
  phone tab now ([0022](0022-team-app-svelte-pwa.md)), and the Calendar a button in the header. The feed became what
  needs you now, then what's coming up in date order (capped, then See the calendar), then For admins at the foot
  ("the owed-to-club line is more for admins"). What you owe left the header for a row in the feed ("awkwardly
  placed, just make it part of the member's feed"). Past announcements are Home's page.
