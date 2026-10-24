# 0122. Scheduling over something already on asks whether that's off; each is cancelled by its own cancel

- **Status:** Accepted
- **Date:** 2026-10-22 · updated 2026-10-24

## Context

The Kumite is usually on a Friday, and Friday is training night. An admin putting the Kumite (or a social) on a
Friday evening left Friday Training on the calendar beside it, members signing up for both, unless the admin
remembered to go to the training night and cancel it. The user: "when the admin schedules something over an existing
event, we should ask if the event should be cancelled."

Training nights are rows made 12 weeks ahead from a series' rule ([0030](0030-training-and-tournament-schedule.md));
a tournament is often scheduled further off than that. Cancelling a night already has one path
(`POST /api/sessions/:id/cancelled`): on the record, the "session off" push to whoever's in or waiting, and the night's
charges gone (only uncancelled nights are charged, [0007](0007-dues-and-payments.md)). A one-off has its own cancel.

## Decision

- **Before an editor saves a new or moved time, the app asks the Worker what's on then**:
  `GET /api/calendar/clashes?startsAt=&endsAt=[&except=tournament:5]` (`worker/calendar/clashes.ts`, in
  `events.routes.ts`). The editors that ask: a tournament's editor (`TournamentDateEditor`), the next date's questions
  (`TournamentQuickCreate`), a one-off's sheet (Calendar) and a training's editor (`TrainingEditor`, new or changed).
  A save that doesn't move the day or hours doesn't ask again (`lib/clashes.ts`), nor does one that's only a season
  so far, nor a paused training.
- **A training asks with its rule** (`?weekdays=fri&repeatEvery=&startsOn=&endsOn=&startTime=&endTime=[&series=1]`):
  the Worker works out the nights the save adds or moves over the 12 weeks its nights are made ahead
  (`trainingNights`): every night the rule gives, less those the saved training already has at the same hours (asked
  about when they were put on) and its nights already off. None of its own nights, made or not, is over it.
- **A clash** is a training night, a tournament's day or a one-off on the agenda ([0042](0042-website-reads-the-club-agenda.md))
  on the same London day, whatever the hours (or overlapping its time, for a night past midnight), from today on, not cancelled already, not a paused
  training, not the thing being edited, and with a time: a sign-up deadline or a draft night (all day) never clashes.
  A night the training's rule gives that isn't made yet clashes too (`id: null`, with its series).
- **The sheet** (`lib/ClashSheet`) lists each with its day and hours, and for each the admin can call off, Cancel it or
  Keep both; who's signed up is said ("14 signed up hear it's off if you cancel it"). Save stays off until each is
  chosen; Back, or closing it, returns to the editor with nothing saved. A tournament is listed, not cancellable here
  (it has no cancel; it moves on its own page), and so is anything the admin's roles can't cancel
  (`manage:Training` for a night, `update:Event` for a one-off): the reply says `canCancel`. Once anything is chosen
  to cancel, Save is the red-filled destructive confirm, "Save & cancel" (both words always there, one seen, so
  nothing moves).
- **One answer for all.** With two or more the admin can call off (a weekly training over another lists up to 12
  nights), the sheet opens with "All of these: Cancel them / Keep both" above the rows, the same choice as theirs: it
  sets every one, each still to change after, and shows their answer only while they all agree. It's there from the
  start, so nothing moves.
