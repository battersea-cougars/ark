# Training

The rules for a training night, in plain words. Each one is checked by the use-case test it links; change the rule,
the test and this line together. Why a piece of code is the way it is stays in a comment beside it.

## Nights

- A training repeats on a rule: chosen weekdays, every so many weeks, from a first night to an optional last one. Its
  nights are made 12 weeks ahead.
  [recurrence.test.ts › "makes an ongoing series 12 weeks ahead"](../../src/lib/recurrence.test.ts)
- Changing the rule takes away the nights to come that it no longer gives, unless someone has answered for one.
  [training.edge-cases.use-cases.test.ts › "an admin moves the last session earlier: the Fridays after it go, unless someone said out of one"](training.edge-cases.use-cases.test.ts)
- Past nights stay whatever the new rule: they're the record of who came.
  [training.edge-cases.use-cases.test.ts › "past nights stay whatever the new rule: they're the record of who came"](training.edge-cases.use-cases.test.ts)
- Each night has its own page at its date; the training's own address shows the next night that's on, with any nights
  off before it struck through.
  [night-off.test.ts › "shows the next night that's on, with the ones off before it, at the series' address"](../../src/lib/night-off.test.ts)
- A notification about a night opens that night's page, not the training's next one.
  [training.signup-opens.use-cases.test.ts › "once, when it opens: the cron sends one notification for the night, however often it runs"](training.signup-opens.use-cases.test.ts)

## Sign-ups

- Sign-ups are one order: Quarterly Members first, then everyone paying as they go, each by when they said in. The first
  places in that order are in; the rest wait.
  [entries.use-cases.test.ts › "a Quarterly Member who signs up goes above those paying as they go, and is marked"](../entries/entries.use-cases.test.ts)
- A Quarterly Member signing up for a full night takes the place of the last one in paying as they go, who waits at the
  top of their queue.
  [entries.use-cases.test.ts › "a Quarterly Member signing up for a full Friday takes the place of the last one paying as they go"](../entries/entries.use-cases.test.ts)
- When a place comes free, the first waiting in that order moves up; a limit raised lets in as many as it makes room
  for.
  [entries.edge-cases.use-cases.test.ts › "an admin makes room for one more: the first waiting is in, not the next to sign up (#127)"](../entries/entries.edge-cases.use-cases.test.ts)
- A walk-in is never moved out for a Quarterly Member.
  [entries.edge-cases.use-cases.test.ts › "a Quarterly Member never takes a walk-in's place: the last one in paying as they go waits instead"](../entries/entries.edge-cases.use-cases.test.ts)
- The places are the skaters'. Keepers have their own (none, or the training's keeper places), aren't in the Quarterly
  order, and a skater never takes a keeper's place.
  [entries.use-cases.test.ts › "keepers aren't in it: a Quarterly skater takes the place of a skater paying as they go, never a keeper's"](../entries/entries.use-cases.test.ts)
- A training's nights can open for sign-up a number of days before, at midnight London (Friday Training: the Monday).
  Until then a member's In is refused, saying when it opens; Out is fine, and admins can still put people in.
  [training.signup-opens.use-cases.test.ts › "before the Monday a member's In is refused, saying when it opens"](training.signup-opens.use-cases.test.ts)
- Members hear once that a night's open, unless they've answered already or turned that notice off.
  [training.signup-opens.use-cases.test.ts › "a member who's said Out for the night isn't told, nor one already in; the rest are"](training.signup-opens.use-cases.test.ts)
- An Out can be taken back to not answered, so a member hears when sign-up opens.
  [entries.take-back.use-cases.test.ts › "Reg says Out, then takes it back: he's not answered, and he hears Monday's sign-up's open"](../entries/entries.take-back.use-cases.test.ts)
