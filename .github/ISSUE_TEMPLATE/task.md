---
name: Task
about: Something that needs doing — a gap, a bug or a requested feature
title: ""
labels: ""
---

<!--
Write for Dan, in plain words: what people see, not how it's stored.
Put the issue in a milestone (ADR 0006); bugs go in "0 · Known bugs".
Bugs fill in "Actual result"; delete it otherwise. Technical detail goes last, under its own heading.
-->

**What.** <!-- The gap, bug or requested feature, in a sentence or two. -->

**Who does it.** <!-- Who builds it (an agent in a worktree or cloud session / Dan), and whether any step needs Dan's hands: a console, a key, real money, an approval. -->

**Why.** <!-- What it costs or blocks today; who notices (members, admins, visitors). -->

**Expected result.**
<!-- What Dan will see when it's done. A real example where possible. -->

-

**Actual result.** <!-- Bugs only: what happens now. Delete for gaps and features. -->

**How to confirm.**
<!-- Steps from the user's seat: a page on the website or in the team app on dev (prod runs the same code),
or for a CI/dev task, what the dev sees on GitHub.
Start each step with who runs it — [Dan], [agent] or [CI] — and say whether it's manual or an automated test. -->

1. [Dan] …
2. [CI] …

**Done when** <!-- The checks that close it: use-case tests (run by CI) and any manual check (by whom). -->

**Size.** <!-- XS / S / M / L -->

**Technical approach.**
<!-- For the builder, in the code's terms. How it fails today (files, flows); the design, in steps
     that can ship apart (components, routes, schema, config, where each piece sits); options not
     chosen and why; risks, cut-over and rollback; ADRs and related issues. One line is enough for a
     small fix; a design decision gets its ADR named here. -->