- **A training can skip its own night instead.** Something that stays on (a tournament, or a thing the admin's roles
  can't cancel) over a training being saved offers "Skip Juniors that night" (the training's short name; "Skip
  training that night" if that won't sit beside the other) or Keep both. Asked with a training's rule, each clash says
  which of the training's nights it's over (`nights: ["2026-10-16"]`). Skipping is a cancel too: Save turns red.
  After the save is in, each of those nights is made if it isn't yet (`POST /api/series/:id/sessions { heldOn }`,
  the same night if it is: a new training's nights are made in its save, so it usually is) and then cancelled by its
  own cancel, so whoever's in hears it's off and nobody's charged. A skip is an answer like the rest: the tournament's
  key goes in the save's `clashes`, and the save is held to it as below.
- **What's chosen is cancelled by its own cancel, after the save is in**: the session's and the one-off's routes, as
  if from their own pages, so the record, the push and the charges are theirs and there's no second cancel. A night
  not made yet is made first (`POST /api/series/:id/sessions { heldOn }`, the one date the rule gives, the same night
  if it's made already); `ensureSessions` skips a date already made, cancelled or not, so it stays off when the weeks
  ahead reach it.
- **A training's save holds to what was asked** ([0121](0121-load-and-concurrency.md)): it sends the keys of every
  clash the sheet showed (`clashes: ["session:12", "tournament:5", "session:1@2027-03-12"]`). The Worker finds what's
  on its new nights again and refuses (409) anything not among them, and the same condition goes on the end of every
  statement in the batch that writes it (the training, its fees, the waiting moving up; `answeredGuard`): no
  tournament, one-off or other training's night on then that wasn't asked about, read from each thing's own row (the
  agenda is written after it), and the other trainings' rules as they were read (a night a rule gives isn't a row
  yet). So something put on between the question and the answer, or between that read and the write, refuses the
  save; the editor asks again, once. Two admins adding trainings on the same evening at once: one is saved, the other
  asked (`training.clashes.concurrency.use-cases.test.ts`). A save that sends no `clashes` (not asked) isn't held.
- **Not one request.** The save and the cancellations are separate requests in order, not one atomic request
  ([0121](0121-load-and-concurrency.md)): each route carries its own audit entry and push (the route wrapper does one of
  each per request), and folding a cancel into a tournament's save would mean a second cancel path with its own
  record and notice. Nothing is lost by the order: a refused save cancels nothing; a cancel that fails after the save
  leaves the night on, which the save note says and the night's own Cancel puts right; and no rule spans the two that
  another request could race (a night cancelled twice is still one cancel, and its push is sent only on the change).

## Consequences

- The Kumite on a Friday is one decision, made where the admin is, not a second trip to the training night.
- A save over something asks one extra read first (the agenda's day index, the active series, that day's nights).
  If the Worker can't be asked, the save goes ahead without asking: the question is a help, not a gate. The failure
  is reported (Sentry, and the dev strip on your machine, ADR 0110), so a broken check isn't invisible.
- A training asks only about the 12 weeks its nights are made ahead: a Kumite further off was asked about from its
  own editor if the training was there then; one set before a new training isn't asked about from the training's.
  A training over another every week lists each night (up to 12), answered all at once or each on its own.
- A tournament or one-off's save isn't held to its answer the same way yet: a clash put on in between saves anyway.
- A night made ahead of the weeks (to cancel it) sits alone until they reach it; "More sessions" fills from today, so
  the gap fills as usual.

## History

- 2026-10-22: Asked before a tournament's or a one-off's save; cancelled through each thing's own cancel, a night
  past the weeks ahead made first.
- 2026-10-22: A training's editor asks too (a new training, or one's days or hours moved), with its rule; its save
  sends what it was asked about and is held to it in the statements that write it; Save is red-filled once it cancels
  something.
- 2026-10-22: One answer for all at the top of the sheet when two or more can be called off; something that stays on
  over a training lets the admin skip the training that night instead (made if need be, then cancelled by its own
  cancel), and each clash asked about with a training's rule says which of its nights it's over.
- 2026-10-23: A clash is by day, not by the hour: anything on the same London day asks, a Kumite in the afternoon
  before Friday Training as much as one over it (the user: "it should at least ask"). Overlapping times still count,
  for a night past midnight. The day before or after doesn't.
- 2026-10-24: A clash question that can't be asked is reported (`reportCaught`, ADR 0110), the save still going
  ahead; the Kumite on the clock journey schedules a Kumite on a Friday at 11:00 through the wizard and is asked about
  Friday Training (closing schedules nothing, Keep both schedules it), as the user had not been.
