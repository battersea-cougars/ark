# 0125. Code reads like the club's model: one job per file and function, early exits, the club's words for names

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

[ADR 0105](0105-code-grouped-by-feature.md) says where code goes: by feature, a folder per component, entry points as
tables of contents, `{domain}.{kind}.ts` names. It didn't say how the code inside a file should read, and the pre-launch
review (#148) found pages of 1,500 to 3,000 lines, functions past two screens, nesting five deep and parameters called
`t`, `r`, `p` and `c` everywhere. This code is for people to read; this record is the rest of how.

## Decision

- **Single purpose, SOLID in spirit.** A file has one job, and so does a function. A file that does two things is two
  files; a function that does two things is two functions with names that say which.
- **Sizes to notice**: a file past roughly **400 lines**, a Svelte component's own CSS past roughly **500 lines**
  (#153), or a function past a screen (about **80 lines**) is the prompt to ask whether it holds more than one idea and
  to split it. A prompt, not a rule: a long list of routes or a table of rules can stay long.
- **The API split by module**: the controller idea without the controller pattern (ADR 0105). Every route lives in its
  component's `{domain}.routes.ts` (sign-in's own routes too: `auth.routes.ts`, `auth.passkeys.routes.ts`); its rules
  and queries in `{domain}.ts` beside it. `api.ts` stays a table of contents and holds no feature's routes.
- **Exit early, minimal nesting.** Guard clauses first (`if (!session) return …`), then the main path, unindented. No
  `else` after a `return`; no pyramid of `if`s. Past three blocks deep, pull the inside out into a named function.
- **Names from the domain.** Variables, parameters and functions say what they are in the club's words (`session`,
  `captain`, `goalsAgainst`, `heldOn`), not `x`, `d`, `tmp`, `data` or `item`. Short names only in tiny conventional
  scopes: an index (`i`, `j`, `k`), a count (`n`), a sort's pair (`a`, `b`), a caught error (`e`), geometry (`x`, `y`),
  and `_` for what's unused.
- **The pattern follows the model.** A person who knows the app should find a feature where its model says it is:
  `worker/tournaments/`, `tournaments.routes.ts`, `draft.ts`, `draft.use-cases.test.ts`. The app side holds to the same:
  `src/lib` groups its components and helpers by feature, with file names per domain and kind (#88).
- **Classes for cohesion, functions for composition.** A class when state and the behaviour that guards it must stay
  together (a live connection, a simulation loop, a store); functions for rules, formatting and queries, composed. No
  classes as namespaces, and no bag of state passed from function to function that wants to be an object.
- **Cheap checks, as warnings**: ESLint's `max-depth` (3), `max-lines-per-function` (80, tests excepted), `id-length`
  (2, with the exceptions above; object keys aren't counted) and `no-else-return` warn, and never fail lint or CI.
  `npm run sizes` lists the files and component styles past the prompts (CI prints it).
- **Unused code goes.** An export nobody imports, a file nothing reaches, is removed: `npx knip` finds them (its entry
  points in `knip.json`). One kept on purpose says why, tagged `@public`.

## Consequences

- A reviewer has words for what's wrong ("two jobs", "late exit", "say what `r` is"), and the warnings point at where.
- The warnings start in the thousands (mostly `id-length`, many in tests), so lint's output is long until they're paid
  down; they're paid down as each file is next worked on, not in one sweep (ADR 0105), and become errors only once a
  rule's count is near zero.
- Splitting the big pages (Draft, Training, Game, Home, MemberSheet, Shell) waits for the shared components (#153).
- Where the code stood on 2026-10-23, file by file: [docs/code-style-audit.md](../code-style-audit.md).

## History

- 2026-10-23: Decided (#148): how code reads, beside ADR 0105's where it goes; the warnings and `npm run sizes` added.
- 2026-10-23: Sign-in's routes (`auth.routes.ts`), passkeys' (`auth.passkeys.routes.ts`) and break glass's
  (`auth.break-glass.routes.ts`) moved out of their domain files; no route is outside a `.routes.ts` now.
- 2026-10-23: Unused code removed (eight exports and what only they used) and `knip.json` added; `npx knip` reports no
  unused files, exports or types.
