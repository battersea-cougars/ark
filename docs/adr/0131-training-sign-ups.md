# 0131. A training's sign-ups are one order, Quarterly Members first; keepers have their own places; nights open on a day

- **Status:** Accepted
- **Date:** 2026-10-10 · updated 2026-10-24

## Context

A training night has a limit on places, and the club's rule is that members on the Quarterly plan
([0007](0007-dues-and-payments.md)) come before those paying as they go. Keepers aren't skaters: they shouldn't take a
skater's place, nor wait because the skaters are full. And members want to know when a night's sign-up opens. The
schedule itself (series and sessions) is [0030](0030-training-and-tournament-schedule.md); this was part of that record
until 2026-10-24.

## Decision

### One order, Quarterly Members first

- **A training's list is one order**: Quarterly Members (a subscription covering the session's day, ADR
  [0007](0007-dues-and-payments.md)) above everyone paying as they go, first come first served within each. The first
  places in that order are in; the rest wait (`aheadIn` in `worker/entries/entries.ts`).
- So a Quarterly Member signing up for a full session **takes the place of the last one in who pays as they go**, who
  waits at the top of their queue (their sign-up time is kept, so their place in the order holds). Only when every place
  is a Quarterly Member's does one wait, still above those paying as they go. When a place comes free the first waiting
  in that order moves up. A limit raised (or taken away) is places coming free: as many of the first waiting move up as
  it makes room for, in the batch that saves it, before anyone else can sign up into it (`fillingUp`). A walk-in isn't
  moved.
- **A training's nights can open for sign-up on a day** (`training_series.signup_opens_days`, set in the training's
  editor beside its times): that many days before the night, at midnight London time (Friday Training: 4, the Monday).
  Days before rather than a weekday and time, so it reads the same for a training on two weekdays and needs no time zone
  of its own; empty is always open, as before. Until then a member's In is refused (409, "Sign-up opens Monday.", with
  the date when it's more than a week off) and the app shows "Sign-up opens Mon" in In's place; Out is always fine, and
  the register and admins put people in whenever. On the day members are told, once a night (topic `places`,
  [0108](0108-store-apps.md)): the cron takes the night in the statement that marks it told
  (`training_sessions.signup_told_at`, [0121](0121-load-and-concurrency.md)); a night already open when its training was
  given an opening day isn't news, and isn't sent (`worker/training/training.signup.ts`, `lib/signup.ts`). Nor is it to
  anyone who's answered already (said Out, or put in by an admin): they aren't told.
- **An Out can be taken back**: tapping a pressed Out ("Take back your Out") is not answered again (`answer: "clear"`),
  so a member who said Out before sign-up opened hears when it does. One statement deletes only their own Out (`… AND
signup = 'out'`), so a double tap finds nothing more to do and an In or a place waiting is never touched (that's left
  by saying Out, as ever). It keeps the rules of answering: not once the night's over, nor once a tournament's started
  (`worker/entries/entries.ts` takeBack). The Kumite's invitation keeps Decline and Accept.
- **The limit is what members see and what sign-up keeps to, not a wall**: the team maker can let someone waiting in
  over it ([0076](0076-training-teams.md)). They keep their sign-up time, so they take their place in the order; while
  more are in than the limit, nobody moves up when someone drops out, and the page says how many over it is.
- **Adding someone keeps to the places too**: the register's Add player (before the night or on it, as a walk-in) and an
  admin putting someone in (`update:Event`) put them in if there's room, else on the waiting list, as if they'd signed
  up (a Quarterly Member taking the last pay-as-you-go place; someone already waiting keeps their place in the queue).
  Only the team maker's Let in puts anyone over the limit. The reply says where they went (`signup`), and the register
  says so ("Full: Walt's on the waiting list", Waiting on their row) with Let in beside them for whoever can. A night
  that's over is a record: someone ticked as there is in, whatever the places. **Once training has started** (its start
  time, London) a member's own In or Out is refused (409, "Training's started: the register says who's in"; once it's
  ended, "That night's over"): who's there, and what it charges, is the register's to change, and admins still put
  people in and take them off. The page says so where In and Out were (Started, then Over).
