# 0061. The app makes a tournament's fixtures, and each game is scored live by one person on its own page

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-22
- **Merges:** 0071, 0090

## Context

Games and Standings ran on sample data: nothing stored fixtures or results. On the day, someone has to run the clock
and keep the score while everyone else, at the rink or at home, wants to see it. A result typed in afterwards wasn't
enough, nobody wanted two phones scoring the same game, and whoever scores is on a phone, out of breath.

## Decision

### Fixtures and playoffs

- **Fixtures need two teams, nothing more**: a draft's captains ([0060](0060-the-draft.md)) or the teams that entered.
  An admin has the app make them: a round robin (every team plays every other once, paired by the circle method),
  then the playoff games the tournament's settings ask for. They can be made again until a game has a result; then
  they're set (409). A captains' draft makes them as it closes, in the same tap (Close draft & make fixtures,
  [0060](0060-the-draft.md)), unless they're already made. **An admin can clear them** (`DELETE …/fixtures`,
  `manage:Tournament`): every match, its result, goals, penalties and scoresheet, in one batch, to be made again; the
  app says first how many results and goals go. Reopening a draft can clear them the same way (0060). On the record as
  `fixtures.cleared`, with what there was.
- **The Fight card is every game in the day's order**, each the same card as on the tournament's home
  (lib/GameCard), grouped under a header: Round robin, then Playoffs. One scroller (lib/list-scroll.ts): the page scrolls until the header reaches the top, then the cards pass in a box under it, never under a bar, and the header takes the name of the group in view. Each team's record under its name reads as a league writes it: 1-1-0 · 2 pts. A round robin
  card doesn't say its stage again; a playoff's keeps its name (Semi-final, Final). The teams, the score, Game N of M.
  Players never see rounds.
- **The round robin is played in the order fairest to everyone's breaks** (`fairOrder`, one pitch, every pairing
  once, any game anywhere in the day, not round by round), judged rule by rule: (1) the shortest break anyone gets
  (games in between) as long as it can be; (2) that shortest break as few times for any one team, then as few in
  all; (3) nobody waiting long for a first game, then everyone's breaks adding up to about the same; (4) the last
  group game's two teams coming into it as rested as can be, since one of them may well go straight into the first
  playoff (who's in the playoffs depends on results, so that's all that's knowable); (5) breaks as even as can be.
  The best there is: 3 or 4 teams, someone has to play twice running (3: never the same team twice; 4: two
  back-to-backs, two different teams); 5 or 6, everyone gets a game off; 7 or 8, two; in general (teams − 3) ÷ 2, rounded
  down (a longer break needs more teams than a run of games holds, or with an even number the same pairing again). Played round after round, 5 and 7 teams lost a game's break at each turn of a round; 4, 6 and 8 already had
  the longest break, but more teams got it short. Exact up to 7 teams (a branch-and-bound search, checked against
  every order there is; 8 is the best of 200,000 steps) and the same every time for the same teams. **Made again, another order just as fair**: the
  first Make is the fairest order itself; each Make again picks a different one, tied with it on every rule, never
  the one there was: the table's order or one of its turns (backwards, or started part way round) that scores the
  same (`fairness`), the teams dealt into its places at random (teams are alike to every rule), and maybe every side
  swapped. No new search, so it stays inside the CPU budget; random from `crypto.getRandomValues`, a seed for tests. The search takes
  up to a fifth of a second, over the Worker's 10 ms ([0003](0003-free-tiers-only.md)), so its answers for 2 to 8
  teams are a table in `lib/fixtures.ts` (a test checks it against the search); more teams get a short search from
  the greedy order. Sides then take turns: a pairing keeps the circle method's home side unless swapping evens out
  home and away (within one for everyone). Each group game is its own round, in the day's order; the playoffs a round
  after. The Rules sheet's Format says so: "The order gives everyone the longest break it can: nobody plays twice
  running unless it can't be helped."
- **Playoffs** are a setting copied from the series like the rules ([0030](0030-training-and-tournament-schedule.md)):
  a list of games by table position, each with a name, e.g. Final (1 v 2), or Final and 3rd place. None is fine.
- `tournament_games` holds each game: stage (group / playoff), round, its place in the day's order, teams, the
  playoff's seeds, the score, status (next / live / done), the clock and who keeps score. When the last group game
  has its result, the playoffs get their teams from the table (points, goal difference, goals for). A group result
  put right afterwards fills again only the playoffs still to start (status next, no goals): one being played or
  over keeps its teams.
- `lib/fixtures.ts` (round robin, table, scorekeepers, `startingToday`, `matchTime`) is shared by the Worker and the app.

### One game on at a time

- **Only the game up next is scored**: scoring, the clock and a typed-in result go on the first game in the day's
  order that isn't over; the next opens at full time. Anything else is a 409 ("Game N is up next").
- A game being played has a score but no result: the table counts only finished games. A level playoff can't be
  called at full time: it plays on and the next goal wins.

### Who keeps score

- **A team sitting the game out is suggested** (`scorekeepers`): in the day's order, each game goes to a team not
  playing in it, turns spread evenly. It's a suggestion, shown on the fight card, the tournament's home and the game.
- **One person holds the scoresheet** (`keeper_member_id`): only they run the clock and log goals (403 for anyone
  else). Anyone can take it on while nobody has, for the game up next or on now. They let go with **Hand over**, under
  Scoring in the top bar. They're done with a game at full time.
- **An admin takes over, or frees it** (#116), behind the game page's Manage (`POST …/scorer/admin`,
  `manage:Tournament`): **Take over scoring** makes them the scorekeeper in one tap, from where the game is (the
  scorekeeper's phone died, or they had to go); **Free the scoresheet** lets it go for anyone to take on (an admin
  not at the rink). Each asks first, the yes in red. The request says who the admin's page saw holding it, and the
  statement changes it only while it's still theirs and the game isn't over, so two admins at once leave one
  scorekeeper and the other is told who has it ([0121](0121-load-and-concurrency.md)). On the record as
  `game.keeper_changed`, from whom to whom; holding your own sheet stays off it.
- **The old scorekeeper's phone hears it live** ([0072](0072-live-updates.md)): its tools and pickers close, it buzzes,
  and the line under the clock says who's taken over ("You're off the clock"). Every write a scorekeeper sends (the
  clock, goals, penalties, Undo) lands only while they still hold the sheet, decided in its statement, so a tap from
  the old phone is refused (403, "Someone else is keeping score"), never landed after the take-over.
