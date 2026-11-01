# 0130. A game is scored live by one person on its own page: the scoresheet, periods, penalties and the clock

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-24
- **Merges:** 0071, 0090

## Context

On the day, someone has to run the clock and keep the score while everyone else, at the rink or at home, wants to see
it. A result typed in afterwards wasn't enough, nobody wanted two phones scoring the same game, and whoever scores is on
a phone, out of breath. The games themselves are made as the fixtures ([0061](0061-fixtures-games-and-scoring.md)); this
was part of that record until 2026-10-24.

## Decision

### One game on at a time

- **Only the game up next is scored**: scoring, the clock and a typed-in result go on the first game in the day's order
  that isn't over; the next opens at full time. Anything else is a 409 ("Game N is up next").
- A game being played has a score but no result: the table counts only finished games. A level playoff can't be called
  at full time: it plays on and the next goal wins. Nor can it be left level after: a typed-in result can't say level,
  and an admin can't take off a goal that would leave it so (409: put the right score in instead).

### Who keeps score

- **A team sitting the game out is suggested** (`scorekeepers`): in the day's order, each game goes to a team not
  playing in it, turns spread evenly. It's a suggestion, shown on the fight card, the tournament's home and the game.
- **One person holds the scoresheet** (`keeper_member_id`): only they run the clock and log goals (403 for anyone else).
  Anyone can take it on while nobody has, for the game up next or on now. They let go with **Hand over**, under Scoring
  in the top bar. They're done with a game at full time.
- **An admin takes over, or frees it** (#116), behind the game page's Manage (`POST …/scorer/admin`,
  `manage:Tournament`): **Take over scoring** makes them the scorekeeper in one tap, from where the game is (the
  scorekeeper's phone died, or they had to go); **Free the scoresheet** lets it go for anyone to take on (an admin not
  at the rink). Each asks first, the yes in red. The request says who the admin's page saw holding it, and the statement
  changes it only while it's still theirs and the game isn't over, so two admins at once leave one scorekeeper and the
  other is told who has it ([0121](0121-load-and-concurrency.md)). On the record as `game.keeper_changed`, from whom to
  whom; holding your own sheet stays off it.
- **The old scorekeeper's phone hears it live** ([0072](0072-live-updates.md)): its tools and pickers close, it buzzes,
  and the line under the clock says who's taken over ("You're off the clock"). Every write a scorekeeper sends (the
  clock, goals, penalties, Undo) lands only while they still hold the sheet, decided in its statement, so a tap from the
  old phone is refused (403, "Someone else is keeping score"), never landed after the take-over.
- **The Fight card says who's scoring** each game until it's over ("Scored by Dan", a red whistle, after Game N of M on
  lib/GameCard), the tournament's home and the day's carousel too, so an admin sees it without opening each game. When
  it's you, the header's red whistle says so and the eyebrow doesn't repeat it.

### A game's pages

- **A tap on a game's row opens the matchup** (`/tournaments/:slug/games/:id`, Matchup.svelte; no Details button, Live
  is the row's one button): the two teams face to face (crest, name, record so far; the score once there is one, else
  the kick-off), both squads, the goals once it's played, and **when the captains' sides last met** in past tournaments
  of the series (`lib/matchups.ts`: games with one on each side, as captain or player; teams are drafted afresh, so it's
  the people who carry over).
- **Live is the same page for everyone** (`/games/:id/live`, Game.svelte), from each fight card row still to be played
  and from the matchup: the clock, the score and the goals as they go in. Its back link always returns to the
  tournament's page (the Fight card), wherever it was opened from.
- Under the clock it says who's keeping score, or "Nobody's keeping score" with a **Keep score** button. Taking it on is
  never the page's big button, so someone following from home can't take it by accident.

### The scoresheet

- Kept simple for a phone: the clock, one big button right under it (Start the game, Pause; Full time once time's up,
  which opens the review), with clear space before Goal for each side, and the goals. The clock itself isn't a button.
  Scorer and assist (both optional, both on that team) open in a side drawer, full width on a phone.
