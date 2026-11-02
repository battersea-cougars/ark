# 0105. Code is for people to read: grouped by feature, entry points as tables of contents, `{domain}.{kind}.ts` names, one job per file and function

- **Status:** Accepted
- **Date:** 2026-10-10 · updated 2026-11-02
- **Merges:** 0125

## Context

This code is still for people to read. The team app's API was one file, `apps/team/worker/api/api.ts`, 1,236 lines:
every route (72), its action, its record and its handler. An entry point is where a person starts to understand an
app, and at that size it took holding the whole API in your head to find one feature. Nothing said how code should be
grouped, so it grew wherever was convenient. The pre-launch review (#148) also found pages of 1,500 to 3,000 lines,
functions past two screens, nesting five deep and parameters called `t`, `r`, `p` and `c` everywhere.

## Decision

- **Group by feature, not by technique.** The controller idea, without controllers: what a person would call a feature
  (members, dues, training, the draft, scoring) is one place, holding its routes beside its rules and its queries.
- **Entry points are short and read like a table of contents.** The API's `api.ts` names every feature, in an order a
  person would explain the app in, mounts their routes, and does only what they share (who's asking, the action check,
  the record, the parts a change sends back, the live hub). It doesn't hold any feature's routes: every route lives in
  its component's `{domain}.routes.ts` (sign-in's too: `auth.routes.ts`, `auth.passkeys.routes.ts`), its rules and
  queries in `{domain}.ts` beside it.
- **File names say domain and kind**: `{domain}.{kind}.ts`, so a file's name says what it is wherever it's seen (a
  search result, an editor tab, a stack trace).
  - `{domain}.ts`: the domain's logic and queries (`dues.ts`, `draft.ts`)
  - `{domain}.routes.ts`: its routes (`dues.routes.ts`)
  - `{domain}.use-cases.test.ts`: its stories (ADR 0031)
  - Shared pieces of one thing name it: `api.route.ts` (the shape of a route and its helpers), `api.slices.ts` (the
    club in parts).
- **A folder per component, flat inside.** The team API (`apps/team/worker/`) is `api/` (the entry point and what every
  route shares: the route shape, the club in parts, http, limits, versions), then one folder per component (`auth/`,
  `members/`, `dues/`, `training/`, `entries/`, `tournaments/`, `calendar/`, `announcements/`, `settings/`, `live/`,
  `push/`, `mail/`, `tell/`, `store/`, `website/`). No
  folders inside them; a component that grows too big for one listing splits into two components, not into
  sub-folders. The Worker's own entry (`index.ts`) and the tests' fake world (`testing.ts`) stay at the top.
- **Where the model says it is.** A person who knows the app should find a feature where its model puts it:
  `worker/tournaments/`, `tournaments.routes.ts`, `draft.ts`, `draft.use-cases.test.ts`. The app side holds to the
  same: `src/lib` groups its components and helpers by feature, with file names per domain and kind (#88).
- **A route stays cheap** ([0003](0003-free-tiers-only.md), API functions stay cheap): a few D1 calls, batched, its
  reads bounded and indexed, its side effects after the reply; `api.budget.use-cases.test.ts` drives every route and
  fails when one isn't there or goes over.
- **A feature's rules have notes beside it**: a feature folder whose behaviour has rules a member or admin would
  recognise has a `README.md` saying them in plain words, each linking the use-case test that proves it
  ([ADR 0001](0001-record-decisions.md), [ADR 0031](0031-use-case-tests.md)).
- **Moving code is its own change**, with behaviour unchanged and the tests as they were; new code goes in the right
  place from the start. Existing code moves feature by feature when it's next worked on, not in one sweep.

**How the code inside a file reads**

- **Single purpose, SOLID in spirit.** A file has one job, and so does a function. A file that does two things is two
  files; a function that does two things is two functions with names that say which.
- **Sizes to notice**: a file past roughly **400 lines**, a Svelte component's own CSS past roughly **500 lines**
  (#153), or a function past a screen (about **80 lines**) is the prompt to ask whether it holds more than one idea and
  to split it. A prompt, not a rule: a long list of routes or a table of rules can stay long.
- **Exit early, minimal nesting.** Guard clauses first (`if (!session) return …`), then the main path, unindented. No
  `else` after a `return`; no pyramid of `if`s. Past three blocks deep, pull the inside out into a named function.
- **Names from the domain.** Variables, parameters and functions say what they are in the club's words (`session`,
  `captain`, `goalsAgainst`, `heldOn`), not `x`, `d`, `tmp`, `data` or `item`. Short names only in tiny conventional
  scopes: an index (`i`, `j`, `k`), a count (`n`), a sort's pair (`a`, `b`), a caught error (`e`), geometry (`x`, `y`),
  and `_` for what's unused.
- **Classes for cohesion, functions for composition.** A class when state and the behaviour that guards it must stay
  together (a live connection, a simulation loop, a store); functions for rules, formatting and queries, composed. No
  classes as namespaces, and no bag of state passed from function to function that wants to be an object.
- **Cheap checks, as warnings**: ESLint's `max-depth` (3), `max-lines-per-function` (80, tests excepted) and
  `no-else-return` warn, and never fail lint or CI. `id-length` (2, with the exceptions above; object keys aren't
  counted) is configured but off until a sweep has named the ~4,000 short names.
  `npm run sizes` lists the files and component styles past the prompts (CI prints it).
- **Unused code goes.** An export nobody imports, a file nothing reaches, is removed: `npm run knip` finds them (its
  entry points in `knip.jsonc`), and fails a PR (`pr.yml`) and `npm run merge:check` when it finds any. One kept on
  purpose says why, tagged `@public`; what knip can't see used (a runtime module, a script's command-line tools) is
  ignored in `knip.jsonc` with its reason.

## Consequences

- Finding a route means opening its feature's file; `api.ts` fits on a few screens.
- A new route goes in its feature's `.routes.ts`; a new feature is a new file and a line in `api.ts`'s table of contents.
- `tournaments/tournaments.ts` is 854 lines (types, editions, teams, rules, playoffs); it splits when next worked
  on. The team app's `src/lib` is a long flat list and gets the same treatment in its own pass (#88).
- A reviewer has words for what's wrong ("two jobs", "late exit", "say what `r` is"), and the warnings point at where.
- The warnings are paid down as each file is next worked on, not in one sweep (above), and become errors only
  once a rule's count is near zero.
- Splitting the big pages (Draft, Training, Game, Home, MemberSheet, Shell) waits for the shared components (#153).
