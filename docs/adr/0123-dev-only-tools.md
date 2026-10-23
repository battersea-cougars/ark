# 0123. A dev-only tool isn't there in production: its route exists only where the environment says dev or local

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

The after-party ([0074](0074-tournament-home-and-scheduling.md)) only shows once a Kumite's last match is played,
on its evening. Trying it meant drafting four teams and scoring every match by hand, goal by goal, on the clock. The
user wanted a way to play a Kumite on to the after-party in one go, on dev and locally, without it ever being
something production can do.

Dev tools so far ([0027](0027-email-through-gmail-api.md)) are refused by their handler outside production, where
production is `SITE_ENV === "production"`: a Worker with no `SITE_ENV` counts as not production. That's right for
email (it fails safe by sending less), but a tool that writes results must fail the other way: an environment that
doesn't say what it is counts as production. Workers Free stops an invocation at 50 D1 queries, and a member's
changes are limited to 60 a minute ([0055](0055-degrade-instead-of-break.md)); a whole Kumite is a few hundred moves.

## Decision

- **Where a dev-only tool exists** (`simulatorHere`, `worker/tournaments/simulate.ts`): only where the environment
  says so in so many words. A deploy says with `SITE_ENV` (`scripts/ci/target.mjs`: `dev` from `main`, `production`
  from `release`); your own machine's server with `TEAM_ENV` `local` (`vite.config.ts`) and no `SITE_ENV`. Anything
  else (production, a missing or unknown environment) is production: fail closed.
- **Elsewhere the route isn't there at all.** A route may say `only: (env) => boolean` (`api.route.ts`); the router
  (`api.ts`) leaves it out before matching, so production answers 404 to anyone, admin or not, before reading who's
  asking. The handler checks again. It still needs its action, like any admin job: the simulator needs
  `manage:Tournament`. The bootstrap says whether it's there for you (`simulator`), and the app shows it only then.
- **The Kumite simulator** (`POST /api/tournaments/:id/simulate`, `simulate.routes.ts`): Manage → Play out the
  Kumite, one question (`lib/SimulateRest`). It plays on from wherever the tournament is, through the app's own use
  cases as the admin: the order drawn and the draft opened (refused, as the tap is, while too few have signed up: it
  never signs anyone up), a pick at random for the team on the clock (a goalie first while the team has none), the
  draft closed with the fixtures; then each match in order: the scoresheet taken (from whoever had it), the clock
  started, goals with assists and the odd penalty as it runs, each period ended, full time (a golden goal first if a
  playoff's level), the playoffs filled from the table. It stops with every match played and the awards provisional:
  the admin confirms them and reveals them by hand. A clock it starts is started a period ago, so nothing is timed in
  the future. The dice are the Worker's crypto, which the tests seed.
- **One move a request, paced to watch.** A move is one thing you'd see, one change of the app's own: the order
  drawn, the draft opened, a pick, the draft closed with its fixtures (the app's own one tap), the fixtures made, the
  scoresheet freed or taken, the clock started, a goal (a playoff's golden goal its own), a penalty, a period's end,
  full time (which fills the playoffs). The reply says which (`move`), in words (`said`) and whether that's all
  (`done`); the use-case test checks that each request changes exactly the one thing it says. The app waits each out
  before asking again (`lib/simulation.ts`), timed to what the page shows: a pick 2.8s (the draft room's turn change,
  `draft-sequence.ts`: burn 1.2s, hold 0.8s, scroll 0.4s, highlight 0.3s), a goal or a penalty 1.8s, the clock 1.5s,
  a period's end 2s, full time and the draft's steps 3s (the match carousel gliding to the next match). The match's
  clock still runs on a period at a time behind it (started a period ago), but its events land one by one. Quick is a
  quarter of that, never under 1.25s start to start, so even quick stays at 48 changes a minute, under a member's 60
  (`api.limits.ts`), with room for the admin's own taps. Each request is a handful of D1 round trips, far under 50.
- **A control while it runs** (`lib/SimulationControl`): floating over whichever page you're on (the Kumite's views,
  the draft room), bottom right on a desktop, above the tabs on a phone: what it just did, Watch or Quick, Pause
  (holds after the move in flight) or Resume, and Stop. The run is a store (`app/backend.svelte.ts simulating`), not
  a page's, so it carries on across the Kumite's views; a reload ends it, and running it again carries on from where
  the tournament is. Every move is read from the tournament as it is: stopped part way (Stop, a refusal, a closed
  tab, the minute's changes used up), the next run carries on; at the end it says there's nothing left.
- On the audit log like any admin job ([0095](0095-audit-log.md)): `tournament.simulated`, how far it's played
  (the draft's state, matches made and played) before and after, so once for each request that closes the draft,
  makes the fixtures or finishes a match, not for every goal.

## Consequences

- The after-party can be watched coming in a few minutes on dev or locally (Quick about half that). Its own evening
  still decides whether it shows (`lib/edition.ts atAfters`): the question says so when the tournament's day isn't
  today.
- A new dev-only tool uses `only` and `simulatorHere`'s rule (or one as strict), not `devToolsHere`, whenever it
  changes the club's data.
- Every rule the simulator meets is the real one, so a change to the draft or scoring changes it too; a refusal
  stops it and says why.

## History

- 2026-10-22: The Kumite simulator, and dev-only routes that aren't there in production.
- 2026-10-23: One move a request instead of two, each saying what it was, paced by the app so it can be followed
  (a pick 2.8s, a goal 1.8s, full time 3s; Quick a quarter, never under 1.25s), with a floating Pause/Resume/Stop
  control that outlives the page; the audit is unchanged (one entry when the draft's state, the fixtures or the
  matches played change), so a paced run doesn't fill the log with goals.
