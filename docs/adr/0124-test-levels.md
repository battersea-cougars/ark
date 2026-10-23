# 0124. Three test levels: unit for tricky logic, use cases for rules and routes, journeys for whole workflows by role

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

Unit tests and use cases ([0031](0031-use-case-tests.md)) re-check on every push that the rules and routes still
work, but they stop at the API. The breakages we've had were in the app's flow: a menu offering a step at the wrong
stage, a page that can't be opened, two cards that don't make sense together. Nothing drove the real app, in a
browser, through a whole workflow as each person in it (#154).

## Decision

**Three levels, each with its own job. A check lives at one level only**: the cheapest that can see it.

| Level        | What it checks                                                                                                                            | Where                                                   | When                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| **Unit**     | Tricky pure logic, every case in isolation: recurrence, the solver, standings, what Manage offers at each stage to each role              | `{domain}.test.ts` beside the code (Vitest)             | every push and PR                                     |
| **Use case** | The rules and the routes: what someone does through the real Worker handlers, what they'd see after, what reached the outside world       | `{domain}.use-cases.test.ts` (Vitest, the fake world)   | every push and PR                                     |
| **Journey**  | A whole workflow, by role, in a real browser on the real app: can each person do what needs doing at each step, and not what they mustn't | `apps/team/journeys/{workflow}.journey.ts` (Playwright) | on demand and before a release; never blocks anything |

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
  D1 is everyone's; it never touches 4500/4510/4520. The real clock: the Kumite is scheduled for today.
- **Failures never block.** A run with failures writes one summary (`.journeys/summary.md`: each failing step, by
  stage and role, expected and what happened) and, in CI or with `--file-issue`, opens **one issue for the run**
  (label `regression`) to review: fix the code, or change what the journey expects. `npm run journeys` locally prints
  it and files nothing unless asked.
- **CI** (`.github/workflows/journeys.yml`): by hand (`workflow_dispatch`) and on a push to `release`, beside the
  deploy, never required by it. No secrets but `GITHUB_TOKEN`; Chromium only, its download cached.

## Consequences

- A broken flow shows up as a step with a role and an expected/actual, before a release, without holding it up.
- A journey run is minutes, not seconds, so it never runs on every push; the use cases stay the everyday net.
- Journeys meet the real clock: a check that depends on the day (a Friday's training clash) handles it, and anything
  after the evening (the 06:00 move to History) isn't reachable without a dev clock.
- Overlap between levels is to be taken out as it's found (#154): the same check twice is twice the upkeep.
- The checkout's own D1 (`--own-db`) is the journeys': a branch that needs its own D1 for its own work loses it to a run.

## History

- 2026-10-23: Three levels, a check at one only; journeys by role in Playwright, on demand and before a release, one
  issue per failing run (#154). The first journey: the Kumite night.
