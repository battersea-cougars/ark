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
   an announcement a megaphone button, opening "Post to the locker room" over Home.
2. **The locker room** (a small label over it): the club's announcements, compact (icon, title, a line, Got it on
   the right), then **what you owe** as its last notice ("£58 to pay", "Your tab · 3 nights", the £ in red) with
   Settle up where Got it sits, opening your tab: no Got it, it stays while you owe anything and is gone at £0. Then
   "Everything from the locker room", Home's page of past announcements ([0107](0107-announcements.md)).
3. **The lead: your next thing, whatever it is** (`lib/home-feed.ts` `leadOf`), one card with its action: a
   training night (its card with In and Out, the locker room's quip, your team along its foot once the teams are
   out; "Are you in this Friday?", "next Friday" or its date when it's further off), your next match in a tournament
   you're on a team in once its fixtures are out ("Your next Kumite match": the training night's card, its date block,
   the type's icon, the place, with the match's time, On now while it's played, and you v them with crests and which
   game in place of In and Out; the whole card opens the match, its live page while it's on, with no button), a draft you're a captain in (on now with picks to make, or its day; Make
   your pick), or a tournament or social you're in or may sign up for now ("Are you in for the Kumite?", its card).
   The soonest leads (a fight's time is its kick-off on the day, in London); at the same moment a fight, then a
   draft, then the schedule's order. What you've said you're out of leads only when nothing else is yours; a
   cancelled one, one with no day yet, one with nothing to answer, or one that's over never does. The lead picked
   when you opened Home stays for the visit while it's still on, so answering Out doesn't swap it under your thumb.
4. **The feed** (`lib/home-feed.ts`), light rows (an icon or a date, a line, a sub-line, a chevron):
   - **What needs you now**, your move first: an open draft, the draft being on, the teams being out (not once you've a fight
     coming: that says it), a captain's
     draft day, a sign-up closing for a tournament not asked about up top.
   - **Coming up**, in date order, each with its date on the left as the lead card shows it (`lib/DateBlock`: Fri / 30 / Oct stacked, a size
     down; Summer / TBC / 2027 with no day yet): each
     training's next session and each tournament series' next one (however far off), and the club's events in the
     next six weeks; at most seven, then "See the calendar". The lead isn't repeated (for a fight, its tournament):
     with a Friday leading, the Friday row is the one after it. The sub-line says the time and where you stand, when
     sign-up opens, or when your fight is.
   - The store app's notification ask ([0108](0108-store-apps.md)), dismissible.
   - **For admins**, at the foot under a quiet label, only for whoever they're for: running the draft, and what the
     club is owed (opening Unpaid fees).

## Consequences

- The first screen of a phone is the greeting, any announcement and the lead (your next thing); under it, a short feed of what's
  next.
- What you owe is always on Home while you owe something: the locker room's last notice, no longer only after 60
  days ([0007](0007-dues-and-payments.md)). What the club is owed is an admin's, at the foot.
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
- 2026-10-21: Every date on Home is the lead card's stacked block (day, number, month; `lib/DateBlock`, shared with
  EventCard), a size down in the rows, in one fixed column that icon rows share, so every row's words line up. A
  draft night or a sign-up's last day shows its block in place of the icon. With no day yet the block keeps its
  shape: the season, TBC, the year (the card's own too). "Can the format of the dates be consistent?"
- 2026-10-21: The announcements block is called the locker room (the quips are already "the locker room's word"),
  and what you owe moved into it, its last notice with Settle up, out of the feed: "the amount the person owes is kind
  of in the middle of nowhere". Code and data keep "announcement"; only the words people see changed.
- 2026-10-21: Your next fight (a tournament you're on a team in, its fixtures out) is a call to action after the
  sign-ups, the same line the tournament's front page leads with, and it replaces "The teams are out" for you: "show
  my upcoming games for kumite on home".
- 2026-10-22: One lead instead of a stack of calls to action: "the next event should be the main call to action. So
  if there's a Kumite and I have a game, the main card should be that. Basically whatever the next event. The coming
  up will show the next events after that." Friday's card is no longer always there: it leads when it's your next
  thing, else it's a row in what's coming up; a tournament asking and your next fight are the lead when they're
  soonest, else rows ("Are you in?", "Your fight at 10:17am"). A captain's draft can lead too, and isn't then a row in
  what needs you now.
- 2026-10-22: Your next match's lead is the training night's card (`EventCard` with a `body` in place of In and
  Out): the same date block, frame, sheen and place link, the type's icon, the match's time (On now, and a red Live
  before the game's number, while it's played), you v them with crests, yours in red. The whole card opens the match;
  See the matchup and the grey Up next pill went ("whats the yellow button for??", "follow the pattern of the friday
  card ... the only difference should be the icon and the copy").
