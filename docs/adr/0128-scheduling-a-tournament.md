# 0128. A tournament is scheduled in a few questions from its series, opens sign-up on a day, and can be deleted

- **Status:** Accepted
- **Date:** 2026-10-09 · updated 2026-10-24
- **Merges:** 0087, 0088, 0089, 0091

## Context

Scheduling the next one was the last item in the Manage menu and opened the full editor on four tabs, with the day next
to series, name, type and season, and the draft's day and captains on the fourth. Sign-up was a status an admin had to
remember to set. Every new one started at 11:00–16:00, though the Kumite is usually instead of Friday training, at its
time. And a tournament made by mistake couldn't be removed.

The story: an admin opens the Kumite page and sees the last one. They schedule the next: its day, when sign-up opens,
the draft's day, its captains. The page then shows the new one ([0074](0074-tournament-home-and-scheduling.md)), its day
obvious, the draft's day obvious or TBC. This was part of 0074 until 2026-10-24.

## Decision

### The next one in a few questions

- A new date in a series opens on its questions as a wizard, a step at a time (`TournamentQuickCreate.svelte`, ADR
  [0117](0117-wizards-for-multi-step-creates.md)):
  1. **When:** the season, a day or none for TBC, and Starts and Ends filled in from the series.
  2. **Sign-up:** when sign-up opens (today by default).
  3. **Teams** (a draft series only, optional): the draft's day, and the captains: the whole club in a list as Add
     player has it, a search narrowing it and an Add on each row (Added once picked; Enter adds the first match). The
     captains so far sit above the search as chips with a ×, on one line that scrolls sideways so the list never moves.
     They're a set, not an order: the pick order is drawn when the draft starts. Too few for the playoffs is said at the
     foot.
  4. **Check:** each answer in words, with Change back to its step.
- Only the season is needed, so every step is open from the start; hours the wrong way round, or sign-up or the draft
  after the day, hold it on that step and the foot says why.
- **Schedule it** creates it and closes the panel on the page, which now shows the new one.
- **The rest comes from the series:** its name, fee, place, rules, awards and playoffs; status planned. The server fills
  in what a new one leaves out (hours, status, the series' fee, rules), so the quick form sends only what it asked.
- **Advanced is a mode of the wizard** (#163), not a jump to the full editor: a switch at its foot. The wizard's steps
  are the editor's tabs by the same names (Details, Sign-up, Teams, Rules, then Check), each group of fields one
  component both show (`lib/TournamentWhenFields`, `…VenueFields`, `…WhatFields`, `…SignupFields`, `…DraftDay`,
  `…RulesFields`, on one form shape, `lib/tournament-form.ts`). Without Advanced each step asks only what's above and
  says in a line what it takes from the series, with "change it" ("No fee · 24 places · on the website · change it"),
  which turns Advanced on at that field; with it, the rest shows in place. The draft's day is on the Teams step, as the
  editor has it. A one-off tournament (no series) and Settings → Tournaments use the full editor.
- The wizard takes its starting answers once, as it opens, so a refresh of the club's data never resets what's typed.
- **A series has usual hours** (`tournament_types.default_start_time`, `default_end_time`, defaulting to 11:00–16:00),
  set in its settings (Settings → Tournament Series → When, where and fee) beside its place and fee. Each new tournament
  starts with them and can change them. The seed has the Kumite at Friday training's hours (19:30–21:30). A tournament's
  hours change only when an admin edits them: the matches starting early or late, or on another day, never move them
  (each match keeps its own actual start, [0130](0130-scoring-a-game-live.md)).
- **The draft has a day, not a time** (`draft_on`). It's a reminder for the captains, on their calendar as a day; an
  admin messages them when it opens (ADR [0060](0060-the-draft.md)).

### Sign-up opens on a day

- `tournaments.signup_opens_on`: from that day (London) members can say they're in, until the end of the closing day
  (`signup_closes_on`, ADR [0030](0030-training-and-tournament-schedule.md)). An admin can still open it by hand (status
  `open`).
- **One rule** shared by the app and the Worker (`lib/signup.ts`, `signupOpen`): open by hand, or planned and past its
  opening day; never after its closing day. The Worker refuses an early "in" with the day it opens.
- The full editor has it on Sign-up, beside the closing day. It can't be after the tournament's day, and sign-up can't
  close before it opens.

### Deleting a tournament

- **Delete is in the tournament's editor** (Settings → Tournaments, or from its page): a quiet red Delete at the start
  of the footer. Tapping it asks there, in so many words ("Delete it? Its teams, sign-ups and results go too."), with
  Keep it and a red Delete, the one red fill.
- **The database deletes it, not the Worker** (`DELETE /api/tournaments/:id`, `manage:Tournament`): one `DELETE FROM
tournaments`, and the schema's `ON DELETE CASCADE`s take its sign-ups, teams and their players, games and goals, and
  the awards' winners. D1 enforces foreign keys, as does the SQLite the tests use. Work the database can do stays out of
  a Worker's CPU time (ADR [0059](0059-usage-page-and-check.md)).
- **Its agenda rows go by syncing it away.** The agenda points at a tournament by `source` and `source_id`, with no
  foreign key, so the Worker removes them (ADR [0042](0042-website-reads-the-club-agenda.md)).

## Consequences

- Scheduling the next one is one button and up to four steps.
- Tournaments made before sign-up had a day have no opening day, so they wait for an admin as before. A series made
  before it had hours keeps 11:00–16:00 until an admin sets them.
- There's no undo for a delete. A played tournament's results go with it, so the question says so.
- A new table that belongs to a tournament needs `ON DELETE CASCADE` to its tournament (or its team or game), or a
  delete leaves it behind; the use-case test checks no team's players are left over.

## History

- 2026-10-09: The next one is scheduled in a few questions from Next Kumite; the draft has a day, not a time (was 0087).
- 2026-10-09: An admin deletes a tournament, the cascade doing the work (was 0088).
- 2026-10-09: Sign-up opens on a day, asked as the second question (was 0089).
- 2026-10-09: A series has usual hours, the Kumite at Friday training's (was 0091).
- 2026-10-21: The questions are a wizard (lib/Wizard, ADR 0117): When, Sign-up, Captains, Check.
- 2026-10-21: Captains are picked from the whole club's list, shown as chips, with no pick order (it's drawn).
- 2026-10-23: Advanced is a mode of the wizard, its steps the editor's tabs, one form shape for both (#163).
- 2026-10-23: A tournament's hours change only when an admin edits them, never by its matches (ADR 0130).
- 2026-10-23: A tournament's sign-up opening is told to members once (topic `places`), by the cron or as an admin opens
  it, marked `signup_told_at`.
- 2026-10-24: Split out of ADR 0074, which had grown to cover the whole tournament; Advanced described as it is now (a
  mode of the wizard, from 0030's History).
