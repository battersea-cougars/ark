# 0061. The app makes a tournament's fixtures: a round robin in the fairest order for everyone's breaks, then the playoffs

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-24

## Context

Games and Standings ran on sample data: nothing stored fixtures or results. A tournament's teams (a draft's captains or
the teams that entered) need a day of games: who plays whom, in what order, and the playoffs after. How each game is
scored on the day is [0130](0130-scoring-a-game-live.md), which was part of this record until 2026-10-24.

## Decision

### Fixtures and playoffs

- **Fixtures need two teams, nothing more**: a draft's captains ([0060](0060-the-draft.md)) or the teams that entered.
  An admin has the app make them: a round robin (every team plays every other once, paired by the circle method), then
  the playoff games the tournament's settings ask for. They can be made again until a game has a result; then they're
  set (409). A captains' draft makes them as it closes, in the same tap (Close draft & make fixtures,
  [0060](0060-the-draft.md)), unless they're already made. **An admin can clear them** (`DELETE …/fixtures`,
  `manage:Tournament`): every match, its result, goals, penalties and scoresheet, in one batch, to be made again; the
  app says first how many results and goals go. Reopening a draft can clear them the same way (0060). On the record as
  `fixtures.cleared`, with what there was.
- **The Fight card is every game in the day's order**, each the same card as on the tournament's home (lib/GameCard),
  grouped under a header: Round robin, then Playoffs. One scroller (lib/list-scroll.ts): the page scrolls until the
  header reaches the top, then the cards pass in a box under it, never under a bar, and the header takes the name of the
  group in view. Each team's record under its name reads as a league writes it: 1-1-0 · 2 Pts. A round robin card
  doesn't say its stage again; a playoff's keeps its name (Semi-final, Final). The teams, the score, Game N of M.
  Players never see rounds.
- **The round robin is played in the order fairest to everyone's breaks** (`fairOrder`, one pitch, every pairing once,
  any game anywhere in the day, not round by round), judged rule by rule: (1) the shortest break anyone gets (games in
  between) as long as it can be; (2) that shortest break as few times for any one team, then as few in all; (3) nobody
  waiting long for a first game, then everyone's breaks adding up to about the same; (4) the last group game's two teams
  coming into it as rested as can be, since one of them may well go straight into the first playoff (who's in the
  playoffs depends on results, so that's all that's knowable); (5) breaks as even as can be. The best there is: 3 or 4
  teams, someone has to play twice running (3: never the same team twice; 4: two back-to-backs, two different teams); 5
  or 6, everyone gets a game off; 7 or 8, two; in general (teams − 3) ÷ 2, rounded down (a longer break needs more teams
  than a run of games holds, or with an even number the same pairing again). Played round after round, 5 and 7 teams
  lost a game's break at each turn of a round; 4, 6 and 8 already had the longest break, but more teams got it short.
  Exact up to 7 teams (a branch-and-bound search, checked against every order there is; 8 is the best of 200,000 steps)
  and the same every time for the same teams. **Made again, another order just as fair**: the first Make is the fairest
  order itself; each Make again picks a different one, tied with it on every rule, never the one there was: the table's
  order or one of its turns (backwards, or started part way round) that scores the same (`fairness`), the teams dealt
  into its places at random (teams are alike to every rule), and maybe every side swapped. No new search, so it stays
  inside the CPU budget; random from `crypto.getRandomValues`, a seed for tests. The search takes up to a fifth of a
  second, over the Worker's 10 ms ([0003](0003-free-tiers-only.md)), so its answers for 2 to 8 teams are a table in
  `lib/fixtures.ts` (a test checks it against the search); more teams get a short search from the greedy order. Sides
  then take turns: a pairing keeps the circle method's home side unless swapping evens out home and away (within one for
  everyone). Each group game is its own round, in the day's order; the playoffs a round after. The Rules sheet's Format
  says so: "The order gives everyone the longest break it can: nobody plays twice running unless it can't be helped."
- **Playoffs** are a setting copied from the series like the rules ([0030](0030-training-and-tournament-schedule.md)): a
  list of games by table position, each with a name, e.g. Final (1 v 2), or Final and 3rd place. None is fine.
- `tournament_games` holds each game: stage (group / playoff), round, its place in the day's order, teams, the playoff's
  seeds, the score, status (next / live / done), the clock and who keeps score. When the last group game has its result,
  the playoffs get their teams from the table (points, goal difference, goals for). A group result put right afterwards
  fills again only the playoffs still to start (status next, no goals): one being played or over keeps its teams.
- `lib/fixtures.ts` (round robin, table, scorekeepers, `matchTime`) is shared by the Worker and the app.

## Consequences

- Games and Standings show the real tournament, as it's played.
- The fairest order is a table for 2 to 8 teams, worked out ahead, so making the fixtures stays inside the Worker's CPU
  time; a test checks the table against the search.
- Making them again gives another order just as fair, never the same one.

## History

- 2026-10-07: The app makes a round robin and playoffs once the teams are set; results entered after a game (was 0061).
- 2026-10-07: Fixtures need only two teams, not a closed draft (in 0060's merge, was 0066).
- 2026-10-09: The Fight card is every game as the same card as the tournament's home; the rounds no longer show.
- 2026-10-21: The Fight card groups its games under a header that stays (Round robin, Playoffs).
- 2026-10-22: A group result put right while a playoff's being played no longer changes that playoff's teams (#122).
- 2026-10-22: A draft's close makes the fixtures in the same request, keeping any already made
  ([0060](0060-the-draft.md)).
- 2026-10-22: An admin clears the fixtures, results and all, to make them again.
- 2026-10-22: The round robin's order is fair to everyone's breaks (`fairOrder`), not round after round; each group game
  is its own round.
- 2026-10-22: Making the fixtures again picks another order just as fair.
- 2026-10-24: Scoring a game split out to ADR 0130; History a line per change.
