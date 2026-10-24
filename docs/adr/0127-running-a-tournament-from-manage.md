# 0127. An admin runs a tournament from Manage: the jobs its stage needs, a step back, or Move to any status

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-24

## Context

A tournament moves through its statuses ([0074](0074-tournament-home-and-scheduling.md)): sign-up, the draft, the teams,
the fixtures, the day, the after-party. Each move is a job for whoever runs it, and mistakes happen on the night: a
draft opened too soon, a result typed on the wrong match, a step the admin wants to try again. An admin also needs to
get a Kumite to a given status at once (to set up a night that was run on paper, or to try a later step). This was part
of 0074 until 2026-10-24.

## Decision

- **Manage** (the gear) holds every job, a row each, never a menu inside the menu, in the order they're needed: the step
  it's at first, then Back a step and Move to…, then a captain's own, the settings last. Which jobs it offers follow
  where the tournament stands, so nothing's there that makes no sense for it (`src/lib/manage.ts manageItemsOf`, pinned
  stage by stage and role by role in `manage.test.ts`). The day is split at the first match started: before it, the
  fixtures; after it, live.

  | Job                                    | Sign-up | Draft (order drawn, open) | Teams set | Fixtures | Live | After-party     | Who                           |
  | -------------------------------------- | ------- | ------------------------- | --------- | -------- | ---- | --------------- | ----------------------------- |
  | The draft's jobs (`lib/draft-jobs.ts`) | Add     | all                       |           |          |      |                 | as each job says              |
  | Make the fixtures again                |         |                           |           | yes      |      |                 | admin                         |
  | Confirm the awards / Change the awards |         |                           |           |          |      | till the reveal | admin, awards listed          |
  | Play out the Kumite (dev only)         | yes     | yes                       | yes       | yes      | yes  |                 | admin                         |
  | Back to …                              | closed  | yes                       | yes       | yes      | yes  | yes             | admin; runner the draft's     |
  | Move to… (a captains' draft)           | yes     | yes                       | yes       | yes      | yes  | yes             | admin                         |
  | Your team (its name and crest)         |         | yes                       | yes       | yes      |      |                 | its captain                   |
  | Pick log (a captains' draft)           |         | open                      | yes       | yes      |      |                 | whoever runs it, or a captain |
  | Settings                               | yes     | yes                       | yes       | yes      | yes  | yes             | admin                         |

  The draft's jobs: Undo the last pick, naming it; Add a player; Close it now, only to close early leaving the rest out,
  the Seal card closing it once everyone's picked; Reset the draft, in red words. The awards are confirmed once every
  match is played, never before (Confirm till they're confirmed, then Change, till the reveal starts, which the Worker
  refuses after). Your team and the Pick log are the draft's: once a match is on they go, the pick log staying on the
  draft's own page (the track's Draft open). A captain sees the gear for those even with nothing else in it. Back a step
  is the gear's alone, one on the page, for whoever runs the draft too (the draft's three steps). The draft room's gear
  has the same draft items and Back. A drawer opens only from a tap.

### Stepping back, and moving

- Manage is a bottom sheet on a phone and a side drawer on a desktop ([0065](0065-page-frame-and-admin-actions.md)).
  Running the draft and making the fixtures are done in their own statuses' views, not the menu.
