# 0001. Record decisions here, one record per topic

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-24

## Context

The club site is built by a small, changing group (and AI agents) for a client who isn't a developer.
Decisions made in chat get lost, and the next person re-opens them.

By 2026-10-09 there were 100 records, one per decision, each change a new record amending or superseding an older
one. Finding what holds today meant following chains like 0060 → 0064 → 0066 → 0068 → 0070, and records cited
the wrong one of two numbered 0029.

## Decision

- Decisions live in `docs/adr/`, **one record per topic** (environments and deploys, sign-in, the draft…), using
  [template.md](template.md). [README.md](README.md) lists them by area. Agent instructions (`CLAUDE.md`,
  `.github/copilot-instructions.md`) point here.
- A record says **what holds today**: Context, Decision, Consequences. It ends with a dated **History**, one line per
  change, saying what changed and why.
- **Changing a decision means updating its topic's record**, in the same change as the code: rewrite the parts that
  no longer hold, add a History line, bump _updated_. Never a quiet edit: the History line is the trail.
- **A new topic gets a new record** with the next unused number. Numbers are never reused.
- When topics drift together, merge them: the earliest record still in force keeps its number, and each record
  merged into it becomes a **stub** (its number, its title, status _Merged into NNNN_ and a one-line pointer), so
  links to it still work. Links that matter are pointed at the survivor, whose _Merges_ line lists the old numbers.
  (The 2026-10-09 merge deleted its records instead; their numbers are only on the _Merges_ lines.)

## Consequences

- Anyone, human or agent, about to change how something works reads one record per topic and knows where things
  stand, then updates that record.
- Records get longer over time; when one passes about two pages, split it by topic.
- Old numbers from before 2026-10-24 point at deleted files; search the _Merges_ lines (`grep -l 0035
docs/adr/*.md`) to find where they went. Later ones land on a stub.

## History

- 2026-10-05: Short numbered records, one per decision; a change is a new record that supersedes the old one.
  0002–0009 were recorded retroactively from the proof of concept.
- 2026-10-09: 100 records merged into 37, one per topic; a change now updates its topic's record with a History
  line, instead of adding a new one.
- 2026-10-24: A merged record leaves a stub that points at its survivor, so links keep working.
