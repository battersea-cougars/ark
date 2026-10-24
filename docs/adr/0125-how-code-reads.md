# 0125. Code reads like the club's model: one job per file and function, early exits, the club's words for names

- **Status:** Accepted
- **Date:** 2026-10-23 · updated 2026-10-24

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

- A reviewer has words for what's wrong ("two jobs", "late exit", "say what `r` is"), and the warnings point at where.
- The warnings are paid down as each file is next worked on, not in one sweep (ADR 0105), and become errors only
  once a rule's count is near zero.
- Splitting the big pages (Draft, Training, Game, Home, MemberSheet, Shell) waits for the shared components (#153).
- Where the code stood on 2026-10-23, file by file: [docs/code-style-audit.md](../code-style-audit.md).

## History

- 2026-10-23: Decided (#148): how code reads, beside ADR 0105's where it goes; the warnings and `npm run sizes` added.
- 2026-10-23: Sign-in's routes (`auth.routes.ts`), passkeys' (`auth.passkeys.routes.ts`) and break glass's
  (`auth.break-glass.routes.ts`) moved out of their domain files; no route is outside a `.routes.ts` now.
- 2026-10-23: Unused code removed (eight exports and what only they used) and `knip.json` added; `npx knip` reports no
  unused files, exports or types.
- 2026-10-23: `id-length` is off for now: its ~4,000 warnings drowned the other 51. It goes back on once a sweep has named
  them.
- 2026-10-24: knip is a check: `npm run knip` (a dev dependency now) fails a PR and merge:check. Two components the
  Kumite's one page left behind (DraftStatus, FightCard) and five unused re-exports removed; `knip.json` is
  `knip.jsonc`, so each ignore says why (#148).
- 2026-10-24: Trimmed against ADR 0105: where routes and features live is there; the sizes to notice are here only;
  `id-length` said to be off.
