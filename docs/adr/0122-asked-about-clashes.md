# 0122. Scheduling over something already on asks whether that's off; each is cancelled by its own cancel

- **Status:** Accepted
- **Date:** 2026-10-22

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
  (`TournamentQuickCreate`) and a one-off's sheet (Calendar). A save that doesn't move the day or hours doesn't ask
  again (`lib/clashes.ts`), nor does one that's only a season so far.
- **A clash** is a training night, a tournament's day or a one-off on the agenda ([0042](0042-website-reads-the-club-agenda.md))
  whose time overlaps (one ending as the other starts doesn't), from today on, not cancelled already, not a paused
  training, not the thing being edited, and with a time: a sign-up deadline or a draft night (all day) never clashes.
  A night the training's rule gives that isn't made yet clashes too (`id: null`, with its series).
- **The sheet** (`lib/ClashSheet`) lists each with its day and hours, and for each the admin can call off, Cancel it or
  Keep both; who's signed up is said ("14 signed up hear it's off if you cancel it"). Save stays off until each is
  chosen; Back, or closing it, returns to the editor with nothing saved. A tournament is listed, not cancellable here
  (it has no cancel; it moves on its own page), and so is anything the admin's roles can't cancel
  (`manage:Training` for a night, `update:Event` for a one-off): the reply says `canCancel`.
- **What's chosen is cancelled by its own cancel, after the save is in**: the session's and the one-off's routes, as
  if from their own pages, so the record, the push and the charges are theirs and there's no second cancel. A night
  not made yet is made first (`POST /api/series/:id/sessions { heldOn }`, the one date the rule gives, the same night
  if it's made already); `ensureSessions` skips a date already made, cancelled or not, so it stays off when the weeks
  ahead reach it.
- **Not one request.** The save and the cancellations are separate requests in order, not one atomic request
  ([0121](0121-load-and-concurrency.md)): each route carries its own audit entry and push (the route wrapper does one of
  each per request), and folding a cancel into a tournament's save would mean a second cancel path with its own
  record and notice. Nothing is lost by the order: a refused save cancels nothing; a cancel that fails after the save
  leaves the night on, which the save note says and the night's own Cancel puts right; and no rule spans the two that
  another request could race (a night cancelled twice is still one cancel, and its push is sent only on the change).

## Consequences

- The Kumite on a Friday is one decision, made where the admin is, not a second trip to the training night.
- A save over something asks one extra read first (the agenda's day index, the active series, that day's nights).
  If the Worker can't be asked, the save goes ahead without asking: the question is a help, not a gate.
- A training series' own editor doesn't ask: its rule makes nights for months, and a training over a one-off is
  rare; it can follow the same sheet if wanted.
- A night made ahead of the weeks (to cancel it) sits alone until they reach it; "More sessions" fills from today, so
  the gap fills as usual.

## History

- 2026-10-22: Asked before a tournament's or a one-off's save; cancelled through each thing's own cancel, a night
  past the weeks ahead made first.