- **The Fight card says who's scoring** each game until it's over ("Scored by Dan", a red whistle, after Game N of M
  on lib/GameCard), the tournament's home and the day's carousel too, so an admin sees it without opening each game.
  When it's you, the header's red whistle says so and the eyebrow doesn't repeat it.

### A game's pages

- **A tap on a game's row opens the matchup** (`/tournaments/:slug/games/:id`, Matchup.svelte; no Details button,
  Live is the row's one button): the two teams face to face (crest, name, record so far; the score once there is one,
  else the kick-off), both squads, the goals once it's played, and
  **when the captains' sides last met** in past tournaments of the series (`lib/matchups.ts`: games with one on each
  side, as captain or player; teams are drafted afresh, so it's the people who carry over).
- **Live is the same page for everyone** (`/games/:id/live`, Game.svelte), from each fight card row still to be played
  and from the matchup: the clock, the score and the goals as they go in. Its back link returns to where it was opened.
- Under the clock it says who's keeping score, or "Nobody's keeping score" with a **Keep score** button. Taking it on
  is never the page's big button, so someone following from home can't take it by accident.

### The scoresheet

- Kept simple for a phone: the clock, one big button right under it (Start the game, Pause; Full time once time's up,
  tapped twice), with clear space before Goal for each side, and the goals. The clock itself isn't a button. Scorer
  and assist (both optional, both on that team) open in a side drawer, full width on a phone.
