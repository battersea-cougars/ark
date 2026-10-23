# 0105. Code is grouped by feature, entry points read like a table of contents, and file names say domain and kind

- **Status:** Accepted
- **Date:** 2026-10-10 · updated 2026-10-23

## Context

This code is still for people to read. The team app's API was one file, `apps/team/worker/api/api.ts`, 1,236 lines:
every route (72), its action, its record and its handler. An entry point is where a person starts to understand an
app, and at that size it took holding the whole API in your head to find one feature. Nothing said how code should be
grouped, so it grew wherever was convenient.

## Decision

- **Group by feature, not by technique.** The controller idea, without controllers: what a person would call a feature
  (members, dues, training, the draft, scoring) is one place, holding its routes beside its rules and its queries.
- **Entry points are short and read like a table of contents.** The API's `api.ts` names every feature, in an order a
  person would explain the app in, mounts their routes, and does only what they share (who's asking, the action check,
  the record, the parts a change sends back, the live hub). It doesn't hold any feature's routes.
- **File names say domain and kind**: `{domain}.{kind}.ts`, so a file's name says what it is wherever it's seen (a
  search result, an editor tab, a stack trace).
  - `{domain}.ts`: the domain's logic and queries (`dues.ts`, `draft.ts`)
  - `{domain}.routes.ts`: its routes (`dues.routes.ts`)
  - `{domain}.use-cases.test.ts`: its stories (ADR 0031)
  - Shared pieces of one thing name it: `api.route.ts` (the shape of a route and its helpers), `api.slices.ts` (the
    club in parts).
- **A folder per component, flat inside.** The team API (`apps/team/worker/`) is `api/` (the entry point and what every
  route shares: the route shape, the club in parts, http, limits, versions), then one folder per component: `auth/`,
  `members/`, `dues/`, `training/`, `entries/`, `tournaments/`, `calendar/`, `settings/`, `live/`, `website/`. No
  folders inside them; a component that grows too big for one listing splits into two components, not into
  sub-folders. The Worker's own entry (`index.ts`) and the tests' fake world (`testing.ts`) stay at the top.
- **A size to notice**: a file past roughly 400 lines, or a function past a screen, is a prompt to ask whether it holds
  more than one idea. Not a rule a test enforces; `npm run sizes` lists them (ADR 0125).
- **How the code inside a file reads** (one job per file and function, early exits, the club's words for names,
  classes for cohesion and functions for composition, and the warnings that point at the rest) is
  [ADR 0125](0125-how-code-reads.md).
- **A route stays cheap** ([0003](0003-free-tiers-only.md), API functions stay cheap): a few D1 calls, batched, its
  reads bounded and indexed, its side effects after the reply; `api.budget.use-cases.test.ts` drives every route and
  fails when one isn't there or goes over (docs/api-budget.md).
- **Moving code is its own change**, with behaviour unchanged and the tests as they were; new code goes in the right
  place from the start. Existing code moves feature by feature when it's next worked on, not in one sweep.

## Consequences

- Finding a route means opening its feature's file; `api.ts` fits on a few screens.
- A new route goes in its feature's `.routes.ts`; a new feature is a new file and a line in `api.ts`'s table of contents.
- `tournaments/tournaments.ts` is still 550 lines (types, editions, teams, rules, playoffs); it splits when next
  worked on. The team app's `src/lib` is a long flat list and gets the same treatment in its own pass (#88).

## History

- 2026-10-10: Decided, and the team API split into twelve feature route files with an identical route table (#88).
- 2026-10-10: A folder per component, flat inside: the Worker's 65 files moved into `api/` and ten components, and
  `schedule.ts` (920 lines) split into training, tournaments, club events, venues and slugs (#88).
- 2026-10-23: How code reads went to its own record, [ADR 0125](0125-how-code-reads.md), linked from here (#148).
- 2026-10-23: A route stays cheap, by ADR 0003's rule, checked for every route by the budget test (#148).
