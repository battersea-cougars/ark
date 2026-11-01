# 0117. A create that asks several questions is a wizard: lib/Wizard, a step at a time

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Scheduling the next Kumite (ADR [0128](0128-scheduling-a-tournament.md)) asked its questions one under another
in a tall panel: the season, day and hours, sign-up, the draft's day, then the captains at the bottom. On a phone the
captains' search came last, under everything else, and its matches opened in a small pop-over, so there was little
room to find people. The user asked for the Ledger app's wizard instead: a job that moves on to the next step with a
button, each step with the space to itself.

## Decision

- **A create that asks more than a few questions is a wizard**, `lib/Wizard.svelte`, after Ledger's
  (`ledger.web/src/shell/wizard.svelte`) in the Cougars look:
  - **The steps along the top**: Tabs' italic capitals and a bar under each; the one you're on has the red slash,
    done ones a solid bar, ones not open yet fade and can't be tapped. On a phone just the numbers; each step says
    its own name in its heading.
  - **The step in the middle** slides in from the right going on, from the left going back (nothing moves with
    reduced motion), and scrolls on its own. A step can take the whole height (the Kumite's Captains).
  - **The foot stays put**: Cancel (first step) or Back, "Step x of y", and **Next · the next step's name** as the
    yellow main button (ADR [0084](0084-sticker-colour-scheme.md)); on the last step, the job's own button. Above them
    one line kept for what's said: what stops this step, what the job will do (last step), "Scheduling…" while it
    runs, or what failed, in place. A quiet way out (Advanced) can sit at its end.
  - **How far it goes**: `reachable`, the first step whose needs aren't met (`lib/wizard.ts`, `reachableStep`); the
    steps after it are shut and Next is off. Enter goes on when it can, except from a button, a search that picks
    on Enter, or the last step.
- **It fills what holds it**: `EditorPanel` and `Sheet` take `fill`, handing the wizard their height and edges, so a
  phone gets the tall bottom sheet (ADR [0065](0065-page-frame-and-admin-actions.md)) and a desktop the panel, the same
  height on every step.
- **The last step is a check**: each answer in words, with Change going back to its step.
- First used by the next date in a series (`TournamentQuickCreate`): When · Sign-up · Captains (a draft series only)
  · Check.

## Consequences

- Each step has room: the Kumite's captains are found in a list as tall as the sheet, not a pop-over.
- A job's answers live in one place (its values), so a step can be left and come back to, and Advanced can take them
  over.
- A wizard is more taps than one form. Short jobs (a payment, a score) stay single sheets.

## History

- 2026-10-21: A multi-step create is a wizard (lib/Wizard), first for scheduling the next Kumite.
