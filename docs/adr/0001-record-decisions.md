# 0001. Record architecture decisions here, one record per topic; product rules live with their feature's tests

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-11-02

## Context

The club site is built by a small, changing group (and AI agents) for a client who isn't a developer. Decisions made
in chat get lost, and the next person re-opens them.

By 2026-11-02 there were 72 records. Most of them were product rules (the register closes at 06:00, a Kumite played
early keeps its night off, fees, the draft's format, wording), each with a growing History. The rules drifted from the
code with nothing to notice, a reader had to find three records to learn how one thing works, and the History lines
repeated what git and the pull requests already keep.

## Decision

- **ADRs record only architecturally significant decisions**, in `docs/adr/`, one record per topic: structure,
  technology choices, environments and deploys, secrets, free tiers, sign-in and permissions, how the apps get their
  data, how code reads and is tested, and rules that cut across the whole codebase. [README.md](README.md) lists them by
  area; there are about twenty. Agent instructions (`CLAUDE.md`, `.github/copilot-instructions.md`) point here.
- **A record says what holds today**: Context, Decision, Consequences, using [template.md](template.md). Its header
  keeps the date it was first decided and when it was last updated. **There is no History**: git and the pull
  requests are the trail.
- **Changing a decision means rewriting its record** in the same change as the code, and bumping _updated_.
- **A new architectural topic gets a new record** with the next unused number. Numbers are never reused.
- **Records on one topic are merged**: the earliest still in force keeps its number, the others are deleted, and their
  numbers go on the survivor's _Merges_ line, so an old number from a commit or an issue can be found
  (`grep -l 0035 docs/adr/*.md`). Every link and mention is pointed at the survivor in the same change.
- **Product and behaviour rules are not ADRs.** A rule a member or admin would recognise (who's charged, when sign-up
  opens, what the draft does, what a page shows) lives:
  - in the feature's **use-case tests**, the spec CI checks: each rule has a test that proves it; a rule the code
    doesn't keep yet is an `it.fails("… (known bug #N)")` with its issue ([ADR 0031](0031-use-case-tests.md));
  - in a short **notes file**, the `README.md` in the feature's folder (`apps/team/worker/training/README.md`), listing
    the rules in plain words, each linking its test as `[file › "test name"](file)`. Changing a rule changes its test
    and its line together.
- **The why of a piece of code stays in a comment beside it**, not in a record.
- `npm run links` (`scripts/links-check.mjs`, run by `pr.yml`) fails when a Markdown link goes nowhere, a notes line
  names a test that isn't in its file, or anything cites an ADR that doesn't exist.

## Consequences

- Anyone, human or agent, about to change how something is built reads one record per topic and knows where things
  stand; anyone changing what a feature does reads its notes and its tests, which can't drift apart without CI
  noticing.
- Records stay short; one that passes about two pages is split by topic or has product detail that belongs in notes.
- An old number in a commit or an issue that isn't a file any more is on a survivor's _Merges_ line, or its rules moved
  to a feature's notes ([README.md](README.md) lists where each went).
