# 0119. Leaderboards are worked out in the app from the goals and penalties, a tab each, under the table

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

The board showed only the table. A tournament records every goal (scorer, assist) and penalty
([0061](0061-fixtures-games-and-scoring.md)), so who's on top for points, goals, assists and penalty minutes can be
counted, for one edition and across a series' editions (#47). The website's stats are a separate job (#65,
[0100](0100-website-reads-tournament-results.md)).

## Decision

- **Worked out, never stored** (`lib/leaders.ts`), from the games the app already has: each player's goals, assists,
  points (the two together, as hockey counts them) and penalty minutes (`penaltyMinutes`, lib/penalties.ts; a bench
  penalty is nobody's). Only games under way or played count.
- **One board a stat**: Points, Goals, Assists, PIM, as the app's tabs (italic caps, the red slash), over one table
  showing every column with the chosen one bright. Each board is in its own order, then points, then goals; nobody
  with none of it is on that board; a place is shown only where it changes (ties share it).
- **Where**: under the table on The board (this tournament, each player's team under their name) and on a past
  one's page; across a series' editions, "All-time leaders" under the past ones on History (or the series' front
  page with nothing on).
- No goalie stats: we don't record shots or saves.

## Consequences

- Nothing new in the database or the Worker; the board follows every goal and penalty as it's recorded.
- All-time counts only editions the app recorded.
- A player's card doesn't show their totals yet (#47's last part).

## History

- 2026-10-21: Leaderboards for points, goals, assists and PIM on The board, a past one's page and History (#47).