- **The places are the skaters'; keepers have their own**: a keeper is never on the waiting list because the skaters are
  full, and never takes a skater's place. A series' `goalie_capacity` is the keepers' limit (null: none), kept to the
  same way: over it a keeper waits. Places are counted a side at a time, so a place a keeper leaves goes to the first
  keeper waiting, never a skater ahead of them, and a skater's to the first skater (`worker/entries`, `lib/places.ts`).
  The Friday page says the skaters' places left, and the keepers' too where the series sets them.
- **Keepers aren't in the Quarterly order**: they keep their sign-up place, and a skater never takes a keeper's. Whether
  keepers pay at all, or need a plan of their own, is open.
- The app gets the lists in that order, with who is Quarterly (`quarterly`), shown as a Quarterly badge (the word, at
  every width) on their row in the sign-up lists and a tag on their card, so the order reads. That tells every member
  who signed up on the Quarterly plan, which is the point of the badge. Whoever sees who said they're out (who runs
  events) gets the same flag for them, so Out groups by plan too; nobody else's plan is sent.
- **Before anyone's answered**, Friday's Who's coming is a line on the page, not tabs over an empty table: "Nobody's in
  yet." and a quip about slackers (Settings → Quips, "Nobody in"), or, before its sign-up opens, when it does ("Sign-up
  opens Monday. Then we'll see who the slackers are."). The first answer brings the tabs in below the heading, which
  keeps its place.
- Friday's Who's coming shows each list (In, Waiting, Out) **grouped by plan**, under small headings with their counts:
  Quarterly, Pay as you go, Keepers (the three plans, ADR 0007). Skaters keep their number in the one queue, on across
  Quarterly and Pay as you go; keepers are numbered on their own, their places counted apart. The Quarterly badge is
  left off inside the Quarterly group, where the heading says it. Out groups the same way, from the `quarterly` flag
  sent for those who are out (`lib/roster-groups.ts`).
- Tournaments and club events keep plain sign-up order.

## Consequences

- A Quarterly Member can always get in ahead of a pay-as-you-go one, so the plan is worth having; the one who loses
  their place is told by the list, not left guessing.
- A night's sign-up opening is pushed once, so nobody has to keep checking.
- Who's in, and what it charges, is the register's once training has started.

## History

- 2026-10-10: A training's sign-ups are one order, Quarterly Members first; keepers aren't in it; badged (a club rule).
- 2026-10-20: The team maker can let someone waiting in over the limit; the limit still holds for sign-up.
- 2026-10-20: The Quarterly badge says "Quarterly" on a phone too, and is off the team rows.
- 2026-10-20: Adding a player keeps to the places: full means the waiting list.
- 2026-10-21: Friday's Who's coming is grouped by plan (Quarterly, Pay as you go, Keepers), each with its count.
- 2026-10-21: Keepers don't count towards the places; `goalie_capacity` is enforced as the keepers' own limit.
- 2026-10-22: A limit raised moves the first waiting up in the same batch (#127); a training saves with its fees all or
  nothing (#131), with real dates and times (#129).
- 2026-10-22: A member can't say In or Out of a night that has ended (#128).
- 2026-10-22: Deleting an account frees its places as saying out does (#137, ADR 0029).
- 2026-10-22: A training's nights open for sign-up a number of days before, and members are told once.
- 2026-10-22: Who's coming with nobody answered is a line and a quip about slackers.
- 2026-10-23: An Out can be taken back, to not answered, for nights, tournaments and club events.
- 2026-10-23: A member's own In or Out locks once training has started (#167).
- 2026-10-24: Split out of ADR 0030.
