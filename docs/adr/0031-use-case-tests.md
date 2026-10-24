# 0031. Tests describe what people do, against a fake world, at three levels: unit, use case, journey

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-24
- **Merges:** 0124

## Context

The first tests covered functions: recurrence rules, slugs, navigation, and the SQL helpers against in-memory
SQLite. They proved the parts work, but not that a member can sign up for Friday or an admin can close the register.
Gwenda's ops app (`gwenda-hackney/ark`, `docs/testing.md`) tests the other way round: most of its tests describe
what someone does, drive the real API handlers end to end, and fake every outside service in memory. That has
caught integration bugs that function tests miss, and the tests read as a description of the product.

Unit tests and use cases re-check on every push that the rules and routes still work, but they stop at the API. The
breakages we've had since were in the app's flow: a menu offering a step at the wrong stage, a page that can't be
opened, two cards that don't make sense together. Nothing drove the real app, in a browser, through a whole workflow
as each person in it (#154).

## Decision

We test the same way, in both projects.

- **Use cases first.** The main tests describe what a person does ("an admin adds a weekly training", "a member
  says they're in", "the door marks a walk-in") and check what that person would then see, and what reached the
  outside world (email sent, push sent, error reported). They call the real Worker handlers with a real request.
- **One fake world** (`apps/team/worker/testing.ts`, `testWorld`): D1 as in-memory SQLite built as a fresh database
  starts (the schema and the club seed until launch, then every migration; `packages/shared/testing/d1-sqlite.ts`),
  and in-memory Gmail, Turnstile, Sentry, Firebase and web push behind one global `fetch`. Any outside call the fake
  doesn't know **throws with its URL**, so a new integration shows up as a failing test, not a silent network call.
- **Unit tests only for tricky pure logic** (recurrence, the solver, standings, slugs, permissions), where it's
  easier to cover every case in isolation. Not by default.
- **Known bugs stay in the suite** as `it.fails("… (known bug #N)")`, linked to the issue. The PR that fixes the
  bug changes it back to `it`.

How to write them: [docs/testing.md](../testing.md).

### Three levels

**Each level has its own job. A check lives at one level only**: the cheapest that can see it.

| Level        | What it checks                                                                                                                            | Where                                                   | When                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| **Unit**     | Tricky pure logic, every case in isolation: recurrence, the solver, standings, what Manage offers at each stage to each role              | `{domain}.test.ts` beside the code (Vitest)             | every push and PR                                     |
| **Use case** | The rules and the routes: what someone does through the real Worker handlers, what they'd see after, what reached the outside world       | `{domain}.use-cases.test.ts` (Vitest, the fake world)   | every push and PR                                     |
| **Journey**  | A whole workflow, by role, in a real browser on the real app: can each person do what needs doing at each step, and not what they mustn't | `apps/team/journeys/{workflow}.journey.ts` (Playwright) | nightly, on demand and before a release; never blocks |

- **What goes where.** A rule (a refusal, a count, who may) is a use case; a pure function with many cases is a unit
  test; a journey checks that the app puts the right things in front of each person at each step and that they work
  when tapped: the button's there, the page opens, the next step follows. A journey doesn't re-check a rule's every
  case (one tap that's refused is enough), and a use case doesn't check a page.
- **Journeys are functional first**: roles, labels and text, not pixels or layout. A `data-testid` only where nothing
  stable a person would read is there.
- **A journey is one story in stages** (`stage`), each a list of what a person does (`does`: the story needs it, so a
  failure stops the journey) and checks (`checks`: they can, they can't, they see; a failure is noted and the journey
  goes on, so one run finds every broken check). Three people at least: an admin, someone in it, a member who isn't.
  A known bug is `knownBug(…)`, as `it.fails` is in a use case: it runs, should fail, and says so when it doesn't.
  Shortcuts (the API as a member, the dev simulator, Move to…) only to get to a step that isn't the one under test,
  each said so in a comment; the steps under test are real taps.
- **Its own fresh database every run**: `npm run journeys` wipes the checkout's own local D1 (`--own-db`), rebuilds it
  from `db/schema.sql`, the club seed and a made-up roster (`journeys.roster.json`), starts the team app on a private
  port (`npm run app -- --private --own-db team`), runs, and stops it. It refuses to run in the main checkout, whose
  D1 is everyone's; it never touches 4500/4510/4520. The Kumite night runs on the real clock: scheduled by season
  only (the wizard's default) and played tonight, so it's the evening a match kicked off, not its date, that counts.
- **Both clocks move where a day is under test**: `at(person, when)` sets their browser's clock (Playwright's) and the
  server's for their requests (`x-dev-now`, `worker/api/api.dev-clock.ts`: only where the simulator is, so never in
  production, and on dev only for an admin; a whole ISO time in UTC, nothing looser; who's signed in stays on the
  real clock), and `cron(when)` runs the Worker's hourly job at a moment through the local dev server's own trigger.
  The days that matter (London midnight, 17:00, 06:00, the clocks changing, 29 February) are each walked once
  (`kumite.on-the-clock`, `fridays`); a journey only moves forward.
- **The browser is listened to**: every person's pages (`journey.ts`) report an uncaught error, a console error or a
  Svelte dev warning that means a bug (a named list), and it fails the step it happened in, noted like a check. Noise
  that isn't the app's goes on an allowlist, each entry with its reason. **Every page opens clean**
  (`pages.journey.ts`): each of the three opens every page in their menus and, the admin, each editor (shut unsaved);
  it only looks, never saves.
- **Failures never block.** A run with failures writes one summary (`.journeys/summary.md`: each failing step, by
  stage and role, expected and what happened) and, in CI or with `--file-issue`, opens **one issue for the run**
  (label `regression`) to review: fix the code, or change what the journey expects. `npm run journeys` locally prints
  it and files nothing unless asked.
- **Two runs: core and full.** The core run (`npm run journeys -- --core`) is every journey but the Kumite on the
  clock, about 5 minutes; the full run adds it (its three played-out Kumites), 9½ to 12½.
- **CI** (`.github/workflows/journeys.yml`): the core run nightly on `main` (some time after 02:41 UTC), so a broken
  flow shows up the morning after it merged, not at the release; the full run on a push to `release`, beside the
  deploy, never required by it; either by hand (`workflow_dispatch`). A run failing at a commit an open issue is
  already about comments on it, so a quiet week on `main` is one issue, not seven. No secrets but `GITHUB_TOKEN`;
  Chromium only, its download cached.

## Consequences

- Tests describe behaviour a person would recognise, and survive refactors of the code underneath.
- The fake world is code we have to keep honest: when a provider behaves differently from the fake, the fake gets
  fixed first, with a test.
- Use cases are slower than unit tests (a fresh SQLite per world), still well under a second each.
- A broken flow shows up as a step with a role and an expected/actual, before a release, without holding it up.
- A journey run is minutes, not seconds, so it never runs on every push; the use cases stay the everyday net. A full
  run is 9½ to 12½ minutes and the core one about 5, on GitHub's free runners for a public repo: no Actions minutes
  spent. A break that only the Kumite on the clock sees waits for the release's run.
- Journeys meet the real clock unless they move both: a dev-only header the Worker reads, so the API has a way in
  that production fails closed on (`api.dev-clock.use-cases`). A journey that moves the clock leaves what it made
  then (sessions a year on, say) for the journeys after it: they're written to cope, and that's how the calendar's
  two Marches were found.
- Overlap between levels is to be taken out as it's found (#154): the same check twice is twice the upkeep.
- The checkout's own D1 (`--own-db`) is the journeys': a branch that needs its own D1 for its own work loses it to a
  run.

## History

- 2026-10-06: Tests describe what people do, against a fake world.
- 2026-10-23: Three levels, a check at one only; journeys by role in Playwright, on demand and before a release, one
  issue per failing run (#154). The first journey: the Kumite night (was ADR 0124).
- 2026-10-23: The Kumite night is scheduled by season only, and played on the real clock; browser errors fail their
  step; every page opens clean.
- 2026-10-23: Journeys for the whole app, mapped workflow by workflow (testing-map.md); the server's clock moves per
  request on dev and local (`x-dev-now`), and the cron runs at a moment.
- 2026-10-23: On dev the clock moves only for an admin; a loose time is ignored (#148).
- 2026-10-24: Two runs: the core (all but the Kumite on the clock) nightly on `main`, the full one on a push to
  `release`, either by hand; a failing commit's later runs comment on its open issue (#148, was in 0124).
- 2026-10-24: ADR 0124 (test levels) merged in. The fake world's facts brought up to date: it is `testWorld` in
  `apps/team/worker/testing.ts`, its D1 is the schema and seed, and it fakes Gmail, Turnstile, Sentry, Firebase and
  web push.
