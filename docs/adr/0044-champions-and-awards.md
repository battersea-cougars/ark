# 0044. Awards are set in the team app, each saying how it's decided: a stat, a vote, the judges' call or a draw; an admin confirms them, then reveals them

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-23
- **Merges:** 0073

## Context

The Kumite's awards, and who won them, were in Sanity. The club wants to set them where it runs tournaments, with fun
ones that carry a line on what they're for, and each series may give different awards. The app's results already say
who won most of them.

## Decision

### The awards

- A series holds its awards as JSON (`tournament_types.awards`: `{ name, about, decidedBy }`, up to 8, no two with
  the same name), copied onto each tournament (`tournaments.awards`) where it can be changed, like the rules
  ([0030](0030-training-and-tournament-schedule.md)). The Kumite starts with, in the order they're revealed (the joke
  first, the champions the finale): The Judges' Call ("Chosen on the night. The judges' decision is final."), Top
  scorer, Best goalie ("Voted by the skaters they stopped.") and Champions.
- **Every award says how it's decided** (`decidedBy`, `lib/awards.ts`), chosen in the series' editor and each
  tournament's own (`lib/AwardsField`, an admin's form, so a drop-down), replacing the guess from its name the app used
  to make every time:
  - **A stat we track** (`{ kind: "stat", stat }`), from what the app records (results, goals with scorer and assist,
    penalties with minutes): `table`, the top of the table, the champions (`champion` in `@cougars/shared/results`, a
    team); `goals`, most goals, level on goals most assists; `assists`, most assists, then most goals; `points`
    (goals + assists), then most goals; `goalsAgainst`, fewest goals against a game, a goalie (position G) by their
    team's games; `penaltyMinutes`, most penalty minutes (a bench penalty is nobody's). Still level after that: joint
    winners. Top scorer is `goals`, as it always was; Champions is `table`.
  - **A vote** (`{ kind: "vote", voters, tieBreak? }`): `players`, everyone who played votes for anyone who played;
    `skaters`, the skaters who played vote for a goalie who played (goalies don't vote for it). Best goalie is the
    skaters', its tie-break `goalsAgainst`. Open from the last match played until the awards are confirmed; one vote a
    voter an award, secret (nobody's sent who voted for whom but the voter, and it isn't on the record), never for
    yourself, and a vote cast stays (the same again is nothing, a different one is refused). Most votes wins; level
    (none cast is everyone level at nought), the tie-break stat among the level ones; still level, or no tie-break,
    the admin chooses among them. The admin sees how many have voted, never who for.
  - **The judges' call** (`{ kind: "live", options }`, the admin's call on the night): as they confirm, the admin names
    it tonight, one of its names ("Fastest Looking Skates", "Most Shoulder Fakes", "Most Crossbars", "Smoothest
    Crossovers", "Best Celly", "Most Dramatic Fall", "Loudest Stick Tap") or their own, and chooses who won it. The
    name is stored with its winner (`tournament_award_winners.title`) and shown in the award's place, on the sealed
    card for everyone once confirmed, on the website after.
  - **Drawn at random** (`{ kind: "random" }`): a player who played, with Draw again, as the Dim Mak was.
- **Saved before it said how** (an award with no `decidedBy`), it's guessed from the name as before (`decidedByOf`):
  Champions the table, a scorer most goals, a goalie fewest against, a Dim Mak (or anything random, lucky or fun) a
  draw, anything else the judges' call. The Worker writes the guess in when the awards are next saved, and an editor
  shows it, so it's mapped once and old data still works.
- The website takes the Kumite's awards from the build's club snapshot (`scripts/club-snapshot.mjs`,
  `scripts/lib/kumite-sql.mjs`; it also takes the roster, [0043](0043-roster-and-names.md)): a Kumite's own awards,
  the next public one's, else the last public one held's; the series' only before there's been any. Names on the home
  page, names and lines on `/kumite/`. Sanity's _Awards_ list is the fallback until the snapshot has them.

### The champions

- **Worked out, not entered** (`champion` in `lib/fixtures.ts`): with playoffs, whoever wins the last one (the final);
  without, the top of the table once every game's played ([0061](0061-fixtures-games-and-scoring.md)). A playoff can't
  end level, so a final always crowns someone once it's played.
- Shown on the tournament's home and the board (`ChampionCard`), and marked in the table.

### Who won each award: confirmed before the reveal

- **The after-party has two steps** ("the natural place for the voting and final award selection is pre award
  reveal", the user, 2026-10-23). First **Confirm the awards** (`lib/AwardsDrawer`, from the after-party's card or
  Manage, built for a phone): the stats and draws as the data has them (Provisional on the page till then) for the
  admin to check, choose someone else or Draw again; each vote's count so far ("7 of 12 voted · counted when you
  confirm"); the judges' call to make (Make the call: what it is tonight, who), and Confirm stays off, saying what's
  still to choose, till it's made. Members who played see **Cast your vote** meanwhile (`lib/CastYourVote`: one sheet,
  each award a list of who they can vote for, `lib/PeopleChoice`, no drop-down), on the after-party and on the
  KUMITE! day once the last match is done.
