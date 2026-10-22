# 0044. Awards are set in the team app; champions and winners come from the results, an admin confirms

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-22
- **Merges:** 0073

## Context

The Kumite's awards, and who won them, were in Sanity. The club wants to set them where it runs tournaments, with fun
ones that carry a line on what they're for, and each series may give different awards. The app's results already say
who won most of them.

## Decision

### The awards

- A series holds its awards as JSON (`tournament_types.awards`: `{ name, about }`, up to 8), copied onto each
  tournament (`tournaments.awards`) where it can be changed, like the rules
  ([0030](0030-training-and-tournament-schedule.md)). The Kumite starts with Champions, Top scorer, Best goalie and
  The Dim Mak (fastest goal from a faceoff; one touch, lights out).
- The website takes the Kumite's awards from the build's club snapshot (`scripts/club-snapshot.mjs`, which also takes
  the roster, [0043](0043-roster-and-names.md)): the next public Kumite's own awards, else the series'. Names on the
  home page, names and lines on `/kumite/`. Sanity's _Awards_ list is the fallback until the snapshot has them.

### The champions

- **Worked out, not entered** (`champion` in `lib/fixtures.ts`): with playoffs, whoever wins the last one (the final);
  without, the top of the table once every game's played ([0061](0061-fixtures-games-and-scoring.md)). A playoff can't
  end level, so a final always crowns someone once it's played.
- Shown on the tournament's home and the board (`ChampionCard`), and marked in the table.

### Who won each award

- **The data decides; an admin confirms** (`lib/awards.ts`, by the award's name): Champions, the champion team; Top
  scorer, most goals, then most assists, still level is joint winners; Best goalie, the goalie (position G) whose team
  let in fewest a game; the Dim Mak (or any fun one), a player drawn at random, with Draw again. Only an award the data
  can't decide asks the admin to pick.
- The page shows the data's picks as Provisional; **Confirm the awards** (the Awards section, or Manage, built for a
  phone) saves them.
- Saved in `tournament_award_winners` (`worker/tournaments/awards.ts`): a team or a player on one of the tournament's teams, for one
  of its own awards, the whole list set at once (`PUT /api/tournaments/:id/winners`, `manage:Tournament`). Everyone
  gets it with the tournament (`winners`).

### Revealed at the after-party

- The evening a tournament ends, whoever runs it reveals the confirmed winners one at a time, in the order listed,
  at its after-party (ADR [0074](0074-tournament-home-and-scheduling.md)): `tournaments.awards_revealed` counts how
  many are out, and until an award is out a member isn't sent its winner that evening (nor shown a provisional pick
  in its place). From 06:00 the next morning every confirmed winner is everyone's again.

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
