# Tournaments

The rules for running a tournament (the Kumite and any other series), in plain words. Each one is checked by the
use-case test it links; change the rule, the test and this line together. Why a piece of code is the way it is stays in
a comment beside it.

## A tournament's statuses and its page

- A tournament goes Sign-up open, Draft open, Teams set, Fixtures set, then the day (KUMITE! for the Kumite), then its
  after-party; teams that enter skip the draft.
  [tournament-front.test.ts › "a draft: Sign-up open, Draft open, Teams set, Fixtures set, KUMITE!, the afterwards; teams that enter skip the draft"](../../src/lib/tournament-front.test.ts)
- Where it stands comes from its games, not its settings: under way once a game's being scored or has a result, done
  once every game's played.
  [edition.test.ts › "under way once a game's being scored or has a result, whatever the status says"](../../src/lib/edition.test.ts)
- Status, not the date, says whether it's past, on or next: a Kumite played early is past, and its sign-up opening day,
  coming after, tells nobody.
  [status-over-date.use-cases.test.ts › "its sign-up's opening day, coming after it was played, tells nobody"](status-over-date.use-cases.test.ts)
- A Kumite whose day went by unplayed is still the next one, on Home and the calendar, until it's played, moved or
  deleted.
  [status-over-date.use-cases.test.ts › "its day is still on the agenda the app reads, for Home and the calendar, until it's played"](status-over-date.use-cases.test.ts)
- A game running late is still the current one; the one after doesn't become current.
  [phase.test.ts › "running late: the game set for 1:00, starting at 1:45, is the current one; the one after stays next"](../../src/lib/phase.test.ts)
- The track only opens a status it has reached; one ahead shows where it is now.
  [tournament-front.test.ts › "one not reached yet, or an address that isn't one: the status it's at"](../../src/lib/tournament-front.test.ts)
- Once it's started (marked live or finished, or a match played), a member can't take themselves out: only an admin
  can, and their place and charge stay till then.
  [live-lock.use-cases.test.ts › "marked %s: Reg's Out is refused, his place and his £15 charge stay as they were"](live-lock.use-cases.test.ts)
- Started means a match has been played, whatever its status says.
  [live-lock.use-cases.test.ts › "fixtures set, a goalie left over says he's out; a match played, the next one can't, nor can anyone come in"](live-lock.use-cases.test.ts)
- A series has an afterwards (the Kumite's is The Anchor); each tournament follows it, goes somewhere else, or nowhere
  this time.
  [afterwards.use-cases.test.ts › "one Kumite can go somewhere else afterwards, at its own time, and the next one's back at The Anchor"](afterwards.use-cases.test.ts)
- A team without a logo has a crest of its initials, skipping a generic first word, and no two teams in a tournament
  share one.
  [team-initials.test.ts › "two teams in the same tournament never share a crest: the first keeps its own, the next takes more letters"](../../../../packages/shared/team-initials.test.ts)
- A series' house rules are plain text an admin writes, shown a rule a line under Format & rules.
  [house-rules.use-cases.test.ts › "an admin writes the Kumite's house rules; a member reads them under Format & rules, a rule a line"](house-rules.use-cases.test.ts)

## Scheduling and sign-up

- A tournament copies its series' rules, fee, hours and awards when it's made, and can then differ; the next one can be
  scheduled with just a season.
  [tournaments.use-cases.test.ts › "an admin schedules the next one with just its season: the day, the draft's date and the captains can come later"](tournaments.use-cases.test.ts)
- Changing a series' defaults changes the next one scheduled, never one already scheduled.
  [tournaments.use-cases.test.ts › "a change to the series' defaults reaches the next one scheduled, not one already scheduled"](tournaments.use-cases.test.ts)
- A date is a day or just a season; a season's date sorts as its last day.
  [tournaments.edge-cases.use-cases.test.ts › "29 February is a day in a leap year (2028), and just a season's date is its last day"](tournaments.edge-cases.use-cases.test.ts)
- Sign-up opens and closes on the day itself at the latest, and the draft is on the day or before.
  [tournaments.edge-cases.use-cases.test.ts › "sign-up opens and closes on the day itself at the latest, and the draft is on the day or before"](tournaments.edge-cases.use-cases.test.ts)
- Sign-up opens by itself on its opening day (London); before then a member saying in is told when it opens.
  [tournaments.use-cases.test.ts › "sign-up opens by itself on the day the admin set, without anyone opening it"](tournaments.use-cases.test.ts)
- Without an opening day it waits for an admin to open it; saying out is always fine.
  [tournaments.use-cases.test.ts › "members can't say they're in until an admin opens sign-up"](tournaments.use-cases.test.ts)
- Sign-up closes at the end of its closing day; after it nobody can say they're in.
  [tournaments.use-cases.test.ts › "members say they're in once sign-up is open, and not after it closes"](tournaments.use-cases.test.ts)
- Members hear sign-up's open once: the Kumite's as an invitation, however often the cron runs; anyone who's said Out
  isn't told.
  [signup-opens.use-cases.test.ts › "the Kumite's is an invitation: on its opening day, once, however often the cron runs"](signup-opens.use-cases.test.ts)
- An admin can close sign-up now; from then nobody else can say they're in, and a draft moves on to Draft open.
  [signup-close.use-cases.test.ts › "sign-up's over from today: nobody else can say they're in, and the draft is where it's at"](signup-close.use-cases.test.ts)
- Once it's closed, a member who's in can still say they're out, and an admin can still put someone in.
  [signup-close.use-cases.test.ts › "a member who's in can still say they're out once it's closed"](signup-close.use-cases.test.ts)
- Closing sign-up leaves its dates as they were, so a later save never finds it closing before it opens.
  [signup-close.use-cases.test.ts › "is past sign-up, its dates as they were: it still opens today and has no closing day"](signup-close.use-cases.test.ts)
- A tournament's kind (teams enter, or a captains' draft) stays once it has any team.
  [tournaments.edge-cases.use-cases.test.ts › "its type changes only while it has no teams: a draft with captains named, or teams that entered, keeps its type"](tournaments.edge-cases.use-cases.test.ts)
