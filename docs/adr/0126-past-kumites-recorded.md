# 0126. A Kumite from before the app is recorded in one go, done and in history, its awards out

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

The club played Kumites before the app. Past Kumites ([0074](0074-tournament-home-and-scheduling.md)) and the
all-time leaders ([0044](0044-champions-and-awards.md)) only knew the ones the app ran: scheduled, signed up for,
drafted, scored and revealed on the night. Putting an old one in that way meant walking it through every step, on
today's clocks, which lands it at an after-party tonight. An admin needed to put one in after the fact: when it was,
its teams, its matches and their scores (a final, if it had one), who scored where anyone remembers, and who won each
award.

## Decision

- **One wizard, from the series' Manage** (`lib/PastKumiteRecord`, over the page: a side drawer on a desktop, a tall
  sheet on a phone, [0065](0065-page-frame-and-admin-actions.md)): **Record a past Kumite**, an admin's, whatever's on
  and with nothing on (where it's Manage's only job besides the dev tool, `lib/manage.ts historyItemsOf`). Steps: When
  (a day gone by), Teams (a name, a captain and players each, found by name; nobody on two), Matches (each team against
  every other once in the fair order, a score each, a final between the top two of the table if there was one, and
  who scored each goal, Not known by default), Awards (the champions and a stat's or a draw's winner filled in from the
  results, the rest chosen; Nobody where nobody remembers), then Check and Record it. Admin form, so drop-downs
  (`lib/Select`) for the scorers and winners. The logic is `lib/past-kumite.ts`.
- **One request** (`POST /api/tournaments/past`, `worker/tournaments/past.ts recordPast`, `manage:Tournament`):
  checked whole before anything's written (a day before today, two teams or more, members who exist, nobody on two
  teams, a scorer on the team they scored for, a final last and not level, each award the series' own and to a team
  or someone who played), then made as any tournament is (`createTournament`: its series' rules and awards, its teams
  and captains) and the rest in one batch: the draft's order as named and closed, the players and their sign-ups,
  every match `done` with its goals (a named scorer or nobody-said-who, none timed, no kick-off), the winners, the
  awards confirmed and every one revealed. On the record as `tournament.recorded`.
- **It's history at once**: done (status `finished`, every match played), played on its own day (no kick-off, so
  `lib/edition.ts playedOn` is its date), never at an after-party, every award out. Its page shows its champions,
  results, board and awards like any other.
- **Nobody's charged for it**: its fee is nought (paid at the time).
- **What the all-time leaders count**: a goal with its scorer named. Scores only is fine: the goals are there (the
  score is its goals, ADR 0130), counted in the table and the results, not for anyone.

## Consequences

- Old Kumites go in in a few minutes each, on production too, and Past Kumites and the all-time leaders read them as
  they read the app's own.
- Its rules and awards are the series' as they are now, not as they were then.
- Putting one right afterwards is the usual tools: a score or a goal on its match (an admin's correction, ADR 0130),
  its settings, Back to … for the awards; or delete it and record it again.

## History

- 2026-10-23: Recording a past Kumite, from the series' Manage, in one request.