- **Set the time** by tapping the clock (the scorekeeper's, once started): a sheet with minutes and seconds left, or
  nudged by 10 seconds or a minute; never more than an hour; paused stays paused, running runs on.
- **Scoring**, a red whistle button in the top bar, says this phone is the scoresheet and opens the scorekeeper's
  tools: take back the last goal, full time early, hand over. A sheet on a phone, a side drawer on a desktop
  ([0103](0103-drawers-sheets-and-panels.md)). No banner above the clock: on a phone the clock and the goal buttons
  need the screen.
- **Full time** makes the score the result and fills the playoffs.
- **Starting the first game on another day asks first** ("The Kumite is on Fri 30 Oct. Start this game now? …"). Yes
  moves the tournament's day to today, its hours kept as set, its sign-up and draft days no later than the new day
  (`startingToday`), using the same save an admin makes in settings.
- **A tournament's hours are only an admin's to change**, in its editor. However early or late the matches really
  start, the time it was set for stays (it's what everyone was told); each match keeps its own actual start.
- **Each match keeps when it actually kicked off** (`tournament_games.started_at`): set by the first Start of its
  clock, once, in that statement (`COALESCE(started_at, ?)`, [0121](0121-load-and-concurrency.md)), so a pause, a
  restart or the next period never moves it; cleared when the match is put back to not played (Back from Results,
  Move to… back). A result typed in has none. Once it's on or played the card shows it in place of the scheduled
  kick-off (`matchTime`, the same slot, room for the longest time); the match's page says "Full time · Started
  7:52pm, set for 7:45pm". Upcoming matches keep their scheduled times.

### Periods and the box score

- **A game is 1 to 3 periods** (`periods`, a series setting beside the rules, as taps, copied onto each tournament
  like the penalty rule; a new series and the Kumite have 1). Game minutes are the minutes in each period. A game's
  slot on the day is its periods times those minutes, the breaks between them, plus the changeover (`slotMinutes`),
  so kick-off times and the schedule's words (`gameLength`: "games of 3 × 12-minute periods, 2-minute
  breaks") follow it.
- **A break between periods** (`break_minutes`, a series setting in minutes beside Periods, 0 to 15, copied onto
  each tournament; a new series 2, the Kumite 0 with its one period). When a period ends the game keeps when
  (`tournament_games.period_ended_at`), and everyone's clock, the scorekeeper's and the live page's, shows the
  break counting down in place of the paused clock ("Break · 2nd period next"), then "Break's over · 2nd period
  next". Starting the next is still the scorekeeper's tap, early if they like; it ends the break.
- **The clock runs per period** (`tournament_games.period`). At zero, before the last period, the scorekeeper's phone
  ends it (or End the period in Scoring's tools): the next starts paused at full length, and the screen says "2nd
  period"; the clock action names the period it ends, so a second phone or a retry changes nothing. After the last
  it's full time, as before. A sound at zero and scoring offline are still #45.
- **Goals and penalties keep their period** beside the time into it (`period`, null with no time; an admin's after
  the game says which). The penalty clock works in game time across the breaks (`inGameTime`), so a penalty late in
  one period carries into the next.
- **The box score** (`lib/BoxScore`, `lib/periods.ts` boxScore) is on the live page and the played game's matchup: a
  row a team, its goals per period then T (just T for one period), tabular numbers, no rules between rows, the
  winner bright and the loser faded as on the fight card; no shots (we don't count them). Under it, the goals and
  penalties (`lib/GameTimeline`, shared by both pages) under each period's name, or no heading for one period.

### Penalties

- **Kept the way goals are**: under each team's Goal, a quieter **Penalty** (a ghost button) opens a drawer, a tall
  sheet on a phone ([0103](0103-drawers-sheets-and-panels.md)), every choice a tap, no drop-downs, in this order:
  - **For**, always said (`lib/penalties.ts` INFRACTIONS). Player infractions (tripping, hooking, high stick,
    slashing, interference, holding, roughing, unsportsmanlike, other) need **who** (Save waits, saying "Pick who
    it's on"; the Worker refuses one on nobody: "Who's it on?"). Bench infractions (too many players, delay of game,
    bench minor) may be on nobody, a **Bench** penalty; too many players and a bench minor start on Bench and are
    always a minor (the other lengths off; the Worker refuses them).
  - **Who**: Bench, then that team's players.
  - **Length**: Minor 2, Double minor 4 as 2+2, Major 5. The sheet starts on the **usual penalty**
    (`default_penalty_minutes`), a series setting beside Penalties, copied onto each tournament (a new series and the
    Kumite: Minor); the Worker takes it when none is said. Too many players and a bench minor stay 2.

  It's stamped with the game clock. The same rules as a goal: only whoever holds the scoresheet while it's on; once
  it's over, only an admin, at the time they say or none.

- **How a penalty's served is a series setting, Penalties** (`penalty_rule`), beside the rules in the series' Defaults
  and copied onto each tournament, where it can differ (as the fee and game length are):
  - **Power play** (the standard, a new series' default): the player's in the box, the team plays short, and a
    power-play goal ends a minor (a double minor's running half).
  - **Penalty shot, player sits out** (the Kumite, `db/seed/club.sql`): the other team takes a penalty shot, not
    recorded; the player can't play for the length (2, 2+2 or 5), but nobody plays short and goals don't end it. The
    clock reads "Dan · sits out 1:42"; the timeline "4:10 · Penalty shot · Dan / Sits 2 · Tripping". A bench penalty
    (too many players) is a penalty shot with nobody sitting out: on the timeline, no clock.
  - The seed only adds what's missing, so a database that already has the Kumite keeps Power play until an admin sets
    Penalties on the series and its tournaments (or one `UPDATE`); production starts fresh with it.
- `tournament_penalties` holds each: game, team, member (or none, a bench penalty), minutes, infraction, game time,
  who recorded it and when. Penalty minutes per player and team (the leaderboards' PIM, #47) are their sum
  (`penaltyMinutes`).
- **The penalty clock is worked out, never stored** (`lib/penalties.ts`): a penalty runs in game time from when it
  was given, so it stops when the game clock does, and clears when served. **A player serves one at a time**: a
  second given while they're still serving one starts when that one ends (in both rules), and the team's a player
  short, not two; the clock shows it waiting, "then 2:00". A bench penalty is nobody's, so it starts when given.
  **Coincidental penalties** (called on both teams at the same game time, so the same stoppage) cancel out in pairs
  of the same length (minor with minor, double with double, major with major; a major against a minor doesn't):
  a pair is served in full with the players replaced, so no man advantage and no goal ends them. One minor each
  with nothing else on the clock is the exception: four on four, both a player short. They come out at the next
  stoppage after their time; we don't record stoppages, so they're served when it runs out. The clock's cue says
  the strength, home first ("Live · 5 on 4", "4 on 4"; `playersShort`, `manpower`). A goal against a team with
  more players short than the scorers, counting only what doesn't cancel (a power-play goal), ends that team's
  earliest running minor that isn't coincidental; a major runs its five minutes. Sitting out, there's never a man
  advantage, so none of this applies. A double minor is one penalty of 4 (its minutes count 4) served as two minors back to back, one clock
  from 4:00 marked 2+2: a power-play goal in its first two starts the second two fresh from the goal; in its second
  two, it ends it. Under each team's score, while the game's on, two lines are kept for who's in the box and the time left,
  so nothing moves when one's called or served.
- **Taken back and put right like goals**: Take back the last penalty in Scoring's tools; an admin adds or takes any
  off a finished game in Edit the result. On the record as goals are: not tap by tap, but in the game's result at
  full time and with each fix after (`game.scored` carries `penaltyMinutes`).
- They show in time order with the goals, on the live page (live viewers get them as goals, [0072](0072-live-updates.md))
  and on the matchup once it's played: `12:04 · PIM 2 · Dan · Tripping`, or `Bench · Too many players`; a player's minutes are a badge in the teams.

### The clock and updates

- The clock is stored as time left and when it last started (`clock_left_ms`, `clock_started_at`), so it survives a
  reload or a locked phone. It never ticks on the server or in storage: each phone counts down by itself, and only
  start, pause, set, goals, penalties and full time are sent. Holding ticks in a cookie was turned down: a cookie rides on every
  request, and the server would lag the pitch.
- Everyone on a live page, the scorekeeper too, gets changes as [0072](0072-live-updates.md) sets out.

### Putting a result right

- **The score is always its goals** (`tournament_goals`: team, scorer, assist, game time or none). On the game's page an
  admin can Edit the result: add a goal (who, assist, when or "don't know when"), take any one off, or set the score,
  which adds or removes nobody-said-who goals with no time to match. For the game up next, Enter the result records it
  played 0–0 and opens Set the score.

## Consequences

- Games and Standings show the real tournament, as it's played.
- `tournament_goals` opens up top scorers and assists ([0044](0044-champions-and-awards.md) uses them).
- `tournament_penalties` gives the leaderboards their penalty minutes ([0119](0119-tournament-leaderboards.md)).
- A link to a game's live score is `/live`; the home page's keep-score duty goes there.
- Few requests while a game's on, inside the free Worker allowance ([0055](0055-degrade-instead-of-break.md)).

## History

- 2026-10-07: The app makes a round robin and playoffs once the teams are set (the draft closed); results entered
  after a game (was 0061).
- 2026-10-07: Fixtures need only two teams, not a closed draft (in 0060's merge, was 0066).
- 2026-10-08: Live scoring: one person holds the scoresheet, a clock each phone counts down, goals with scorer and
  assist, only the game up next, an admin puts results right, the score is always its goals (was 0071).
- 2026-10-08: How often live pages update became an admin setting (now ADR 0072).
- 2026-10-09: Details opens a matchup page; Live is one page for everyone, Keep score taken on deliberately and handed
  over on the page; starting the first game on another day moves the tournament (was 0090).
- 2026-10-09: Set the time moved from Game tools to a tap on the clock; the keeping-score banner became Scoring in the
  top bar, opening the tools as a sheet on a phone; Stop scoring and Hand over are one (ADR 0103).
- 2026-10-09: The Details button went: a tap anywhere on a game's row opens its matchup.

- 2026-10-09: The Fight card is every game as the same card as the tournament's home; the rounds no longer show.
- 2026-10-21: The Fight card groups its games under a pinned header (Round robin, Playoffs) over a scrolling box; round robin cards drop their stage line; records read W-D-L · N pts.
- 2026-10-21: Penalties, kept the way goals are: Penalty under Goal (what for, who, Minor 2 / Double minor 2+2 /
  Major 5), a penalty clock in game time beside each team that a power-play goal cuts short, taken back and put right
  like goals, and shown with the goals in time order (`tournament_penalties`). What for comes first and is always
  said; a player's infraction needs who, a bench one (too many players, delay of game, bench minor) may be on nobody,
  and too many players and a bench minor are always 2 minutes. How it's served is a series setting copied onto each
  tournament: Power play, or a penalty shot with the player sitting out (the Kumite). Periods (1 to 3, a series
  setting copied onto each tournament): the clock runs per period, goals and penalties keep theirs, a game's slot is
  all its periods, and a box score with the timeline by period on the live page and the matchup (#45, in part).
- 2026-10-21: The usual penalty length (Minor 2, Double minor 2+2, Major 5) is a series setting copied onto each
  tournament; the penalty sheet starts on it, and a penalty called without a length takes it.
- 2026-10-21: Consecutive penalties: a player's second penalty, given while they're still serving one, starts when
  that one ends (power play and sitting out alike), shown waiting on the clock ("then 2:00").
- 2026-10-21: Coincidental penalties: same-length pairs called at the same time cancel (no man advantage, served in
  full), one minor each with nothing else on is four on four; only what doesn't cancel counts for a power play; the
  clock's cue shows the strength.
- 2026-10-21: A break between periods (a series setting in minutes, 2 unless said, the Kumite 0): it counts down on
  everyone's clock once a period ends, the scorekeeper starts the next when ready, and it's in each game's slot.
- 2026-10-21: Penalty minutes are on the leaderboards' PIM board (ADR 0119).
- 2026-10-21: Taps at once ([0121](0121-load-and-concurrency.md)): the end of a period sent by two phones moves on
  once; a goal, penalty or Undo landing as full time is called is refused, so the result is never changed after the
  whistle. The same goal from two phones is still two goals (#114).
- 2026-10-22: A group result put right while a playoff's being played no longer changes that playoff's teams: only
  one still to start takes them from the table, decided in its statement (#122).
- 2026-10-22: A draft's close makes the fixtures in the same request, keeping any already made ([0060](0060-the-draft.md)).
- 2026-10-22: An admin clears the fixtures, results and all, to make them again: alone, or as a draft reopens (0060).
- 2026-10-22: The round robin's order is fair to everyone's breaks (`fairOrder`), not round after round: the longest
  shortest break, shared out, nobody waiting long to start, the last group game's teams rested. The user asked "does
  making the fixtures employ an algo that tries to make the fixtures fair? ... from a break perspective", and said
  yes to adding it. Each group game is now its own round.
- 2026-10-22: Making the fixtures again shuffles between equally fair orders (the user's choice): the first Make is
  the fairest order; each Make again another tied with it on every rule, never the one there was, from the table's
  order by dealing the teams into its places, turning it round where that scores the same, and swapping sides.
- 2026-10-22: An admin takes over a game's scoresheet in one tap, or frees it, behind the game's Manage, decided in
  one statement from who their page saw holding it, on the record; the old scorekeeper's phone hears it live and its
  writes (the clock's too, now) go only while it holds the sheet; the Fight card says who's scoring each game.
  The Let it go button under the clock went (#116).
- 2026-10-23: A game you're scoring no longer says "Scored by you" as well as showing its red whistle: the eyebrow
  names only someone else.
- 2026-10-23: A tournament's hours stay as an admin set them: starting the first match on another day moves only its
  day to today (`startingToday`, was `startingNow`, which shifted its hours so that match kicked off now). Each match
  keeps when it actually kicked off (`started_at`, the first Start of its clock), and the card shows it once it's on.