- Up to 16 teams; a team that enters needs a name, has up to 30 players, and nobody plays for two teams.
  [tournaments.edge-cases.use-cases.test.ts › "a team that enters needs a name, of up to 40, and up to 30 players, nobody on two teams"](tournaments.edge-cases.use-cases.test.ts)
- The editor never changes a tournament's status (that's its page's Manage), nor a team's name and logo (that's the
  team's page).
  [tournaments.editor.use-cases.test.ts › "the editor sends no status: opened at Sign-up open, saved after Move to The Anchor, it stays finished"](tournaments.editor.use-cases.test.ts)
- An admin deletes a tournament with its teams, sign-ups and results; it goes from What's on too.
  [tournaments.use-cases.test.ts › "an admin deletes one: it's gone from the app and What's on, with its teams and sign-ups; a member can't"](tournaments.use-cases.test.ts)

## Running it from Manage

- Manage offers only the jobs that make sense where the tournament stands, to whoever's looking; the day is split at
  the first match started.
  [manage.test.ts › "names each stage, the day split at the first match started"](../../src/lib/manage.test.ts)
- An admin can always step it back one step, and each step undoes only that step.
  [step-back.use-cases.test.ts › "step by step from a match played all the way back to sign-up, one step each time"](step-back.use-cases.test.ts)
- Stepping back from a match played deletes the results, goals and penalties; the matches stay.
  [step-back.use-cases.test.ts › "a match played: back to the fight card not started, results, goals and all gone; the matches stay"](step-back.use-cases.test.ts)
- A step back says which step it's leaving: from a page that's out of date it's refused, and two taps step back once.
  [step-back.use-cases.test.ts › "a page that's out of date is refused, and nothing changes"](step-back.use-cases.test.ts)
- Only an open draft stepped back is news: its captains hear it's paused; nothing else is sent.
  [step-back.use-cases.test.ts › "no other step back is sent to anyone"](step-back.use-cases.test.ts)
- Whoever runs the draft steps the draft back, not the fixtures; a member or captain can't step back at all.
  [step-back.use-cases.test.ts › "someone who runs the draft steps the draft back, not the fixtures; a member or captain can't at all"](step-back.use-cases.test.ts)
- An admin can move a captains' draft to any status at once. Forward does the jobs in between, everyone still to pick
  chosen at random.
  [move-to.use-cases.test.ts › "Sign-up open to Fixtures set: sign-up closed, the order drawn, the rest chosen at random, the fixtures made"](move-to.use-cases.test.ts)
- Moving forward when it can't be done (too few signed up for the draft) is refused, and nothing changes.
  [move-to.use-cases.test.ts › "too few signed up for the draft: refused, and nothing changes (sign-up still open)"](move-to.use-cases.test.ts)
- Moving back is the steps back in one go: a match's results and goals deleted, the fixtures cleared.
  [move-to.use-cases.test.ts › "a match played, KUMITE!, back to Teams set: its result and goals deleted, the fixtures cleared"](move-to.use-cases.test.ts)
- On its day, Fixtures set is KUMITE!, so it isn't a status to move back to.
  [move-to.test.ts › "on its day, Fixtures set is KUMITE!: not one to move back to"](../../src/lib/move-to.test.ts)
- Of two admins moving at once, one moves and the other is told their page is out of date.
  [move-to.use-cases.test.ts › "two admins at once: one moves, the other's page is out of date and is refused"](move-to.use-cases.test.ts)
- Only an admin moves it; every move is on the record, with what it did.
  [move-to.use-cases.test.ts › "every move is one entry on the record: from, to, and what it did"](move-to.use-cases.test.ts)

## Fixtures

- Fixtures need two teams, nothing more: a round robin (everyone plays everyone once), then the playoffs the tournament
  asks for.
  [fixtures.use-cases.test.ts › "an admin has the app make a round robin: every team plays every other once, then the playoff games"](fixtures.use-cases.test.ts)
- The round robin is played in the order that gives everyone the longest break it can: with five teams, nobody plays
  twice running.
  [fixtures.use-cases.test.ts › "the order gives everyone the longest break it can: with five teams, nobody plays twice running"](fixtures.use-cases.test.ts)
- With 3 or 4 teams someone has to play twice running, but never the same team twice (3 teams).
  [fixtures.fair-order.test.ts › "3 teams: playing twice running can't be helped, but it's never the same team twice"](../../src/lib/fixtures.fair-order.test.ts)
- Home and away even out for every team, give or take one.
  [fixtures.fair-order.test.ts › "sides take turns: home and away even for every team, give or take one"](../../src/lib/fixtures.fair-order.test.ts)
- Made again, the fixtures come in another order just as fair, never the one there was.
  [fixtures.use-cases.test.ts › "made again, the fixtures come in another order just as fair, never the one there was"](fixtures.use-cases.test.ts)
- They can be made again until a game has a result (or is on); then they're locked.
  [fixtures.use-cases.test.ts › "can be made again until a game has a result, then they're locked"](fixtures.use-cases.test.ts)
- An admin can clear the fixtures, results and all, to make them again.
  [tournaments.use-cases.test.ts › "an admin clears the fixtures of a closed draft without reopening it; then they can be made again"](tournaments.use-cases.test.ts)
- The table ranks by the tournament's own points, then goal difference, then goals scored; no head to head, and only
  finished games count.
  [fixtures.edge-cases.test.ts › "there's no head to head: level on points, GD and goals, the order given decides, not who beat whom"](../../src/lib/fixtures.edge-cases.test.ts)
- The last group result fills the playoffs from the table.
  [fixtures.use-cases.test.ts › "the last group result fills the playoffs from the table"](fixtures.use-cases.test.ts)
- A group result put right afterwards refills only the playoffs still to start: one being played keeps its teams.
  [scoring.edge-cases.use-cases.test.ts › "an admin putting a group result right while the Final's being played doesn't change who's playing it"](scoring.edge-cases.use-cases.test.ts)
- The champions are whoever wins the last playoff game; without playoffs, the top of the table once every game's played.
  [fixtures.test.ts › "with playoffs: whoever wins the last one, the final"](../../src/lib/fixtures.test.ts)
- A game's slot is its periods times their minutes plus the breaks between them, and kick-offs follow it.
  [fixtures.test.ts › "takes in the breaks between periods: three 12s with 2-minute breaks are 40 minutes; one period has none"](../../src/lib/fixtures.test.ts)

## Scoring a game

- Only the game up next is scored; the next opens at full time.
  [scoring.use-cases.test.ts › "one game at a time: the next doesn't start while one's on"](scoring.use-cases.test.ts)
- Each game suggests a team sitting it out to keep score, turns spread evenly.
  [scoring.use-cases.test.ts › "each game suggests a team sitting it out to keep score"](scoring.use-cases.test.ts)
- One person holds the scoresheet: only they run the clock and log goals and penalties.
  [scoring.use-cases.test.ts › "one person keeps score: whoever presses Start scoring holds the scoresheet, and nobody else can score"](scoring.use-cases.test.ts)
- Only whoever holds it, or an admin, lets it go; then anyone can take it on.
  [scoring.use-cases.test.ts › "only whoever holds the scoresheet, or an admin, lets it go; then someone else can take it on"](scoring.use-cases.test.ts)
- An admin can take over a scoresheet in one tap, or free it; from then every tap from the old phone is refused.
  [scoring.takeover.use-cases.test.ts › "from then on, every tap from Mo's phone is refused: the clock, goals, penalties, Undo"](scoring.takeover.use-cases.test.ts)
- An admin can't log a goal in a game someone else is scoring live.
  [scoring.edge-cases.use-cases.test.ts › "an admin can't log a goal in a game someone else is scoring live: they hand it over first"](scoring.edge-cases.use-cases.test.ts)
- The scorekeeper sets the time by the clock: paused stays paused, running runs on, never more than an hour.
  [scoring.use-cases.test.ts › "the scorekeeper sets the time on the clock: paused, or running on from there"](scoring.use-cases.test.ts)
- A level playoff plays on at full time until the next goal wins it, and can't be put right to a draw.
  [scoring.use-cases.test.ts › "level at full time, it plays on: full time is refused until the next goal wins it"](scoring.use-cases.test.ts)
- The score is always its goals: an admin putting a result right adds or takes off goals.
  [scoring.use-cases.test.ts › "a score typed in is that many goals, nobody said who, so the score and the goals always agree"](scoring.use-cases.test.ts)
- Only an admin puts a result right, and only once it's played.
  [scoring.use-cases.test.ts › "only an admin, and only once it's played: not the scorekeeper, not a game still on"](scoring.use-cases.test.ts)
- One tap is one goal, even sent from two phones at once.
  [scoring.concurrency.use-cases.test.ts › "the same goal tap sent from two phones at once is one goal (seed %i)"](scoring.concurrency.use-cases.test.ts)
- A tournament's hours stay as an admin set them, however early, late or on another day its matches start.
  [match-times.use-cases.test.ts › "stay as set, day and all, when its first match is started on another day: the match just starts"](match-times.use-cases.test.ts)
- Each match keeps when it actually kicked off: the first Start of its clock, never moved by a pause.
  [match-times.use-cases.test.ts › "isn't moved by pausing and starting the clock again, nor by full time"](match-times.use-cases.test.ts)
- A game is 1 to 3 periods, a series setting copied onto each tournament; goals and penalties carry their period.
  [scoring.use-cases.test.ts › "at the end of the 1st, the 2nd starts paused at full length; goals carry their period; full time after the 3rd"](scoring.use-cases.test.ts)
- A break between periods is a series setting (2 minutes unless said, up to 15; the Kumite none); the scorekeeper starts
  the next period when ready.
  [scoring.use-cases.test.ts › "is a series setting in minutes (2 unless said, up to 15), copied onto its tournaments; the Kumite has none"](scoring.use-cases.test.ts)
- A penalty is always for something; one on a player needs who, a bench one can be on nobody.
  [scoring.use-cases.test.ts › "it's always for something: one on a player needs who, a bench one can be on nobody"](scoring.use-cases.test.ts)
- Too many players and a bench minor are always two minutes.
  [scoring.use-cases.test.ts › "too many players, and a bench minor, are always two minutes"](scoring.use-cases.test.ts)
- A penalty called without its length is the tournament's usual one (a series setting, a Minor unless said).
  [scoring.use-cases.test.ts › "a penalty called without its length is the tournament's usual one; too many players is still 2"](scoring.use-cases.test.ts)
- How a penalty's served is the series' setting: Power play by default; the Kumite's is a penalty shot, the player
  sitting out.
  [scoring.use-cases.test.ts › "the Kumite's penalties are a penalty shot, the player sitting out"](scoring.use-cases.test.ts)
- On a power play, a goal ends the penalised team's earliest minor, never a major.
  [penalties.test.ts › "a power-play goal ends the penalised team's earliest minor"](../../src/lib/penalties.test.ts)
- A double minor is one penalty of four, served 2+2: a power-play goal in the first two starts the second fresh.
  [penalties.test.ts › "a power-play goal in the first two ends that half: the second two start fresh from the goal"](../../src/lib/penalties.test.ts)
- A player serves one penalty at a time: a second starts when the first ends, and the team's a player short, not two.
  [penalties.test.ts › "a second on a player still serving one starts when the first ends, shown waiting"](../../src/lib/penalties.test.ts)
- Coincidental penalties cancel in pairs of the same length; one minor each is four on four.
  [penalties.test.ts › "one minor each, nothing else on: four on four, no power play, both served in full"](../../src/lib/penalties.test.ts)
- Sitting out, a goal against never ends a penalty: nobody's short-handed.
  [penalties.test.ts › "a goal against doesn't end it: nobody's short-handed"](../../src/lib/penalties.test.ts)
- Penalty minutes add up per player and per team across the day's games.
  [scoring.use-cases.test.ts › "penalty minutes add up per player and per team, across the day's games"](scoring.use-cases.test.ts)

## The draft

- Nothing happens on its own: whoever runs the draft draws the order, opens it and closes it, one step at a time.
  [draft.edge-cases.use-cases.test.ts › "before it opens, a pick, an Undo and a Close are all refused, and nobody's on a team"](draft.edge-cases.use-cases.test.ts)
- The pick order is drawn at random by the server, never the order the captains were named in; until it's drawn the
  captains have no numbers.
  [tournaments.use-cases.test.ts › "before the draw the captains have no numbers: the order they were named in means nothing"](tournaments.use-cases.test.ts)
- The draft can't open until the order's drawn.
  [tournaments.use-cases.test.ts › "opening without the draw is refused: draw the order first"](tournaments.use-cases.test.ts)
- The order is drawn once: drawing again, opening, closing and reopening, and saving the tournament keep it. Changing
  the captains before it opens takes the order away, and so does a reset.
  [tournaments.use-cases.test.ts › "it's drawn once: drawing again, opening, or closing and reopening keep the order"](tournaments.use-cases.test.ts)
  [tournaments.use-cases.test.ts › "saving the tournament once it's drawn keeps the drawn order; changing the captains before it opens undraws it"](tournaments.use-cases.test.ts)
  [tournaments.use-cases.test.ts › "a reset takes the order away with the picks, and the next draw draws again"](tournaments.use-cases.test.ts)
- Everyone sees the same order the moment it's drawn.
  [tournaments.use-cases.test.ts › "everyone sees the same drawn order as soon as it's drawn: the captains, whoever runs it, and any member"](tournaments.use-cases.test.ts)
- Opening tells each captain on their phone, with their place ("You pick 2nd"), quiet hours or not; only the first
  time, not when a closed draft reopens.
  [tournaments.use-cases.test.ts › 'opening it tells each captain on their phone, with their place: "Winter Cup 2026 Draft Open", "You pick 2nd"'](tournaments.use-cases.test.ts)
  [tournaments.use-cases.test.ts › "reopening a closed draft doesn't tell them again, and a captain who turned the draft off doesn't hear"](tournaments.use-cases.test.ts)
- A draft needs two captains or more, and enough sign-ups for every team to have its captain and two more.
  [tournaments.use-cases.test.ts › "an admin can't open the draft until every team can have 3 players, its captain and two picks"](tournaments.use-cases.test.ts)
  [draft.edge-cases.use-cases.test.ts › "with only one captain there's no draft to draw or open"](draft.edge-cases.use-cases.test.ts)
- Captains are in automatically, on their own team, and can't be picked. A captain can't say they're out: an admin
  changes the captains.
  [tournaments.use-cases.test.ts › "captains are in the tournament automatically, on their own team, and nobody can pick them"](tournaments.use-cases.test.ts)
  [draft.edge-cases.use-cases.test.ts › "a captain can't say they're out: they ask an admin, and they're still in, captaining their team"](draft.edge-cases.use-cases.test.ts)
- Captains pick in snake order (1 2 3, 3 2 1, …), only from members who said they're in, each once, and only on their
  own turn.
  [tournaments.use-cases.test.ts › "captains take turns in snake order, and each pick lands on their team"](tournaments.use-cases.test.ts)
  [draft.edge-cases.use-cases.test.ts › "nobody who said they're out, or never signed up, can be picked, by a captain or whoever runs it"](draft.edge-cases.use-cases.test.ts)
- A pick that comes off (the player says they're out) is filled next, by the team whose pick it was; then the draft
  goes on.
  [draft.edge-cases.use-cases.test.ts › "the first captain's only pick says they're out: the first captain, now with nobody, is on the clock to fill it (#125)"](draft.edge-cases.use-cases.test.ts)
- A pick says which turn it's for, so a second tap or a second phone never spends the captain's next pick.
  [draft.concurrency.use-cases.test.ts › "the captain whose snake turn comes twice running, on two phones: one pick, the next one still theirs (seed %i)"](draft.concurrency.use-cases.test.ts)
- Whoever runs the draft can pick for the captain on the clock and undo the last pick; a pick made for a captain is
  shown, and on the record, as made for them.
  [tournaments.use-cases.test.ts › "an admin running the draft can pick for the captain on the clock, and undo the last pick"](tournaments.use-cases.test.ts)
  [tournaments.use-cases.test.ts › "a pick an admin makes for a captain is on record as theirs, for that captain's team; a captain's own is theirs"](tournaments.use-cases.test.ts)
- Captains only pick; running the draft (draw, open, close, Undo, reset) is someone given it.
  [draft.edge-cases.use-cases.test.ts › "a captain picks only on their own turn and runs nothing: no draw, open, close, reset or Undo"](draft.edge-cases.use-cases.test.ts)
- One goalie a team, counting its captain, however someone gets on it.
  [tournaments.use-cases.test.ts › "a team takes one goalie: a second is refused, for a captain, for whoever runs the draft, and for an admin's team edit"](tournaments.use-cases.test.ts)
- Saying you're out while the draft's open takes you off your team; once it's closed, it goes through an admin.
  [tournaments.use-cases.test.ts › "a member who withdraws during the draft comes off their team; once it's closed, they ask an admin"](tournaments.use-cases.test.ts)
- Closing needs everyone picked, or the admin choosing to leave the rest out; then the picks are locked and nobody new
  goes in.
  [tournaments.use-cases.test.ts › "the admin closes the draft once everyone's picked, or leaves the rest out on purpose; then it's locked"](tournaments.use-cases.test.ts)
  [tournaments.use-cases.test.ts › "once the draft is closed the teams are set: nobody new goes in"](tournaments.use-cases.test.ts)
- Closing makes the fixtures in the same tap, once; fixtures already made are kept, and if the playoffs need more teams
  than there are, nothing changes.
  [tournaments.use-cases.test.ts › "everyone's picked: one tap closes it and makes the fixtures; only someone running the draft can"](tournaments.use-cases.test.ts)
  [tournaments.use-cases.test.ts › "fixtures made before the draft are kept, not made again"](tournaments.use-cases.test.ts)
  [tournaments.use-cases.test.ts › "when the playoffs need more teams than there are, nothing changes: it says so, and stays open"](tournaments.use-cases.test.ts)
- A closed draft reopens with its picks, the next captain carrying on. Its fixtures stay unless the admin clears them;
  once a match has a result, clearing them is the only way to reopen, and clearing needs someone who edits the
  tournament.
  [tournaments.use-cases.test.ts › "an admin reopens a closed draft: the picks stay, and the captains carry on where they left off"](tournaments.use-cases.test.ts)
  [tournaments.use-cases.test.ts › "once a match has a result, keeping the fixtures is refused: nothing changes"](tournaments.use-cases.test.ts)
  [tournaments.use-cases.test.ts › "clearing takes someone who edits the tournament: someone who only runs the draft can reopen, keeping them"](tournaments.use-cases.test.ts)
- A reset takes every pick off and puts the draft back to not open; sign-ups, captains and fixtures stay, even after
  results. A pick landing during a reset never outlives it.
  [tournaments.use-cases.test.ts › "once it's closed too: the players come off, and the fixtures stay, as the teams are the same teams"](tournaments.use-cases.test.ts)
  [draft.edge-cases.use-cases.test.ts › "a reset racing a later pick: once reset, no pick is left on a team (seed %i)"](draft.edge-cases.use-cases.test.ts)
- The tournament's editor never rewrites the draft: a save keeps every pick and the drawn order, and can't change the
  captains once it's open.
  [tournaments.use-cases.test.ts › "once the draft is open, the captains and the drawn order stay: a save listing them in another order keeps the draw's, another captain is refused"](tournaments.use-cases.test.ts)
- Teams are edited by an admin on the Teams page, not in the draft; a captain stays on their own team.
  [tournaments.use-cases.test.ts › "a captain stays on their own team, and only an admin edits teams"](tournaments.use-cases.test.ts)
- Members who aren't in the draft see the captains and no players while it's on; once it's closed, the teams, with no
  pick numbers and in no particular order.
  [tournaments.use-cases.test.ts › "members don't see the picks while the draft is on; once it closes they see the teams, in no particular order"](tournaments.use-cases.test.ts)
- Draft night is on the calendar only for its captains and whoever runs it, until it's closed.
  [agenda.use-cases.test.ts › "its draft day shows only to its captains and the admins, as a day: a reminder, with no time"](../calendar/agenda.use-cases.test.ts)
  [agenda.use-cases.test.ts › "a closed draft leaves the calendar; a finished tournament leaves it altogether"](../calendar/agenda.use-cases.test.ts)
- The draft and the fixtures don't wait for each other.
  [fixtures.use-cases.test.ts › "a captains' draft gets its fixtures as soon as it has its captains: the draft can come before or after"](fixtures.use-cases.test.ts)
- A tournament teams enter has no draft.
  [draft.edge-cases.use-cases.test.ts › "a tournament teams enter has no draft: drawing, opening, closing, picking and Undo are refused"](draft.edge-cases.use-cases.test.ts)

### A captain's team, edition to edition

- A captain of a new edition starts with the name and logo of the team they last captained in the same series (by
  day), unless it's given its own; never captained in it, the automatic "Team <first name>". Other series don't carry
  it over.
  [team-name.use-cases.test.ts › "captains in edition 2 start with the name and logo of their team in edition 1"](team-name.use-cases.test.ts)
  [team-name.use-cases.test.ts › "it's the last edition before this one, by its day: one scheduled earlier on the calendar brings the one before it"](team-name.use-cases.test.ts)
  [team-name.use-cases.test.ts › "another series doesn't bring the Kumite's team, and the Kumite doesn't bring the other's"](team-name.use-cases.test.ts)
  [team-name.use-cases.test.ts › "a captain who has never captained in the series starts blank, even if they have played in it"](team-name.use-cases.test.ts)
  [team-name.use-cases.test.ts › "a name given for the new team wins over the one they'd bring, and keeps its own logo"](team-name.use-cases.test.ts)
- Renaming a team changes only that edition's, which is then what its captain brings next time.
  [team-name.use-cases.test.ts › "a rename in edition 2 changes only edition 2's team, and edition 3 brings the new one"](team-name.use-cases.test.ts)
- A brought name another team already goes by gives way: its captain gets the automatic name.
  [team-name.use-cases.test.ts › 'a brought name another captain goes by automatically ("Team Cara") gives way: its bringer has their own automatic name'](team-name.use-cases.test.ts)
  [team-name.use-cases.test.ts › "two captains bringing the same name: the first named keeps it, the other has the automatic name"](team-name.use-cases.test.ts)
- The team name lives with the series, not the member; an erased member's old teams never come back.
  [team-name.use-cases.test.ts › "the member and their profile hold no team name anywhere"](team-name.use-cases.test.ts)
  [team-name.use-cases.test.ts › "an erased member's old teams never come back"](team-name.use-cases.test.ts)

## Awards and leaderboards

- A series has up to 8 awards, no two with the same name; each tournament copies them and can change its own.
  [tournaments.edge-cases.use-cases.test.ts › "a short name of up to 12, up to 8 awards (empty ones dropped), up to 8 playoffs between two places"](tournaments.edge-cases.use-cases.test.ts)
  [awards.edge-cases.use-cases.test.ts › "two of a tournament's awards can't share a name, whatever the case: refused, and its awards stay as they were"](awards.edge-cases.use-cases.test.ts)
  [api.test.ts › "a tournament copies its series' rules and awards, and can change them for itself"](../api/api.test.ts)
- The Kumite's awards build to the champions: the judges' call, Top scorer, Best keeper, then Champions.
  [afters.test.ts › "the Kumite's order builds to it: the joke, Top scorer, Best keeper, then the champions"](../../src/lib/afters.test.ts)
- Every award says how it's decided: a stat we track, a vote, the judges' call, or a draw.
  [awards.test.ts › "says a stat, the judges' call and a draw in a few words"](../../src/lib/awards.test.ts)
- The champions are worked out, not entered: the final's winner, or the top of the table without one.
  [awards.test.ts › "with a final, the champions are its winner, even from second place"](../../src/lib/awards.test.ts)
  [awards.test.ts › "no final: the top of the table are the champions"](../../src/lib/awards.test.ts)
- The stats: most goals (level, most assists), most assists (level, most goals), most points (level, most goals),
  fewest goals against a game for a goalie, most penalty minutes (a bench penalty is nobody's). Still level: joint
  winners.
  [awards.test.ts › "most goals: level on goals, the most assists wins it"](../../src/lib/awards.test.ts)
  [awards.test.ts › "most assists, level on assists the most goals"](../../src/lib/awards.test.ts)
  [awards.test.ts › "most points, goals and assists together; level, the most goals"](../../src/lib/awards.test.ts)
  [awards.test.ts › "fewest goals against a game: the goalie whose team let in fewest"](../../src/lib/awards.test.ts)
  [awards.test.ts › "most penalty minutes, bench penalties nobody's"](../../src/lib/awards.test.ts)
  [awards.test.ts › "most goals, and joint winners on a tie"](../../src/lib/awards.test.ts)
- A vote is for those who played, never for yourself; Best keeper is the skaters' vote, for a goalie.
  [awards.voting.use-cases.test.ts › "only someone who played; for Best keeper, only the skaters, and only for a goalie"](awards.voting.use-cases.test.ts)
  [awards.voting.use-cases.test.ts › "never for yourself"](awards.voting.use-cases.test.ts)
- Voting opens with the last match played and closes as the awards are confirmed; one vote each, which stays.
  [awards.voting.use-cases.test.ts › "opens with the last match played, not before"](awards.voting.use-cases.test.ts)
  [awards.voting.use-cases.test.ts › "closes as the awards are confirmed: a vote after is refused"](awards.voting.use-cases.test.ts)
  [awards.voting.use-cases.test.ts › "one vote each: the same again is nothing, a different one is refused"](awards.voting.use-cases.test.ts)
- Votes are secret: the admin sees how many have voted, never who for.
  [awards.voting.use-cases.test.ts › "a skater votes for a goalie; the admin sees how many have voted, nobody's sent who for but the voter"](awards.voting.use-cases.test.ts)
- Most votes wins; level, the award's tie-break stat; still level, the admin chooses among them. Nobody voted, the
  admin chooses among everyone who could win it. The admin can't overrule a clear vote.
  [awards.voting.use-cases.test.ts › "level on votes, the tie-break: fewest goals against a game (Gus let in 1, Cole 3)"](awards.voting.use-cases.test.ts)
  [awards.voting.use-cases.test.ts › "level with no tie-break: the reply says who's level and nothing's saved; the admin chooses, then it is"](awards.voting.use-cases.test.ts)
  [awards.test.ts › "nobody voted: the admin chooses among everyone eligible (no tie-break deciding it for them)"](../../src/lib/awards.test.ts)
  [awards.voting.use-cases.test.ts › "an admin's say on a vote that isn't level doesn't count: the votes do"](awards.voting.use-cases.test.ts)
- The judges' call is the admin's on the night: they name it and choose a player who played. It's optional; one not
  made isn't revealed.
  [awards.voting.use-cases.test.ts › "the admin names it tonight and chooses who; everyone sees the name on the sealed card, the winner at the reveal"](awards.voting.use-cases.test.ts)
  [awards.voting.use-cases.test.ts › "the judges' call goes to a player who played"](awards.voting.use-cases.test.ts)
- A draw picks a player who played; Draw again draws another.
  [awards.voting.use-cases.test.ts › "Draw again: the admin confirms whoever the last draw gave"](awards.voting.use-cases.test.ts)
- An award saved before it said how it's decided is guessed from its name, once.
  [awards.test.ts › "Champions the table, a scorer most goals, a goalie fewest against, the Dim Mak a draw, anything else live"](../../src/lib/awards.test.ts)
- An admin confirms every winner at once, each a team or a player on one of the tournament's teams, for one of its own
  awards; one bad row refuses the lot. Members can't.
  [awards.use-cases.test.ts › "only the tournament's own awards, its own teams, and players on them"](awards.use-cases.test.ts)
  [awards.edge-cases.use-cases.test.ts › "an award goes to a team or a player, never both; one bad row refuses the whole list"](awards.edge-cases.use-cases.test.ts)
  [awards.use-cases.test.ts › "a member can't say who won"](awards.use-cases.test.ts)
- Confirmed again before the reveal, the last counts; once the reveal's started, it's refused.
  [awards.voting.use-cases.test.ts › "changed before the reveal, it's the last call that counts; once the reveal's started it's refused"](awards.voting.use-cases.test.ts)
- A vote landing as the awards are confirmed is counted or refused, never lost.
  [awards.voting.use-cases.test.ts › "a vote landing as they're confirmed (seed %i) is counted, or refused, never lost"](awards.voting.use-cases.test.ts)
- A member's votes are in their data download and go when they're erased.
  [awards.voting.use-cases.test.ts › "in their data download, and gone when they're erased"](awards.voting.use-cases.test.ts)
- The website shows a Kumite's own awards, and its winners once confirmed, the champions first.
  [website.kumite.use-cases.test.ts › "the next Kumite's own awards, changed in its editor: not the series'"](../website/website.kumite.use-cases.test.ts)
  [website.results.use-cases.test.ts › "award winners show once an admin confirms them, not before"](../website/website.results.use-cases.test.ts)
  [results.test.ts › "lists the champions first, though the team app reveals them last"](../../../web/src/lib/results.test.ts)
- Leaderboards are counted from the games, for points, goals, assists and penalty minutes: each in its own order, then
  points, then goals, nobody with none of it on it. Only games under way or played count.
  [leaders.test.ts › "each board in its own order, then points, then goals; nobody with none on that board"](../../src/lib/leaders.test.ts)
  [leaders.test.ts › "only games under way or played count: one not kicked off adds nothing"](../../src/lib/leaders.test.ts)
- The all-time leaders count every edition played.
  [editions.use-cases.test.ts › "all-time leaders count every one played"](editions.use-cases.test.ts)

## The after-party and the reveal

- The after-party starts when the last match is played (or an admin marks it finished) and lasts till 06:00 London the
  next morning; it's the evening the last match kicked off, whatever the date says.
  [afters.test.ts › "the last match played: on its evening, through midnight, till 06:00"](../../src/lib/afters.test.ts)
  [afters.test.ts › "an admin marking it finished counts as the last match played"](../../src/lib/afters.test.ts)
  [edition.edge-cases.test.ts › "the final kicked off after midnight: still that evening's after-party, till 06:00"](../../src/lib/edition.edge-cases.test.ts)
- Results typed in on another day go straight to history, with no after-party.
  [afters.test.ts › "results typed in on another day: no after-party, straight to history; nor one with only a season"](../../src/lib/afters.test.ts)
- All evening the series' page is the after-party, even with the next one scheduled; from 06:00 it moves on. Home's
  hero is the after-party.
  [afters.test.ts › "the evening it ends, the one just played is still the page's, even with the next one scheduled"](../../src/lib/afters.test.ts)
  [home-feed.lead.test.ts › "the hero is the after-party, ahead of the Kumite's own row and Friday's training"](../../src/lib/home-feed.lead.test.ts)
- A Kumite goes to The Anchor afterwards unless its series or the Kumite itself says otherwise (somewhere else, or
  nowhere).
  [afterwards.use-cases.test.ts › "a new Kumite goes to The Anchor afterwards, for the celebration and awards, without anyone saying so"](afterwards.use-cases.test.ts)
  [afterwards.use-cases.test.ts › "one Kumite can go somewhere else afterwards, at its own time, and the next one's back at The Anchor"](afterwards.use-cases.test.ts)
  [afterwards.use-cases.test.ts › "one Kumite can go nowhere afterwards this time, and back to the usual"](afterwards.use-cases.test.ts)
- Two steps: the awards are confirmed, then revealed. No reveal before they're confirmed, or before the last match.
  [awards.reveal.use-cases.test.ts › "the awards confirmed first: a reveal before then is refused, and so is one before the last match"](awards.reveal.use-cases.test.ts)
- Whoever runs it reveals them one at a time, in the order listed; the champions are the finale wherever they're
  listed.
  [awards.reveal.use-cases.test.ts › "revealed in the admin's order, wherever they list the champions: the finale's card is theirs wherever it is"](awards.reveal.use-cases.test.ts)
  [afters.test.ts › "the table decides it, whatever it's called and wherever it's listed"](../../src/lib/afters.test.ts)
- A member isn't sent an award's winner on the night until it's revealed; from 06:00 every winner is everyone's.
  [awards.reveal.use-cases.test.ts › "revealed in the order listed, the champions last; members see each only once it's out"](awards.reveal.use-cases.test.ts)
  [awards.reveal.use-cases.test.ts › "the evening over (06:00), every winner is history, revealed or not"](awards.reveal.use-cases.test.ts)
- Each card turned over and each roll of the drum reaches every phone in the room with the hub's event, nothing read;
  a winner still sealed is never in the event, for anyone. A phone that missed a change reads the drum.
  [live.reveal.use-cases.test.ts › "each card turned over and each roll of the drum reach every phone with nothing read"](../live/live.reveal.use-cases.test.ts)
  [live.reveal.use-cases.test.ts › "a winner still sealed is never in the event, for anyone"](../live/live.reveal.use-cases.test.ts)
  [live.reveal.use-cases.test.ts › "a phone that missed a change reads the drum, as before"](../live/live.reveal.use-cases.test.ts)
- Only whoever runs it reveals; a double tap, or two phones at once, moves it once.
  [awards.reveal.use-cases.test.ts › "a member can't reveal one, or roll the drum on"](awards.reveal.use-cases.test.ts)
  [awards.reveal.use-cases.test.ts › "a double tap moves the drum once: the second tap finds it moved, and does nothing"](awards.reveal.use-cases.test.ts)
- Every phone sees the same moments, played from the change on the server; opened late, it's just where it is.
  [afters.test.ts › "anything else (opened late, a reload, a step back, a step missed) plays nothing"](../../src/lib/afters.test.ts)
  [awards.reveal.use-cases.test.ts › "anyone opening the app later sees what's out so far, and each roll reaches a page that's open"](awards.reveal.use-cases.test.ts)
- The reveal sends no push: everyone sees it on the page. Each reveal is on the record.
  [awards.reveal.use-cases.test.ts › "the reveal sends no push: everyone's watching the page"](awards.reveal.use-cases.test.ts)
  [awards.reveal.use-cases.test.ts › "each reveal is on the record"](awards.reveal.use-cases.test.ts)
- The last award out, it's Done: its page stays its results that evening, then it's history.
  [edition.edge-cases.test.ts › "the last one revealed: still its page that evening, its results, the stamp Done"](../../src/lib/edition.edge-cases.test.ts)
- Stepping back turns every award face down again; the results and the winners stay.
  [awards.reveal.use-cases.test.ts › "turns every award face down again, the drum back on the first; the results and the winners stay"](awards.reveal.use-cases.test.ts)
- The whole night, from the draw to the morning after, in a browser.
  [kumite.journey.test.ts › "The Kumite night"](../../tests/journeys/kumite.journey.test.ts)

## Past Kumites

- An admin records a Kumite from before the app in one go: its day, teams, matches (a final, if there was one), who
  scored where anyone remembers, and the awards. It's history at once: done, its awards out, never at an after-party,
  and nobody charged.
  [past.use-cases.test.ts › "it goes straight into history: done, champions, table, results, awards out, nobody charged"](past.use-cases.test.ts)
- Its matches are each team against every other once, with a final between the top two.
  [past-kumite.test.ts › "each team against every other once, scores kept as teams come and go; the final between the top two"](../../src/lib/past-kumite.test.ts)
- It's checked whole before anything goes in: a day gone by, two teams or more, members who exist, nobody on two
  teams, a scorer on their own team, a final last and not level, each award to someone who played.
  [past.use-cases.test.ts › "refuses a day still to come, a final that ends level, a scorer on the other team, an award to someone who didn't play: nothing goes in"](past.use-cases.test.ts)
  [past.use-cases.test.ts › "refuses one team, someone on two teams, someone who isn't a member, a final that isn't the last match: nothing goes in"](past.use-cases.test.ts)
- Scores only is fine; the all-time leaders count only goals with a named scorer.
  [past.use-cases.test.ts › "scores only: the all-time leaders count only the goals someone's named for"](past.use-cases.test.ts)
- Only someone who runs tournaments records one.
  [past.use-cases.test.ts › "a member who doesn't run tournaments can't record one"](past.use-cases.test.ts)
- On dev only, a Kumite can be played out on a past day, for testing.
  [past-day.use-cases.test.ts › "made, signed up for, and played out on that evening to its last award: history, with a whole evening behind it"](past-day.use-cases.test.ts)
  [past-day.use-cases.test.ts › "in production it isn't there at all; a member who doesn't run tournaments is refused"](past-day.use-cases.test.ts)