- **Confirming** (`PUT /api/tournaments/:id/winners`, `manage:Tournament`) saves every winner at once
  (`tournament_award_winners`, `worker/tournaments/awards.ts`): a team or a player on one of the tournament's teams,
  for one of its own awards; a vote's counted by the Worker from the votes (`countVotes`, the same rules as the app),
  never the admin's to say, unless it's level after its tie-break, when the reply says who's level (`tied`), nothing's
  saved, and the admin chooses among them and confirms again. It sets `tournaments.awards_confirmed_at`, which closes
  voting (`POST /api/tournaments/:id/votes`, anyone who played, ADR [0024](0024-action-based-authorization.md):
  refused once confirmed). One batch, each statement going only while nothing's revealed and the votes are as counted
  (ADR [0121](0121-load-and-concurrency.md)): a vote landing as they're confirmed is counted (it's counted again) or
  refused, never lost; confirmed again before the reveal it's the last that counts; once the reveal's started it's
  refused (step back first). Everyone gets the winners with the tournament (`winners`), as below.
- A member's votes are in their data download and go when they're erased (`members.erase.ts`).

### Revealed at the after-party

- Then the reveal: the evening a tournament ends, whoever runs it reveals the confirmed winners one at a time, in the
  order listed, at its after-party (ADR [0074](0074-tournament-home-and-scheduling.md)): `tournaments.awards_revealed`
  counts how many are out, and until an award is out a member isn't sent its winner that evening (nor shown a
  provisional pick in its place). From 06:00 the next morning every confirmed winner is everyone's again.

## Consequences

- A change to the awards reaches the website at the next build (daily in production), like the roster.
- The website shows the champions and the confirmed winners, read from D1 live
  ([0100](0100-website-reads-tournament-results.md)); provisional picks never leave the app.
- An award renamed after it was given keeps its winner under the old name until it's given again.

## History

- 2026-10-07: Awards moved from the Studio's Kumite list to the team app, per tournament type, onto the website through
  the club snapshot; winners stayed in Sanity (was 0044).
- 2026-10-08: Champions worked out from the results; award winners suggested from the data and confirmed by an admin,
  stored in the app (was 0073).
- 2026-10-09: The website reads champions and confirmed winners from D1 live, not Sanity `kumiteResult`
  ([0100](0100-website-reads-tournament-results.md)).
- 2026-10-22: Revealed one at a time at the after-party ([0074](0074-tournament-home-and-scheduling.md)); a member
  isn't sent a winner that evening before it's out.
- 2026-10-23: Each award says how it's decided (`decidedBy`): a stat we track (the table, goals, assists, points,
  goals against, penalty minutes), a vote (everyone who played, or the skaters for a goalie, with a tie-break), the
  judges' call (named on the night, its name stored with its winner) or a draw; replacing the guess from the name,
  kept once for awards saved before. Votes in `tournament_award_votes`, secret, one each, never for yourself. The
  Kumite's Dim Mak becomes The Judges' Call; Best goalie the skaters' vote; Top scorer most goals; Champions the table;
  listed (and revealed) joke first, champions last. Then "the natural place for the voting and final award selection
  is pre award reveal" (the user): voting closes, the votes are counted and the judges' call made when the awards
  are confirmed, before the reveal, one guarded batch.
- 2026-10-23: The judges' call's sheet has a Random on either half: a name from its list, or a winner from who
  played, another each press, the admin's to change.
- 2026-10-23: The judges' call is optional: confirming doesn't wait for it, and one not made (or left out) isn't
  revealed. Its names take in the ref too: "Most Calls Missed (the ref)", "Blindest Whistle (the ref)".
- 2026-10-23: Nobody voted: the admin chooses among everyone eligible, as on a tie, not the tie-break on its own (one
  eligible, they win it). "Keeper", as the club says it, in every word members read: the seed's Best keeper, One
  keeper a team, No keeper yet; the position was already Keeper.
- 2026-10-23: The champions' award says what it is: the final's winner (else the top of the table), "Last team standing…
  barely."; its reason reads Won the final or Top of the table, not From the results.
- 2026-10-23: Every Kumite award's line has a punchline, not all the same shape: "Bribes were accepted.", "Most goals. Some on purpose.", "Big glove… bigger excuses."
- 2026-10-23: Awards per Kumite, and the website follows (the user): each Kumite keeps its own (changed in its
  editor), and the website shows that Kumite's own, not the series': the next public one's, else the last public one
  held's (was: the series' whenever none was coming up). The series' awards stay the defaults a new Kumite copies.