- **An admin can always step it back one step** (Manage: one item, "Back to …", while there's a step before it). The
  steps are the front page's track and the draft's own (`src/lib/step-back.ts`, the same for the app and the Worker);
  teams that enter skip the draft's:

  | It's at                      | Back to                     | What goes                                                           | Asked                   |
  | ---------------------------- | --------------------------- | ------------------------------------------------------------------- | ----------------------- |
  | awards revealed (The Anchor) | before the awards           | the reveals: every award face down again (results, winners stay)    | no                      |
  | a match started or played    | the fight card, not started | results, goals, penalties, clocks, scoresheets; the playoffs' teams | red, counted            |
  | the fight card out           | the teams                   | the fixtures (made again the same)                                  | quietly                 |
  | a draft closed               | the draft, open             | nothing                                                             | no                      |
  | the draft open               | the drawn order             | the picks so far ("Draft paused" to its captains)                   | red, counted (none: no) |
  | the order drawn              | before the draw             | the order                                                           | quietly                 |
  | sign-up closed               | sign-up open                | the admin's close, and a closing day gone by                        | no                      |

  **Close sign-up** (`POST /api/tournaments/:id/signup/close`, manage:Tournament, audited `tournament.signup_closed`)
  records when, on its own (`signup_closed_at`), its dates left as they were; sign-up is over once that's set or its
  closing day's gone by (`lib/signup.ts signupOver`, the app and the Worker alike): one guarded statement, only while
  sign-up is open with nothing drawn or made (ADR 0121); Back to Sign-up open clears it. A save checks the sign-up dates
  against each other only when they change, so dates already stored closing before they open never stop one.

  `POST /api/tournaments/:id/step-back { from }` says which step it's leaving; it's refused (409) if the tournament has
  moved on since, so a tap from a page that's out of date never takes a second step. Each is one batch whose statements
  only do anything while it's still at that step, so two taps at once step back once
  ([0121](0121-load-and-concurrency.md)). An admin (`manage:Tournament`) steps back any step; whoever runs the draft
  (`run:Draft`) the draft's three, from the Draft page's Manage. It's on the record as `tournament.stepped_back`, with
  the step and the picks, order, matches, results and goals before and after. Only an open draft stepped back is news:
  each captain hears "<tournament> Draft Paused"; nothing else is sent. The awards an admin confirmed stay.

- **An admin can move a captains' draft to any status at once** (Manage: "Move to…", beside the step back): a sheet on a
  phone, a side drawer on a desktop, listing its six statuses (Sign-up open, Draft open, Teams set, Fixtures set,
  KUMITE!, The Anchor), the one it's at marked, each saying what moving there will do or why it can't. A tap asks first,
  listing every step in order. The plan is `src/lib/move-to.ts planMove`, the same for the app and the Worker:
  - **Back** any number of statuses is the steps back above, in order, in one batch: "3 results and 11 goals deleted,
    the fixtures cleared, the draft reopened"; its confirm's tap is the red-filled "Move back". Off the day (KUMITE! or
    The Anchor) the status goes back to open; The Anchor back to KUMITE! is "the day under way again" (marked finished
    undone; every match played, their results go too). On its day, Fixtures set is KUMITE!, so it isn't one to move back
    to.
  - **Forward** is the jobs in between, as an admin would do them: sign-up closed (if open), the order drawn, then the
    draft opened (Draft open); or, for Teams set and on, **everyone still to pick chosen at random** (the user,
    2026-10-23: in production too), for the team on the clock in snake order, a goalie first while the team has none,
    never a second (one a team), captains on their own teams, a goalie no team can take left out (`draft.ts
setTeamsAtRandom`, the simulator's choosing as a real use case), each pick naming the admin, and the draft closed;
    the fixtures made in a fair order (Fixtures set); marked under way, status `live`, so the first match can start
    (KUMITE!); marked finished, status `finished` (The Anchor; matches not played stay unplayed; the awards are still
    confirmed and revealed by hand). Refused before anything changes when it can't be done (too few signed up for the
    draft, too few teams for the playoffs).

  `POST /api/tournaments/:id/move { from, to }` (manage:Tournament) sends the status the admin's page saw; it's refused
  (409) if the tournament has moved on since, so of two admins at once one moves and the other is told to look again.
  Back is one batch whose every statement only does anything while it's at that step; a step that finds nothing to do
  means someone got there first, and it's a 409 (ADR [0121](0121-load-and-concurrency.md)); forward is the jobs' own use
  cases in turn, each with its own guards, the random picks and the close one batch. One entry on the record,
  `tournament.moved`: the status and the picks, matches, results and goals before and after, and what was done, in
  words. Live to every open page; captains hear a draft opened or paused as they would from the Draft page, and
  "<tournament> Teams Set: the draft's closed, the rest were chosen at random" when it was.

- **When nothing's coming up** (the last one's been played, or there's never been one), an admin sees **Next Kumite** as
  the main button on the page, in the big "No Kumite yet". This is the one admin button on the page outside Manage.

## Consequences

- An admin can undo any step on the night, and every undo says what it costs before it does it.
- Two admins at once can't double-step: each move names the status its page saw, and the second is refused.
- Which jobs Manage offers is one function, pinned stage by stage and role by role, so a job can't appear where it makes
  no sense.

## History

- 2026-10-08: Manage gathers an admin's jobs (was 0074).
- 2026-10-09: Manage keeps only what has no page of its own; Next Kumite is the one admin button outside it (was 0087).
- 2026-10-22: Back a step, from any step: one item, asking as much as it costs; one route that names the step it's
  leaving, one batch.
- 2026-10-22: Back a step is one, in the gear, for whoever runs the draft too (the drawer had opened by itself on every
  pick: an effect's returned opener ran as its teardown).
- 2026-10-22: The draft's jobs are the gear's own rows (`lib/draft-jobs.ts`), never a menu inside the menu.
- 2026-10-22: On dev and locally, Play out the Kumite plays the rest at random ([0123](0123-dev-only-tools.md)).
- 2026-10-23: Close sign-up is a small action under the sign-up card, its own record (`signup_closed_at`), the dates
  left alone; Back to Sign-up open clears it.
- 2026-10-23: Move to… any status at once: back is the steps back in one batch, forward the jobs in between, Teams set
  choosing the rest at random, in production too; refused when the page is out of date; audited `tournament.moved`.
- 2026-10-23: Manage follows the stage (`lib/manage.ts`, the table above): the awards are the after-party's, Your team
  and the Pick log end at the first match.
- 2026-10-24: Split out of ADR 0074, which had grown to cover the whole tournament.