- Adding someone (the register's Add player, an admin putting them in) keeps to the places: a full night puts them on
  the waiting list. Only the team maker's Let in goes over the limit.
  [entries.adding.use-cases.test.ts › "an admin putting someone in a full Friday puts them on the waiting list; with room, in"](../entries/entries.adding.use-cases.test.ts)
- Once training has started a member can't say In or Out of it: the register says who's in.
  [entries.edge-cases.use-cases.test.ts › "once it's started a member can't say out, nor in: the register says who's in (#167)"](../entries/entries.edge-cases.use-cases.test.ts)
- Who's coming is grouped by plan: Quarterly, Pay as you go, Keepers. Who runs events sees the plan of those who are out
  too; nobody else does.
  [roster-groups.test.ts › "puts Quarterly, then Pay as you go, then Keepers, each in the list's order"](../../src/lib/roster-groups.test.ts)
- Tournaments and club events keep plain sign-up order.
  [entries.use-cases.test.ts › "a club event's waitlist stays first come, first served"](../entries/entries.use-cases.test.ts)

## Nights off and cancelling

- An admin cancels a night, and puts it back on, from its own page; the confirm says who hears it's off. A session lead
  can't.
  [training.cancel-night.use-cases.test.ts › "the Kumite's Friday: the page's night, the confirm saying who hears it, and the night off for everyone"](training.cancel-night.use-cases.test.ts)
- A cancelled night takes no sign-ups and charges nobody.
  [entries.edge-cases.use-cases.test.ts › "a cancelled night charges nobody; put back on, those who were in are charged again"](../entries/entries.edge-cases.use-cases.test.ts)
- A night off for a Kumite comes back on by itself when that Kumite is deleted or moved off its day, unless another
  Kumite that day or a hand cancellation still keeps it off. Moving only its hours keeps it off.
  [training.nights-off.use-cases.test.ts › "the Kumite moved to another Friday: the old one's back on, the new one off; moved to a Saturday, both on"](training.nights-off.use-cases.test.ts)
- Called off by hand and off for a Kumite are kept apart: lifting one never loses the other.
  [training.nights-off.use-cases.test.ts › "called off by hand, then a Kumite that day, then the Kumite deleted: still off, by hand"](training.nights-off.use-cases.test.ts)
- It's back on lifts every reason it was off, so deleting the Kumite later doesn't take it off again.
  [training.nights-off.use-cases.test.ts › "off for a Kumite, put back on from its page (Keep both after all): deleting the Kumite later doesn't take it off"](training.nights-off.use-cases.test.ts)
- A Kumite played early keeps its training night off: members may have planned around it. An admin can put it back on.
  [training.nights-off.use-cases.test.ts › "a Kumite played early keeps its training night off, until an admin puts it back on"](training.nights-off.use-cases.test.ts)
- Coming back on isn't news: whoever was in is in again, and nobody is told.
  [training.nights-off.use-cases.test.ts › "whoever was in is in again when it comes back, and nobody hears that it's back on"](training.nights-off.use-cases.test.ts)

## The register

- The register closes at 06:00 London the morning after. Till then whoever takes it puts it right; from then who came,
  and what it charged, is the record.
  [training.register-closes.use-cases.test.ts › "from 06:00 the register refuses a tick, in plain words, and who came stays as it was"](training.register-closes.use-cases.test.ts)
- Once it's closed every change to who was there is refused: the register, an admin putting in or taking off, Let in,
  a reset, calling the night off or back on, and a member's attendance.
  [training.register-closes.use-cases.test.ts › "a closed night can't be reset, called off, or put back on: its charges stand"](training.register-closes.use-cases.test.ts)
- It's 06:00 London time whatever the clocks do.
  [training.register-closes.use-cases.test.ts › "a Saturday night's register closes at 06:00 GMT on Sunday, an hour later in UTC than the week before"](training.register-closes.use-cases.test.ts)
- Teams aren't attendance: a closed night keeps its teams.
  [training.register-closes.use-cases.test.ts › "teams aren't attendance: a closed night keeps the teams it had"](training.register-closes.use-cases.test.ts)
- On the night a full night still holds (a walk-in waits); once the night's over, ticking someone records that they
  came.
  [training.edge-cases.use-cases.test.ts › "in summer time, a minute past midnight the night's over: ticking a walk-in records that he came"](training.edge-cases.use-cases.test.ts)

## Training teams

- A Session lead (and an admin) makes the teams and sees ratings; a member can't make them.
  [training.teams.use-cases.test.ts › "a team maker sees ratings, and publishes teams everyone then sees"](training.teams.use-cases.test.ts)
- There are no drafts: every change the team maker makes is saved at once and everyone sees it.
  [training.teams.use-cases.test.ts › "a team maker moves a player and everyone sees it straight away"](training.teams.use-cases.test.ts)
- Clearing the teams puts everyone back on no team; who's in stays.
  [training.teams.use-cases.test.ts › "the team maker clears the teams: everyone's back to unassigned, it's on the record, and phones hear it"](training.teams.use-cases.test.ts)
- The team maker can let someone waiting in over the limit; the limit still holds for everyone else.
  [training.teams.use-cases.test.ts › "lets Wes in over the limit: he's in, in his sign-up place, nobody's waiting, and his phone hears it"](training.teams.use-cases.test.ts)
- Saying out doesn't take a member off a published team: they stay on it until a team maker decides. An admin taking
  someone off the night takes them off their team.
  [api.test.ts › "an admin publishes Friday's teams; everyone sees them, and someone dropping out stays on theirs until a team maker decides"](../api/api.test.ts)
- A team reads forwards, defence, then keepers; best first for the team maker, by name for everyone else, so the order
  gives no ratings away.
  [balance.test.ts › "a member sees the same positions in the same order, by name, so the order gives no ratings away"](../../src/lib/balance.test.ts)
- Each team's head shows its player count and, for the team maker, its average rating.
  [balance.test.ts › "counts the players and averages their rating, as the teams are balanced by"](../../src/lib/balance.test.ts)

## The team maker

- 3 to 7 a side, the fewest teams that allows.
  [balance.test.ts › "matches the archived solver's team sizes (3 to 7 a side)"](../../src/lib/balance.test.ts)
- Balanced in this order, the first difference deciding: sizes within one; as many Cougars together on the Cougars as
  fit; keepers spread; defenders spread; average ratings close; each position's ratings close.
  [balance.test.ts › "finds the best teams there are (checked against every split of a small roster)"](../../src/lib/balance.test.ts)
- Even sizes come before keeping the Cougars together: with more Cougars than a team holds, the best fill it and the
  rest are dealt out.
  [balance.test.ts › "with more Cougars than a team holds, keeps a full team of them and balances the rest"](../../src/lib/balance.test.ts)
- Every team gets a keeper and a defender where there are enough.
  [balance.test.ts › "gives every team a keeper when there are enough"](../../src/lib/balance.test.ts)
- The average rating is balanced, not the total: a team of seven isn't also given the weaker players.
  [balance.test.ts › "balances the average rating, not the total: the team of seven isn't also given the weaker players"](../../src/lib/balance.test.ts)
- One team doesn't get all the best defenders.
  [balance.test.ts › "spreads each position's ratings too: one team doesn't get all the best defenders"](../../src/lib/balance.test.ts)
- Without a Cougar the teams are named by colour.
  [balance.test.ts › "names the teams by colour when nobody is a Cougar"](../../src/lib/balance.test.ts)
- The same players always give the same teams, quickly enough for a phone.
  [balance.test.ts › "gives the same players the same teams"](../../src/lib/balance.test.ts)
- Late sign-ups go onto teams already made without remaking: a Cougar to the Cougars, numbers evened first, then the
  weaker side.
  [balance.test.ts › "keeps the teams and adds late sign-ups to the weaker side, best first"](../../src/lib/balance.test.ts)