- **Set the time** by tapping the clock (the scorekeeper's, once started): a sheet with minutes and seconds left, or
  nudged by 10 seconds or a minute; never more than an hour; paused stays paused, running runs on.
- **Scoring**, a red whistle button in the top bar, says this phone is the scoresheet and opens the scorekeeper's tools:
  take back the last goal, full time early, hand over. A sheet on a phone, a side drawer on a desktop
  ([0065](0065-page-frame-and-admin-actions.md)). No banner above the clock: on a phone the clock and the goal buttons
  need the screen.
- **Full time** opens a review over the page (lib/SealResult, a tall sheet on a phone, a side drawer on a desktop): the
  final score with both teams, every goal and penalty in order, the last goal to take back and Set the time, and one
  main button, **Seal the result**, which makes the score the result and fills the playoffs. The Kumite's carries its 決
  (sealed) mark, stamped down as it's pressed; other series', plain. Called early, the clock stops while it's looked
  over. Until it's sealed the match stays live for everyone; a level playoff can't be sealed and plays on.
- **A game starts whenever its scorekeeper starts it**, on the tournament's day or another: nothing is asked and nothing
  moves; the tournament's day stays as an admin set it.
- **A tournament's hours are only an admin's to change**, in its editor. However early or late the matches really start,
  the time it was set for stays (it's what everyone was told); each match keeps its own actual start.
- **Each match keeps when it actually kicked off** (`tournament_games.started_at`): set by the first Start of its clock,
  once, in that statement (`COALESCE(started_at, ?)`, [0121](0121-load-and-concurrency.md)), so a pause, a restart or
  the next period never moves it; cleared when the match is put back to not played (Back from Results, Move to… back). A
  result typed in has none. Once it's on or played the card shows it in place of the scheduled kick-off (`matchTime`,
  the same slot, room for the longest time); the match's page says "Full time · Started 7:52pm, set for 7:45pm".
  Upcoming matches keep their scheduled times.

### Periods and the box score

- **A game is 1 to 3 periods** (`periods`, a series setting beside the rules, as taps, copied onto each tournament like
  the penalty rule; a new series and the Kumite have 1). Game minutes are the minutes in each period. A game's slot on
  the day is its periods times those minutes, the breaks between them, plus the changeover (`slotMinutes`), so kick-off
  times and the schedule's words (`gameLength`: "games of 3 × 12-minute periods, 2-minute breaks") follow it.
- **A break between periods** (`break_minutes`, a series setting in minutes beside Periods, 0 to 15, copied onto each
  tournament; a new series 2, the Kumite 0 with its one period). When a period ends the game keeps when
  (`tournament_games.period_ended_at`), and everyone's clock, the scorekeeper's and the live page's, shows the break
  counting down in place of the paused clock ("Break · 2nd period next"), then "Break's over · 2nd period next".
  Starting the next is still the scorekeeper's tap, early if they like; it ends the break.
- **The clock runs per period** (`tournament_games.period`). At zero, before the last period, the scorekeeper's phone
  ends it (or End the period in Scoring's tools): the next starts paused at full length, and the screen says "2nd
  period"; the clock action names the period it ends, so a second phone or a retry changes nothing. After the last it's
  full time, as before. A sound at zero and scoring offline are still #45.
- **Goals and penalties keep their period** beside the time into it (`period`, null with no time; an admin's after the
  game says which). The penalty clock works in game time across the breaks (`inGameTime`), so a penalty late in one
  period carries into the next.
- **The box score** (`lib/BoxScore`, `lib/periods.ts` boxScore) is on the live page and the played game's matchup: a row
  a team, its goals per period then T (just T for one period), tabular numbers, no rules between rows, the winner bright
  and the loser faded as on the fight card; no shots (we don't count them). Under it, the goals and penalties
  (`lib/GameTimeline`, shared by both pages) under each period's name, or no heading for one period.

### Penalties

- **Kept the way goals are**: under each team's Goal, a quieter **Penalty** (a ghost button) opens a drawer, a tall
  sheet on a phone ([0065](0065-page-frame-and-admin-actions.md)), every choice a tap, no drop-downs, in this order:
  - **For**, always said (`lib/penalties.ts` INFRACTIONS). Player infractions (tripping, hooking, high stick, slashing,
    interference, holding, roughing, unsportsmanlike, other) need **who** (Save waits, saying "Pick who it's on"; the
    Worker refuses one on nobody: "Who's it on?"). Bench infractions (too many players, delay of game, bench minor) may
    be on nobody, a **Bench** penalty; too many players and a bench minor start on Bench and are always a minor (the
    other lengths off; the Worker refuses them).
  - **Who**: Bench, then that team's players.
  - **Length**: Minor 2, Double minor 4 as 2+2, Major 5. The sheet starts on the **usual penalty**
    (`default_penalty_minutes`), a series setting beside Penalties, copied onto each tournament (a new series and the
    Kumite: Minor); the Worker takes it when none is said. Too many players and a bench minor stay 2.

  It's stamped with the game clock. The same rules as a goal: only whoever holds the scoresheet while it's on; once it's
  over, only an admin, at the time they say or none.

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
- `tournament_penalties` holds each: game, team, member (or none, a bench penalty), minutes, infraction, game time, who
  recorded it and when. Penalty minutes per player and team (the leaderboards' PIM, #47) are their sum
  (`penaltyMinutes`).
- **The penalty clock is worked out, never stored** (`lib/penalties.ts`): a penalty runs in game time from when it was
  given, so it stops when the game clock does, and clears when served. **A player serves one at a time**: a second given
  while they're still serving one starts when that one ends (in both rules), and the team's a player short, not two; the
  clock shows it waiting, "then 2:00". A bench penalty is nobody's, so it starts when given. **Coincidental penalties**
  (called on both teams at the same game time, so the same stoppage) cancel out in pairs of the same length (minor with
  minor, double with double, major with major; a major against a minor doesn't): a pair is served in full with the
  players replaced, so no man advantage and no goal ends them. One minor each with nothing else on the clock is the
  exception: four on four, both a player short. They come out at the next stoppage after their time; we don't record
  stoppages, so they're served when it runs out. The clock's cue says the strength, home first ("Live · 5 on 4", "4 on
  4"; `playersShort`, `manpower`). A goal against a team with more players short than the scorers, counting only what
  doesn't cancel (a power-play goal), ends that team's earliest running minor that isn't coincidental; a major runs its
  five minutes. Sitting out, there's never a man advantage, so none of this applies. A double minor is one penalty of 4
  (its minutes count 4) served as two minors back to back, one clock from 4:00 marked 2+2: a power-play goal in its
  first two starts the second two fresh from the goal; in its second two, it ends it. Under each team's score, while the
  game's on, two lines are kept for who's in the box and the time left, so nothing moves when one's called or served.
- **Taken back and put right like goals**: Take back the last penalty in Scoring's tools; an admin adds or takes any off
  a finished game in Edit the result. On the record as goals are: not tap by tap, but in the game's result at full time
  and with each fix after (`game.scored` carries `penaltyMinutes`).
- They show in time order with the goals, on the live page (live viewers get them as goals,
  [0072](0072-live-updates.md)) and on the matchup once it's played: `12:04 · PIM 2 · Dan · Tripping`, or `Bench · Too
many players`; a player's minutes are a badge in the teams.

### The clock and updates

- The clock is stored as time left and when it last started (`clock_left_ms`, `clock_started_at`), so it survives a
  reload or a locked phone. It never ticks on the server or in storage: each phone counts down by itself, and only
  start, pause, set, goals, penalties and full time are sent. Holding ticks in a cookie was turned down: a cookie rides
  on every request, and the server would lag the pitch.
- Everyone on a live page, the scorekeeper too, gets changes as [0072](0072-live-updates.md) sets out.

### Putting a result right

- **The score is always its goals** (`tournament_goals`: team, scorer, assist, game time or none). On the game's page an
  admin can Edit the result: add a goal (who, assist, when or "don't know when"), take any one off, or set the score,
  which adds or removes nobody-said-who goals with no time to match. For the game up next, Enter the result records it
  played 0–0 and opens Set the score.

## Consequences

- `tournament_goals` opens up top scorers and assists ([0044](0044-champions-and-awards.md) uses them).
- `tournament_penalties` gives the leaderboards their penalty minutes ([0044](0044-champions-and-awards.md)).
- A link to a game's live score is `/live`; the home page's keep-score duty goes there.
- Few requests while a game's on, inside the free Worker allowance ([0055](0055-degrade-instead-of-break.md)).

## History

- 2026-10-08: Live scoring: one person holds the scoresheet, a clock each phone counts down, goals with scorer and
  assist, only the game up next, an admin puts results right, the score is always its goals (was 0071).
- 2026-10-08: How often live pages update became an admin setting (now ADR 0072).
- 2026-10-09: A matchup page; Live is one page for everyone; Keep score taken on deliberately (was 0090).
- 2026-10-09: Set the time is a tap on the clock; Scoring in the top bar opens the tools (ADR 0065).
- 2026-10-09: A tap anywhere on a game's row opens its matchup.
- 2026-10-21: Penalties, kept the way goals are, with a penalty clock and power plays or a penalty shot by series;
  periods, 1 to 3, and a box score (#45, in part).
- 2026-10-21: The usual penalty length is a series setting.
- 2026-10-21: A second penalty while serving one starts when that one ends.
- 2026-10-21: Coincidental penalties cancel; one minor each is four on four.
- 2026-10-21: A break between periods, a series setting.
- 2026-10-21: Penalty minutes are on the leaderboards ([0044](0044-champions-and-awards.md)).
- 2026-10-21: Taps at once: a period's end moves on once; nothing lands after full time (#114,
  [0121](0121-load-and-concurrency.md)).
- 2026-10-22: An admin takes over a game's scoresheet in one tap, or frees it; the old phone hears it and its writes
  stop (#116).
- 2026-10-23: A game you're scoring doesn't say "Scored by you" as well.
- 2026-10-23: A tournament's hours stay as an admin set them; each match keeps when it actually kicked off
  (`started_at`).
- 2026-10-23: The game's page goes back to the tournament's page.
- 2026-10-23: Starting a game on another day no longer asks or moves the day.
- 2026-10-23: Full time opens a review, and Seal the result is full time.
- 2026-10-23: Each goal and penalty tap carries an id (`tapId`), so one tap is one goal; Undo names what it takes off
  (#114).
- 2026-10-23: Taking a goal off a finished playoff that would leave it level is refused (#123).
- 2026-10-24: Split out of ADR 0061, whose fixtures it isn't; History a line per change.
