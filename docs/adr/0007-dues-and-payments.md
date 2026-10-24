# 0007. Dues are charges per session and tournament, paid by bank transfer with a name reference

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-22
- **Merges:** 0026, 0032, 0034, 0038

## Context

Members pay either a quarterly rate that covers every training, or a fee for each session they attend. Tournaments
are paid for on their own, and each edition can cost something different from the last. Fees are set by admins and
change over time. Card providers charge per transaction, which conflicts with [0003](0003-free-tiers-only.md).

The club needs to know who owes what and for how long (an aged-receivables report), who paid for what ("Jo paid for
last Friday and the Kumite"), and what each night brought in. The hard part is attendance: teams are built from app
sign-ups, but people still turn up without signing up. Monthly invoices, drafted, reviewed and sent, are more process
than a volunteer-run club needs.

Two kinds of member are easy to confuse because both carry the club's name: **Cougars Quarterly Members** pay the
quarterly rate; **the Cougars** are the club's official team, who play together on one team called "Cougars" when
training teams are made (as the old app did).

Built in #46: fees, charges, payments, a member's Dues, Unpaid fees and the charges on the member sheet all read and
write D1 (`apps/team/worker/dues/dues.ts`, with the sums in `apps/team/src/lib/dues.ts`). Reminders by email were built
in #79 (`apps/team/worker/dues/reminders.ts`). Not built yet: the bank-statement upload, and an override of one
session's fee.

## Decision

**Payment**

- Members pay by **bank transfer** (or cash, marked by hand). No card provider.
- Each member quotes **their own fixed reference**: `COUGARS`, their first name and their surname's initial,
  `COUGARS ADRIAN K`. UK bank references hold 18 characters, letters, digits and spaces, shown in capitals:
  - accents are dropped and letters a bank won't take are spelled out (Ł → L, ß → SS); anything else goes;
  - the first name is cut to leave room for a clash digit, so it always fits;
  - a second person with the same first name and initial gets the next digit, `COUGARS SAM T2`, up to 9; past that,
    `COUGARS` and their id.
- The reference is set once, when the member is made (a join request, an admin adding them, or the roster seed), and
  never changed after, not even when their name is edited: it's what their standing order quotes. Someone without one
  gets it the next time they sign in. `packages/shared/payment-reference.ts` holds the rules and the SQL, used by both the
  Worker (`giveReference` in apps/team/worker/auth/auth.ts) and the roster seed (scripts/lib/roster.mjs).

**Fees**

- **Trainings have a fee that applies going forward**: a dated schedule per training (`series_fees`: amount,
  effective_from), set in the training's editor. A session's fee is the one in force on its date
  (`training_sessions.fee_pence` holds it). A new fee from a later date leaves earlier nights alone; **changing a fee
  from an earlier date recalculates every night it covers**, paid or not: a night already paid owes the difference
  when the fee goes up, and its overpayment becomes credit when it goes down. The same goes for a tournament's fee and
  the quarterly rate (quarters charged by hand keep what the admin said). No fee in force: nobody is charged, so the
  first fee's date decides how far back charging goes. An admin can also recalculate a member's dues by hand
  (Dues tab → Recalculate). (Overriding one session's fee is not built.)
- **Tournament types have a default fee; each edition has its own.** Scheduling an edition copies the type's default
  (`tournament_types.default_fee_pence` → `tournaments.fee_pence`), and the admin can change it there. (Built.)
- The **quarterly rate** is its own dated schedule (`subscription_fees`), kept on Settings → Membership (the quarterly membership's price, "£90 a quarter"); there is
  no single club-wide per-session fee. Fees are set with `manage:Fees`: saving a training changes its fees only for
  someone who holds it.

**Quarterly Members and the Cougars**

- **A quarterly membership is a subscription**, in its own table: `subscriptions` (member_id, starts_on, ends_on). A
  member with a subscription covering a date is a Quarterly Member on that date; anyone without one pays as they go,
  and nothing about it is stored on `members`.
- **Members choose next quarter's plan themselves.** Once a quarter the club asks its members whether to pay as they
  go or be Quarterly next quarter. On their Dues page a member sees this quarter's plan (fixed once it's started; an
  admin can still change it, from today) and chooses next quarter's, until it starts: Quarterly adds a subscription
  from its first day, or keeps theirs running; pay as you go ends theirs on this quarter's last day. **The server
  checks the date** (`PUT /api/me/plan`, London time): only next quarter, and only before it starts, whatever the app
  showed, so a page left open past the start can't change it. It's on the record (`member.plan`).
- **The Cougars are `members.cougar`**: whether someone is on the official team. Admins set it on the member sheet; the
  roster seed sets it when it first adds a player (`"cougar": true`) and never changes it after. The team generator
  puts every Cougar on one team first, then balances the rest by rating.
- **Keepers play training free: the Keeper plan.** The club needs someone in net every Friday, so a keeper (position
  G) is never charged for a training night or a quarter, whatever else is on record (a subscription from before they
  were a keeper stays, and charges nothing). There's no plan for them to choose: the server refuses next quarter's
  plan for a keeper and an admin making one Quarterly (409). Tournaments they enter are charged as for anyone. It
  follows the position, so making someone a keeper takes their unpaid training charges off at the next
  recalculation; a paid one stays, as always. A keeper isn't in the Quarterly-first sign-up order either (ADR 0131).
- The two are independent: a Cougar may or may not be a Quarterly Member, and the other way round. In the app,
  "Cougar" always means the official team; quarterly membership is shown as "Quarterly".

**Charges**

- **Attendance comes from the register**: on the night one screen lists who signed up, marks no-shows and adds
  walk-ins. Someone signed up counts as there unless marked a no-show. A walk-in keeps to the places like a sign-up
  ([0131](0131-training-sign-ups.md)): on a full night they wait, and someone waiting is never
  charged until they're in (a place comes up or the team maker lets them in). A night that's over is a record of who
  came: a walk-in ticked there is in and charged.
- **There is no closing the register: charges follow it** (#11). From a session's day, everyone in who isn't a no-show
  (walk-ins included) is charged; ticking someone in charges them at once, unticking takes an unpaid charge off.
  Anything that changes who came (a tick, a sign-up, an admin adding someone, a cancellation) works the charges out
  again, and so does the hourly Cron Trigger, which is what charges a session's sign-ups on its day. A paid charge is
  never taken off by this.
- **A charge is one person for one session, tournament or quarter** (`charges`: member, session or tournament or
  quarter `2026-Q4`, amount, due_on, created_by when made by hand). Quarterly Members aren't charged for training
  sessions, and **a quarter charged pays for every training night in it**, by membership or by hand: joining
  mid-quarter pays the whole quarter, so the nights before they joined are covered too. A night already paid that a
  quarter then covers is credit; a quarter taken back puts its nights back. Tournament entrants are all charged from its day, Quarterly Members included.
- **Quarters are calendar quarters** (January, April, July, October). The hourly Cron Trigger charges each Quarterly
  Member the rate in force for every quarter a subscription covers, up to the current one: due on the quarter's first
  day, or the day they joined (joining mid-quarter pays the full quarter). A subscription taken back the day it was
  made takes its unpaid charge with it.
- **An admin can charge a member for a quarter by hand** (member sheet → Charge a quarter, `record:Payment`), at the
  rate on its first day unless they change it: for someone who isn't a Quarterly Member in the app, or a quarter
  missed. Only a charge made by hand can be taken back by hand; the rest follow who came or the subscription.

**Payments**

- **Dues are a ledger.** A member's dues (their own Dues page, and the Dues tab on their card for admins) read like a
  bank statement: every charge and payment by date, newest first, with what they owe after each (below nothing,
  credit). Its header stays in view as it scrolls. Payments are allocated to charges behind it
  (`payment_allocations`) but aren't ticked off charge by charge.
- **Adjustments, with why.** Whoever records payments can adjust what someone owes, for whatever reason, saying why
  (Adjust on the Dues tab): adding to it is a charge with a `reason`; taking some off is like money in (a payment,
  `via = 'adjustment'`, with its `reason`), paying their oldest charges first. Each is a line on their ledger, can be
  taken back from it, and is on the record (`dues.adjusted`).
- **A payment is dated the day it came in**: today unless the admin picks an earlier day, never the future.
- **A lump sum pays the oldest first (FIFO).** "Record a payment" on the member sheet takes any amount: it pays their
  oldest charges not yet paid in full, then part of the next. What's left over is **credit**, which pays each new
  charge as it comes (also oldest payment first). A charge part paid this way shows what's paid and what's to go.
  A payment recorded by mistake is taken back from the ledger (two taps): what it paid is owed again, and any other
  credit then pays again, oldest first. A charge that stops counting (unticked) goes unless it's paid in full; what part of
  it was paid is credit again.
- A **bank-statement upload** (later) creates payments by reference and allocates them oldest first, which the admin
  can then re-point. Matching is by the whole reference, never by the name in it.

**Reminders**

- **The club's bank details are a club setting** (`club_settings`: the account's name, sort code and number), filled
  in by whoever sets fees (`manage:Fees`) from Unpaid fees → Manage → Bank details, and on the record
  (`settings.bank`). Every member sees them on their Dues page beside their reference; until they're in, it says to
  ask the treasurer, never sample numbers. Nothing is emailed without them.
- **Whoever records payments (`record:Payment`) sends the reminders, by hand.** Unpaid fees has one main button,
  **Send reminders** (everyone who owes), and a member's card has Dues tab → Email what they owe (just them). First
  they see who gets one (what each owes, how late, when they were last reminded, who's held back) and what one says;
  then they send. It's on the record (`dues.reminded`).
- **The email** is the member's own: each unpaid charge (the day, what for, what's left on it), the total, their
  reference and the bank details. Plain text first, the same in the club's frame; firmer the longer it's been. With it, a notification on their phone if they have the store app
  ([0108](0108-store-apps.md)): the dues code tells a member through one call (`worker/tell/tell.ts`), which sends the
  email under the mail rules ([0027](0027-email-through-gmail-api.md)) and the notification through `notify`, so a
  new channel (web push, #24) doesn't touch the dues code.
- **Nothing reminds anyone on its own, for now.** No cron sends reminders: an admin decides when. A configurable
  schedule (how often, by how late, at what time of day) is a later issue,
  [#143](https://github.com/battersea-cougars/ark/issues/143). How firm the email is still follows the age of the
  member's oldest unpaid charge (Unpaid fees' buckets).
- **At most one reminder a week to anyone**: a double tap, or two admins sending at once, sends one, and someone
  reminded this week is held back (the preview says so). A member with no email, or not active, gets none.
- **Claimed, then sent a few at a time.** A reminder is claimed first, as a queued row in `dues_reminders`, in one
  statement that checks the week, so two sends at once claim one. The send itself sends the first few; then a run
  takes the next few to send (`sending`, in the same round trip that reads them), so an admin's Send beside the
  five-minute cron, or two runs at once, never both email someone; a run that died is overtaken after ten minutes.
  Each run sends at most 10 (a Worker run makes at most 50 requests, each email is one, and the same cron run also
  drains the push outbox: [0121](0121-load-and-concurrency.md) has the sums); the phones hear it with the next push
  drain. The rest go on the next five-minute runs, so a send to the whole club is done within the hour. A send that
  fails is released, so the admin can send it again; someone who has paid by the time it goes gets nothing. Admins see
  when someone was last reminded.

**What people see**

- A member's **Dues**: what they owe, each session and tournament they were charged for and whether it's paid, and the
  bank details with their reference.
- **Owing is a badge, not a nag.** The Dues tab carries what you owe as a badge until it's paid, and Home's header
  as a quiet chip ("£24 to pay", opening your tab), never a row in its feed: the session you came to sign up for
  leads the page ([0118](0118-home-calls-to-action-then-feed.md)). Settling up before signing up is an open question (#66).
- **What a session collected** is the sum of its paid charges, shown beside what it was due (the training's editor).
- Who sees everyone's charges: `read:Dues` or `record:Payment`. Anyone else sees only their own (ADR 0036).
- Marking a payment, taking one back, a lump sum, a quarter charged or taken back by hand, and a new quarterly rate
  are on the record ([0095](0095-audit-log.md)).
- **Unpaid fees** (`read:Dues`), the club's aged-receivables report, is just the unpaid charges, summed per member and
  bucketed by each charge's age in plain words: **Up to 30 days**, **31 to 60 days**, **61 to 90 days**, **Over 90
  days** (ranges say "to", never a dash). The reminders' stored stages keep their old keys (`minor`, `major`,
  `misconduct`); nobody sees them. Column totals, a drill-down to each member's charges, and CSV export. Send reminders
  is its main button; its Manage button holds the bank details.

## Consequences

- No card fees and no PCI scope. No invoices to draft or send: the reports and a member's tab read straight from
  charges and payments.
- Every pound owed or paid points at a session or tournament: the club can see who paid for what and what each night
  brought in.
- The treasurer can read who paid off the statement without looking anything up. A reference shows a first name and an
  initial to whoever sees the payer's or the club's statement, no more than the payer's own name the bank shows beside
  it. Two people can look alike (`SAM T` and `SAM T2`), so matching is by the whole reference.
- A reference doesn't follow a name change. If someone wants theirs changed, that's an edit by hand, and they must
  update their standing order.
- Dues are only as good as the register; it has to be quick enough that someone does it every Friday. With no closing
  step, a late correction just changes the charges; a night already paid for stays charged until the payment is taken
  back.
- "Who's a Quarterly Member this quarter" is a date query on `subscriptions`; history comes for free, lapsing needs no
  update to the member, and pay-as-you-go needs no rows.
- Someone who pays for a month at once is one payment of that amount, not a tick per night.
- The day's charges for a session appear that morning, before anyone has played; dropping out takes them off.
- Deleting a tournament deletes its charges, paid ones too.
- Still open: concessions, a free first session.

## History

- 2026-10-05: Payments by bank transfer quoting a unique reference per invoice (`COU-2611-0042`), monthly invoices
  emailed by the app, reconciled by hand or from a bank CSV; no card provider (was 0007).
- 2026-10-06: No invoices: dues became a ledger of charges fed by the register, one fixed reference per member, payments
  settling the oldest charges first, the Overdue Rentals report (was 0026).
- 2026-10-06: Fees belong to each training (dated) and each tournament edition; a charge is one person for one session
  or tournament, and payments are ticked against charges rather than allocated oldest first (was 0032).
- 2026-10-06: `member_plans` became `subscriptions` (a Quarterly Member is someone with a covering subscription); the
  Cougars became a flag on the member, `members.cougar` (was 0034).
- 2026-10-07: The reference became the member's name, `COUGARS ADRIAN K`, instead of `COU-0004` from their id; the old
  references were cleared, as nobody had paid with one (was 0038).
- 2026-10-08: Overdue Rentals was renamed Unpaid fees in the app and the roadmap; no record of its own.
- 2026-10-09: Built (#46). No closing the register: charges follow who came, worked out after each change and hourly
  (#11). Calendar quarters, charged by the hourly Cron Trigger; joining mid-quarter pays that quarter; an admin can
  charge a quarter by hand. A lump sum pays the oldest charges first, with credit for what's left. Changing a fee from
  an earlier date recalculates what it covers, paid charges too (was: a session kept the fee it first charged at). The
  seed charges from 1 October 2025: Friday Training £12 a session, the quarterly rate £90.
- 2026-10-09: The age buckets are hockey penalties (Minor, Major, Misconduct, Ejected), not the prototype's video-shop
  Due back / Late / Very late / Lost tape.
- 2026-10-09: Mark all paid went: Record a payment does the same with the amount. A payment always says how much. The
  member sheet's Payments tab is Dues, as the member's own page is called.
- 2026-10-09: A quarter charged covers its training nights (was: only nights from the day the membership started, so
  a member made Quarterly mid-quarter, or charged a quarter by hand, paid the quarter and its nights).
- 2026-10-09: Dues are a ledger, charges and payments by date with a running balance (was: Not paid yet and Payment
  history lists, with Transfer and Cash on each charge). A payment is taken back from the ledger, by itself.
- 2026-10-09: Members choose next quarter's plan on their Dues page (where their money is), until it starts; the server checks the date.
- 2026-10-09: Adjustments, either way, each with its reason; a payment has the day it came in.
- 2026-10-09: Home stopped showing your dues every visit (red until paid, then an all-clear); the Dues tab's badge says
  it, and Home only once a charge is over 60 days, below the lead session.
- 2026-10-10: Keepers play training free (the Keeper plan): no session or quarter charges, no plan to choose.
- 2026-10-20: Reminders by email (#79): an admin emails what each member owes from Unpaid fees or a member's card,
  after a preview, and the hourly cron reminds members as their oldest charge ages (Minor from 14 days every 4 weeks,
  Major every 2, Misconduct weekly, none once Ejected), at most one a week each, an admin's included. Claimed before
  they're sent, 15 a run. The bank details became a club setting (they were sample numbers on the Dues page). Each
  reminder notifies the member's phone too.
- 2026-10-20: A walk-in on a full night (or one added before it) waits for the team maker's Let in instead of being
  in whatever the places, so isn't charged until they're in; a night that's over still records who came.
- 2026-10-21: What you owe moved from a row on Home (after 60 days) to a small chip in Home's header, shown while
  you owe anything ([0118](0118-home-calls-to-action-then-feed.md)).
- 2026-10-21: The age buckets are plain words (Up to 30 days, 31 to 60 days, 61 to 90 days, Over 90 days), not
  hockey penalties: "Ejected" read as if we'd thrown people out. Home's admin line says "£N over 90 days late"; the
  later reminder emails lost "Misconduct" and "Ejected territory". Stored stage keys unchanged.
- 2026-10-21: Settings' Quarterly rate is Membership, its page the quarterly membership's price ("£90 a quarter"), a
  new one a "New quarterly membership price"; what admins read only, the code and data keep `fees`. "Call Quarterly
  rate 'Subscriptions' or 'Membership settings'."
- 2026-10-21: Two runs sending reminders at once (an admin's Send and the five-minute cron) emailed someone twice: a
  run now takes what it sends first (`dues_reminders.sending`); 10 a run instead of 15, so a cron run keeps within 50
  subrequests with the push drain beside it ([0121](0121-load-and-concurrency.md)).
- 2026-10-22: Automatic reminders are off until a configurable schedule ([#143](https://github.com/battersea-cougars/ark/issues/143)):
  the hourly cron reminds nobody (`remindDue` and the age rules, the 10:00 to 20:00 window and the claim limit went);
  an admin sends them with Send reminders, Unpaid fees' main button (was: under Manage), after the same preview. Still
  at most one a week each; the five-minute cron still sends what a send left queued. "For now, let's just make it so
  the admin sends out the reminders with a button push. Then later we can build some kind of configurable schedule."
- 2026-10-22: On Home, what you owe is at the foot (Your tab, with how much is overdue), and while some of it is
  overdue (a charge whose day has passed, `lib/dues.ts` `overdue`) a pound icon with a red dot in Home's header opens your tab
  ([0118](0118-home-calls-to-action-then-feed.md)).
