# Calendar

The rules for the club's calendar, in plain words. Each one is checked by the use-case test it links; change the rule,
the test and this line together. Why a piece of code is the way it is stays in a comment beside it.

## The agenda

- Training nights, tournaments and one-offs are one agenda, which the website and the app's calendar both read.
  [agenda.use-cases.test.ts › "a tournament an admin schedules is on the website and in everyone's calendar"](agenda.use-cases.test.ts)
- Moving something moves it everywhere at once.
  [agenda.use-cases.test.ts › "moving the tournament moves it everywhere at once"](agenda.use-cases.test.ts)
- A cancelled training night stays on the calendar, marked.
  [agenda.use-cases.test.ts › "training sessions are on it; cancelling one keeps it there, marked"](agenda.use-cases.test.ts)
- A private one-off is in the app's calendar but not on the website.
  [agenda.use-cases.test.ts › "a private one-off event is in the app's calendar but not on the website"](agenda.use-cases.test.ts)
- A tournament's sign-up deadline is in members' calendars, not on the website; its draft day shows only to its
  captains and the admins, as a day with no time.
  [agenda.use-cases.test.ts › "its draft day shows only to its captains and the admins, as a day: a reminder, with no time"](agenda.use-cases.test.ts)
- A closed draft leaves the calendar; a finished tournament leaves it altogether.
  [agenda.use-cases.test.ts › "a closed draft leaves the calendar; a finished tournament leaves it altogether"](agenda.use-cases.test.ts)
- A draft reset puts draft night back on the calendar.
  [agenda.use-cases.test.ts › "a draft reset puts draft night back on the calendar"](agenda.use-cases.test.ts)
- A tournament that's only a season so far shows its season, not a date.
  [agenda.use-cases.test.ts › "a tournament that's only a season so far shows its season, not a date"](agenda.use-cases.test.ts)

## Clashes

- Before saving a new or moved time, the app asks what's already on then; a save that doesn't move the day or hours
  isn't asked, nor one that's only a season, nor a paused training.
  [clashes.test.ts › "an edit asks only when the day or hours moved, and never about itself"](../../src/lib/clashes.test.ts)
- A clash is anything on the same London day, whatever the hours (or overlapping, for a night past midnight).
  [clashes.use-cases.test.ts › "on the same day is a clash, whatever the hours: the afternoon, or after training's over"](clashes.use-cases.test.ts)
- Not a clash: the day before or after, a night already off, a paused training, a sign-up deadline or draft night.
  [clashes.use-cases.test.ts › "what isn't a clash: the day before or after, a night already off, a sign-up deadline or draft night"](clashes.use-cases.test.ts)
- The admin chooses Cancel it or Keep both for each; keeping both cancels nothing and tells nobody.
  [clashes.use-cases.test.ts › "keeping both: nothing is cancelled and nobody is told"](clashes.use-cases.test.ts)
- What's chosen is cancelled by its own cancel, as from its own page: whoever signed up hears it's off.
  [clashes.use-cases.test.ts › "cancelling it is the session's own cancel: whoever signed up hears it's off, and it stays off as sessions are made"](clashes.use-cases.test.ts)
- A training night past the weeks made ahead still clashes; cancelling makes that night and keeps it off.
  [clashes.use-cases.test.ts › "a Friday past the weeks made ahead still clashes, and cancelling makes that night and keeps it off"](clashes.use-cases.test.ts)
- A tournament is listed but isn't one to cancel here; nor is anything the admin's roles can't cancel, and a member
  can see what's on but cancel nothing.
  [clashes.use-cases.test.ts › "a one-off over training asks too, and a one-off over the Kumite says it's on but isn't one to cancel here"](clashes.use-cases.test.ts)
- With two or more to call off, one answer sets them all, each still to change after.
  [clashes.test.ts › "one answer for all sets every row that can be called off, and leaves the skip alone"](../../src/lib/clashes.test.ts)
- A training asks with its rule, about the nights its save adds or moves, never about its own nights.
  [training.clashes.use-cases.test.ts › "moving Friday Training's hours asks about the Kumite on its nights, never about its own nights"](../training/training.clashes.use-cases.test.ts)
- Something that stays on over a training lets the training skip its own night instead; the skipped night is cancelled
  by its own cancel.
  [training.clashes.use-cases.test.ts › "the Kumite stays on, so the training can skip that night: saved, its own night is made and cancelled"](../training/training.clashes.use-cases.test.ts)
- A training's save holds to what it was asked about: something put on in between refuses it, and it's asked again.
  [training.clashes.use-cases.test.ts › "the Kumite put on between the question and the answer refuses the save, and asked again it's there"](../training/training.clashes.use-cases.test.ts)
- A tournament's or a one-off's save should hold to its answer the same way, but doesn't yet: something put on in
  between is saved over without asking. A known gap (known bug #233).
  [clashes.use-cases.test.ts › "a tournament's save is held to its clash answer (known bug #233)"](clashes.use-cases.test.ts),
  [clashes.use-cases.test.ts › "a one-off's save is held to its clash answer (known bug #233)"](clashes.use-cases.test.ts)
- Two trainings put on the same evening at once: one is saved, the other is asked.
  [training.clashes.concurrency.use-cases.test.ts › "two trainings put on the same evening at once › seed %i: one is saved, the other refused, never both unasked"](../training/training.clashes.concurrency.use-cases.test.ts)
- A training saved without being asked is saved as before.
  [training.clashes.use-cases.test.ts › "a training saved without being asked (no answer sent) is saved as before"](../training/training.clashes.use-cases.test.ts)
