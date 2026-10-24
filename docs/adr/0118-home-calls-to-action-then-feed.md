# 0118. Home: a slim hello, announcements, the calls to action, then a feed

- **Status:** Accepted
- **Date:** 2026-10-21 · updated 2026-10-23

## Context

Home had grown a block at a time: a poster-sized greeting that filled the top of a phone, announcements, the store
app's notification ask, Friday's card, a titled "For you" list (with what you owe in it once it was over 60 days),
Teammates, and the next of each tournament series as another big card at the bottom. The user found it muddled: the
point of Home is the calls to action (are you in this Friday, are you in for the Kumite), with announcements up top,
and what you owe somewhere small, not in the feed. The rest is "more or less a feed of info".

## Decision

**Home is a feed, and its hero is the club's next event; your part in it is shown on the card.** Later work on Home
follows this order and doesn't add strips, stacks of calls to action or blocks above the hero. From the top
(`apps/team/src/pages/Home.svelte`, the ordering in `lib/home-feed.ts`, tested):

1. **A slim hello**: one line of greeting (the display face, not a poster; the kicker above it on a desktop only, so
   the title sits on every page's line, [0065](0065-page-frame-and-admin-actions.md)). On its right a **Calendar**
   button (a phone's tabs have the Club in its place, [0022](0022-team-app-svelte-pwa.md)), a megaphone for whoever may
   post an announcement, and, **while you owe something overdue, the pound with a small red dot** (as a phone marks
   something waiting; an "!" read as an error), opening your tab. Overdue is what's left on a charge whose day has passed (`lib/dues.ts`
   `overdue`; a night is due on the night, so paying on it is never late). Nothing when nothing's overdue. Not a strip.
2. **The locker room**: the club's announcements only (compact: icon, title, a line, Got it on the right), then
   "Everything from the locker room" ([0107](0107-announcements.md)). The top strip is for announcements, nothing else.
3. **The hero: the club's next event, whatever it is** (`leadOf`), as the Friday card (`EventCard`) for every kind:
   only the icon and the words differ. Your part in it is on the card:
   - **playing in it** (a tournament you're on a team in, its fixtures out): your next match stands in for it ("Your
     next Kumite match": its time, On now while it's played, you v them with crests, which game; the card opens the
     match);
   - **in, waiting, or may sign up**: In and Out ("Are you in this Friday?", "Are you in for the Kumite?"; a training
     night with the locker room's quip and your team along its foot once the teams are out);
   - **not in it** (the Kumite you didn't sign up for, its sign-up closed): it still leads, said plainly ("The
     Kumite's this Friday"), the card's day, time and place, and **You're out** where In and Out would be; no pitch,
     no extra button. The card opens the tournament (its Fight Card once the matches are out). A social with no
     sign-up leads the same way, without the badge;
   - a **draft you're a captain in** (on now with picks to make, or its day): Make your pick.

   The soonest leads (a match's time is its kick-off on the day, in London); at the same moment a match, then a draft,
   then the schedule's order. A cancelled night (Friday's training off for the Kumite), one with no day yet, or one
   that's over never leads. One you said you're out of leads like any other when it's soonest: its card shows your
   Out, and In is still there to change your mind. The hero picked when you opened Home stays for the visit while
   it's still on, so nothing swaps under your thumb.

4. **Coming up**: the next things after the hero, never repeating it (for a match, its tournament), in date order,
   each with its date on the left (`lib/DateBlock`; Summer / TBC / 2027 with no day yet): each training's next
   session (a cancelled one says Cancelled, and the one after it shows too), each tournament series' next one however
   far off, the club's events in the next six weeks; at most seven, then "See the calendar". The calendar's reminders
   (a draft night, a sign-up's last day) aren't events here. Each says where you stand
   (You're in, You're out, You're on the waitlist), else how its sign-up stands: **"Are you in?" only when you can
   answer now** (its sign-up open, by the same rules as its own page, `lib/signup.ts`; a full one counts, In joins the
   waitlist), else "Sign-up opens Mon" / "Sign-up opens 1 May", "Sign-up closed", or just where (a social with no
   sign-up). The hero's heading asks only then too ("This Friday" before Monday's opening).

5. **What needs you**: your move first (an open draft, the draft being on, the teams being out unless you've a match
   coming, a captain's draft day, a sign-up closing for a tournament not already asked about), then the store app's
   notification ask ([0108](0108-store-apps.md)).
6. **For admins**, under a quiet label, only for whoever they're for: running the draft, someone asking to join
   (named if it's one, opening The club, for whoever lets members in), what the club is owed.
7. **Your tab**, at the foot while you owe anything: "£58 to pay", "Your tab · 3 nights · £16 overdue", Settle up
   opening your tab ([0007](0007-dues-and-payments.md)).

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
- 2026-10-22: Home is a feed and the hero is the club's next event, whoever you are, your part in it shown on the
  card: "The pattern is that home is a feed. The next event is the hero essentially. Coming up should show the next
  thing. Then under that should be more admin stuff. I don't like that on top of the page we use a whole strip for
  how much to pay. Maybe let's use a loud icon in the header for overdue, then push how much people owe to the bottom.
  The top strip can still be for announcements." And, on a member not in the Kumite that Friday: "the feed should be
  the next club event. For a non-kumite member, it should just say that Kumite is this Friday. They are out." (Was:
  your next thing, so with the Kumite's sign-up closed a member not in it got next week's training up top.) What you
  owe left the locker room for the foot of Home, with an overdue icon in the hello; a cancelled night no longer
  hides the series' next one in Coming up; the calendar's reminders stopped showing there as events.
- 2026-10-22: A night you said you're out of is the hero when it's the club's next, showing your Out (In still there),
  not stepping aside for your next thing: the hero is always the club's next event (was: Out led only with nothing
  else coming).
- 2026-10-22: Home asks "Are you in?" only when you can answer: "these teaser cards should respect if the signup for
  that event is open. Don't ask 'are you in' if they can't answer." Before a night's or tournament's sign-up opens the
  row says when it opens, after it closes "Sign-up closed"; a night still to open is yours, not one you're out of.
- 2026-10-22: The overdue icon is the pound with a small red dot, not a red pound with an "!" badge: "the exclamation
  for the payment is maybe too loud. Looks like an error."
- 2026-10-22: A captain's draft leads as the same card as the rest ("why does this not look like the standard
  card?"): the tournament's name with the draft's icon, the draft's day and time (On now once it's open), "Draft ·
  You pick 1st" where In and Out would be, the whole card opening the draft; Make your pick inside it only while it's
  your pick. No loose button under it.
- 2026-10-23: Someone asking to join is a line For admins (whoever lets members in, manage:Member): "Jo Bloggs is
  asking to join", or how many, opening The club where Approve is. Only The club had said so.
