# Dues

The rules for what members owe and pay, in plain words. Each one is checked by the use-case test it links; change the
rule, the test and this line together. Why a piece of code is the way it is stays in a comment beside it.

## Payment references

- Members pay by bank transfer (or cash, marked by hand), quoting their own reference: `COUGARS`, their first name and
  their surname's initial, in capitals.
  [payment-reference.test.ts › "is their first name and surname initial, in capitals"](../../../../packages/shared/payment-reference.test.ts)
- A reference holds only what a UK bank takes: accents dropped, other letters spelled out (Ł → L, ß → SS).
  [payment-reference.test.ts › "takes only what a bank takes: accents dropped, other letters spelled out"](../../../../packages/shared/payment-reference.test.ts)
- It always fits the bank's 18 characters: the first name is cut to leave room for a clash digit.
  [payment-reference.test.ts › "fits in 18 characters with room for a clash digit"](../../../../packages/shared/payment-reference.test.ts)
- A second person with the same first name and initial gets the next digit (`COUGARS SAM T2`), and the first keeps
  theirs.
  [payment-reference.test.ts › "gives a second person of the same name and initial the next number, and never changes the first"](../../../../packages/shared/payment-reference.test.ts)
- Past nine of them, the next is `COUGARS` and their member number.
  [payment-reference.test.ts › "past nine of the same name and initial, the next is COUGARS and their member number"](../../../../packages/shared/payment-reference.test.ts)
- A reference is set once and never changed after, not even when their name is edited: it's what their standing order
  quotes.
  [dues.reference.use-cases.test.ts › "stays as it was when an admin changes their name: it's what their standing order quotes"](dues.reference.use-cases.test.ts)
- Someone without one gets theirs the next time they sign in.
  [dues.reference.use-cases.test.ts › "someone without one gets theirs the next time they sign in"](dues.reference.use-cases.test.ts)

## Fees

- A training's fee applies from a date going forward: a night costs the fee in force on its day, and a new fee from a
  later date leaves earlier nights alone.
  [dues.use-cases.test.ts › "a new fee from a later date leaves nights before it as they were"](dues.use-cases.test.ts)
- Changing a fee from an earlier date recalculates every night it covers, paid or not: a paid night owes the
  difference when it goes up, and gives credit when it goes down.
  [dues.use-cases.test.ts › "a night already paid owes the difference when the fee goes up, and gives credit when it goes down"](dues.use-cases.test.ts)
- That holds for nights whose register has closed too: the fee isn't the register.
  [dues.fee-dates.use-cases.test.ts › "a night paid at the old fee is recalculated: lower is credit, higher is owed, one charge each"](dues.fee-dates.use-cases.test.ts)
- With no fee in force, nobody is charged; a fee of nothing makes its nights free.
  [dues.use-cases.test.ts › "with no fee set, nobody is charged"](dues.use-cases.test.ts)
  [dues.fee-dates.use-cases.test.ts › "makes its nights free, with no £0 charge owed, and leaves the nights before it charged"](dues.fee-dates.use-cases.test.ts)
- An admin can recalculate a member's dues by hand.
  [dues.use-cases.test.ts › "an admin recalculates a member's dues by hand"](dues.use-cases.test.ts)
- A tournament series has a default fee; a new tournament in it takes that fee, and the admin can change it there.
  [tournaments.use-cases.test.ts › "an admin schedules the next one with just its season: the day, the draft's date and the captains can come later"](../tournaments/tournaments.use-cases.test.ts)
- Only whoever sets fees can change one: someone who runs trainings can save a training, but not with a new fee, and a
  treasurer can't set the quarterly rate.
  [dues.edge-cases.use-cases.test.ts › "someone who runs trainings but doesn't set fees saves a training as it is, never a new fee"](dues.edge-cases.use-cases.test.ts)
  [dues.edge-cases.use-cases.test.ts › "a treasurer records payments, charges and adjustments, but can't set the quarterly rate"](dues.edge-cases.use-cases.test.ts)

## Quarterly Members and keepers

- Quarterly Members aren't charged for training nights; they pay the quarterly rate instead.
  [dues.use-cases.test.ts › "a Quarterly Member isn't charged for training"](dues.use-cases.test.ts)
- Quarters are calendar quarters, charged at the rate in force on the day they're due: the quarter's first day, in
  London time.
  [dues.use-cases.test.ts › "Quarterly Members are charged it at the start of each quarter"](dues.use-cases.test.ts)
  [dues.edge-cases.use-cases.test.ts › "a Quarterly Member's January is charged at midnight on New Year's Eve, not a minute before (GMT)"](dues.edge-cases.use-cases.test.ts)
- Joining mid-quarter pays the whole quarter, so the nights before they joined are covered too.
  [dues.use-cases.test.ts › "joining mid-quarter pays the whole quarter, so the nights before they joined are covered too"](dues.use-cases.test.ts)
- A quarterly membership taken back the day it was made takes its unpaid charge with it.
  [dues.use-cases.test.ts › "a quarterly membership taken back the day it was made takes its unpaid charge with it"](dues.use-cases.test.ts)
- Members choose next quarter's plan themselves, until it starts; this quarter's is fixed. The server goes by today's
  date, so an app left open past the start can't change it.
  [dues.plan.use-cases.test.ts › "this quarter is fixed, and only next quarter is open"](dues.plan.use-cases.test.ts)
  [dues.plan.use-cases.test.ts › "an app left open past the quarter's start can't change it: the server goes by today's date"](dues.plan.use-cases.test.ts)
- An admin can charge a member for a quarter by hand, at the quarterly rate unless they give an amount, and take it
  back; only a charge made by hand can be taken back by hand.
  [dues.use-cases.test.ts › "a quarter charged by hand uses the quarterly rate when no amount is given"](dues.use-cases.test.ts)
  [dues.edge-cases.use-cases.test.ts › "a night's charge can't be taken back by hand (change who came instead), nor a quarter once it's part paid"](dues.edge-cases.use-cases.test.ts)
- A quarter charged covers that quarter's training nights; a night already paid that a quarter then covers is credit.
  [dues.use-cases.test.ts › "a quarter charged by hand covers that quarter's training nights: they come off, other quarters' stay"](dues.use-cases.test.ts)
  [dues.use-cases.test.ts › "a night already paid, then covered by a quarter, is credit"](dues.use-cases.test.ts)
- Keepers play training free (the Keeper plan): never charged for a night or a quarter, whatever subscription is on
  record.
  [dues.keeper.use-cases.test.ts › "a keeper at Friday's session isn't charged; a skater beside them is"](dues.keeper.use-cases.test.ts)
  [dues.keeper.use-cases.test.ts › "a keeper with a quarterly membership isn't charged the quarter"](dues.keeper.use-cases.test.ts)
- It follows the position: making someone a keeper takes their unpaid training nights off; a paid one stays.
  [dues.keeper.use-cases.test.ts › "making someone a keeper takes their unpaid training nights off; a night they've paid stays"](dues.keeper.use-cases.test.ts)
- A keeper has no plan to choose, and an admin can't make them Quarterly; tournaments they enter are charged as for
  anyone.
  [dues.keeper.use-cases.test.ts › "a keeper has no plan to choose, and an admin can't make them Quarterly"](dues.keeper.use-cases.test.ts)
  [dues.keeper.use-cases.test.ts › "a tournament a keeper enters is charged as for anyone"](dues.keeper.use-cases.test.ts)

## Charges and the register

- Who came is charged: ticking someone in charges them that night's fee, and unticking takes an unpaid charge off.
  [dues.use-cases.test.ts › "the session lead ticks someone in at last Friday's session, and they owe that night's fee in Unpaid fees"](dues.use-cases.test.ts)
  [dues.use-cases.test.ts › "unticking them takes the charge off again"](dues.use-cases.test.ts)
- Everyone signed up is charged from the night's day, except a no-show; a cancelled night charges nobody.
  [dues.use-cases.test.ts › "everyone signed up is charged from the day of the session, except a no-show"](dues.use-cases.test.ts)
  [dues.use-cases.test.ts › "a cancelled session charges nobody"](dues.use-cases.test.ts)
- A walk-in on a full night waits, and isn't charged until they're let in.
  [dues.use-cases.test.ts › "a walk-in on a full night waits, and isn't charged until they're let in"](dues.use-cases.test.ts)
- The register closes at 06:00 London the morning after; from then its charges stand, and the hourly run charges from
  it once each, run after run.
  [training.register-closes.use-cases.test.ts › "the hourly run charges from the closed register, run after run, once each: Reg and Walt, not Nina"](../training/training.register-closes.use-cases.test.ts)
  [training.register-closes.use-cases.test.ts › "a closed night can't be reset, called off, or put back on: its charges stand"](../training/training.register-closes.use-cases.test.ts)
- Each person is charged once a night, however many runs and taps come at once.
  [dues.concurrency.use-cases.test.ts › "Friday comes due while players say they're in and the cron runs twice: each charged once, paid once from their credit (seed %i)"](dues.concurrency.use-cases.test.ts)
- A tournament charges everyone who entered from its day, Quarterly Members too.
  [dues.use-cases.test.ts › "a tournament charges everyone who entered from its day, Quarterly Members too"](dues.use-cases.test.ts)
- A tournament deleted takes its charges with it; what anyone paid comes back as their credit.
  [draft.edge-cases.use-cases.test.ts › "an admin deletes a tournament someone has paid for: what they paid comes back as their credit"](../tournaments/draft.edge-cases.use-cases.test.ts)
- A change works out again only the charges it can move (`dues.scope.ts`): a night's or a tournament's (the register,
  a let-in, a reset, a night called off), or a member's (their attendance, quarterly membership, a payment, an
  adjustment). A fee or the quarterly rate from an earlier date, a tournament made, saved or deleted, and Recalculate
  still work out the whole club. What everyone owes comes out the same either way, to the penny.
  [dues.history.use-cases.test.ts › "each mark works out that night's charges by index, not every charge there's been"](dues.history.use-cases.test.ts)
  [dues.history.use-cases.test.ts › "what everyone owes comes out as the whole club's working-out has it, to the penny"](dues.history.use-cases.test.ts)
- A sign-up before its night's day charges nothing and works nothing out; on the day, it charges the night's fee at
  once.
  [entries.charges.use-cases.test.ts › "in on Tuesday for Friday: nobody's charges are worked out again, and nothing's owed yet"](../entries/entries.charges.use-cases.test.ts)
  [entries.charges.use-cases.test.ts › "in on Friday morning: charged that night's fee at once, as before"](../entries/entries.charges.use-cases.test.ts)
- The hourly run works out only what a new day can change: the nights and tournaments since it last ran
  (`data_version.charged_through`) and the Quarterly Members.
  [dues.history.use-cases.test.ts › "the hourly run works out only what a new day can change, by index"](dues.history.use-cases.test.ts)

## Payments and the ledger

- A member's dues read like a bank statement: every charge and payment by date, newest first, with what they owe after
  each.
  [dues.ledger.use-cases.test.ts › "each line's balance is what the whole ledger works out, for every member, whatever the page size"](dues.ledger.use-cases.test.ts)
- A payment is dated the day it came in: today unless the admin says, never in the future.
  [dues.use-cases.test.ts › "a payment is dated the day it came in: today unless they say, never in the future"](dues.use-cases.test.ts)
- A lump sum pays the oldest charges first, and part of the next; what's left over is credit, which pays each new
  charge as it comes.
  [dues.use-cases.test.ts › "a lump sum pays the oldest dues first, and part of the next"](dues.use-cases.test.ts)
  [dues.use-cases.test.ts › "money left over is their credit, and pays the next charge as it comes"](dues.use-cases.test.ts)
- Credit is the member's own: it never pays anyone else's dues.
  [dues.edge-cases.use-cases.test.ts › "credit is the member's own: it never pays anyone else's dues"](dues.edge-cases.use-cases.test.ts)
- A payment recorded by mistake is taken back from the ledger: what it paid is owed again, and other credit pays the
  oldest first again.
  [dues.use-cases.test.ts › "a payment recorded by mistake is taken back from the ledger: what it paid is owed again"](dues.use-cases.test.ts)
  [dues.use-cases.test.ts › "taking back one payment leaves the others, which pay the oldest first again"](dues.use-cases.test.ts)
- A paid night stays if they're unticked later; one paid in part goes, and what was paid on it is credit again.
  [dues.use-cases.test.ts › "a paid night stays on their record if they're unticked later"](dues.use-cases.test.ts)
  [dues.edge-cases.use-cases.test.ts › "a night paid in part, then unticked, goes, and what was paid on it is credit again"](dues.edge-cases.use-cases.test.ts)
- Whoever records payments can adjust what someone owes, saying why: adding is a charge, taking off pays their oldest
  first, and either can be taken back.
  [dues.use-cases.test.ts › "an admin adds to what someone owes, saying why: a line on their ledger, owed like any charge"](dues.use-cases.test.ts)
  [dues.use-cases.test.ts › "an admin takes some off what someone owes, saying why: it pays what they owe, oldest first"](dues.use-cases.test.ts)
  [dues.use-cases.test.ts › "either is taken back from the ledger if it was a mistake"](dues.use-cases.test.ts)
- Payments, adjustments and plan choices are on the record.
  [dues.use-cases.test.ts › "payments are on the record"](dues.use-cases.test.ts)
  [dues.use-cases.test.ts › "is for whoever records payments, and on the record"](dues.use-cases.test.ts)
  [dues.plan.use-cases.test.ts › "the choice is on the record"](dues.plan.use-cases.test.ts)

## Reminders

- The club's bank details are filled in by whoever sets fees, and every member sees them on their Dues page; nothing
  is emailed without them.
  [reminders.use-cases.test.ts › "whoever sets fees fills them in, and every member sees them on their Dues page"](reminders.use-cases.test.ts)
  [reminders.use-cases.test.ts › "needs the bank details first: the preview says so, and nothing is sent"](reminders.use-cases.test.ts)
- Whoever records payments sends reminders by hand, to everyone who owes or one member, after seeing who gets one and
  what it says.
  [reminders.use-cases.test.ts › "sees who'll get one and what it says before sending: everyone who owes, with what and how long"](reminders.use-cases.test.ts)
  [reminders.use-cases.test.ts › "sends to one member, from their card"](reminders.use-cases.test.ts)
- Nothing reminds anyone of what they owe on its own; how firm the email is follows how long it's been.
  [reminders.use-cases.test.ts › "the hourly cron reminds nobody, however old what they owe gets"](reminders.use-cases.test.ts)
  [reminders.use-cases.test.ts › "how firm the letter is still follows how long it's been: the admin's send reads the age"](reminders.use-cases.test.ts)
- At most one reminder a week to anyone: a double tap, or two admins at once, sends one.
  [reminders.use-cases.test.ts › "a second send within the week holds back whoever already had one; a week on, it goes"](reminders.use-cases.test.ts)
  [reminders.use-cases.test.ts › "a double tap, or two admins at once, sends one"](reminders.use-cases.test.ts)
- Someone with no email, who's left, who owes nothing or who has paid by the time it goes gets none.
  [reminders.use-cases.test.ts › "someone with no email address is listed, and their email can be read, but nothing goes"](reminders.use-cases.test.ts)
  [reminders.edge-cases.use-cases.test.ts › "a member who's left the club isn't listed or reminded, though they still owe"](reminders.edge-cases.use-cases.test.ts)
  [reminders.edge-cases.use-cases.test.ts › "someone who pays between being queued and the run that sends it gets nothing, and can be reminded later"](reminders.edge-cases.use-cases.test.ts)
- A member with the app hears it on their phone too; a send that fails can be sent again.
  [reminders.use-cases.test.ts › "a member with the store app hears it on their phone too"](reminders.use-cases.test.ts)
  [reminders.use-cases.test.ts › "a failed send doesn't count: the admin can send it again"](reminders.use-cases.test.ts)
- A few days before each quarter (five unless the club sets 1 to 30), next quarter's Quarterly Members are told the fee
  and the day to change by; never a keeper or anyone paying as they go.
  [plan-reminders.use-cases.test.ts › "someone who chose Quarterly for next quarter hears it on their phone, and tapping it opens their plan"](plan-reminders.use-cases.test.ts)
  [plan-reminders.use-cases.test.ts › "nobody paying as they go next quarter is told: not by choice, not by never choosing"](plan-reminders.use-cases.test.ts)
  [plan-reminders.use-cases.test.ts › "a keeper isn't told: the Keeper plan is never charged, whatever subscription is on record"](plan-reminders.use-cases.test.ts)
  [plan-reminders.use-cases.test.ts › "the lead time is the club's: Settings → Membership, from one day before to thirty"](plan-reminders.use-cases.test.ts)
- It says the quarterly rate in force on the quarter's first day, and the day before as the last day to change.
  [plan-reminders.use-cases.test.ts › "the amount is the quarterly rate in force on the quarter's first day, not today's"](plan-reminders.use-cases.test.ts)
  [plan-reminders.use-cases.test.ts › "the change-by day is the day before the quarter starts, the last day the Dues page takes a change"](plan-reminders.use-cases.test.ts)
- It goes from 10:00 to 20:00 London, once per member per quarter.
  [plan-reminders.use-cases.test.ts › "not overnight: on the day, from 10:00"](plan-reminders.use-cases.test.ts)
  [plan-reminders.use-cases.test.ts › "the next hours' runs and the next days' tell nobody again"](plan-reminders.use-cases.test.ts)

## What people see

- A member sees only their own charges; whoever sees dues or records payments sees everyone's.
  [dues.use-cases.test.ts › "a member sees only their own charges, and can't mark anything paid"](dues.use-cases.test.ts)
  [dues.edge-cases.use-cases.test.ts › "someone who only sees Unpaid fees sees what everyone owes and reads anyone's ledger; a member only their own"](dues.edge-cases.use-cases.test.ts)
- Owing is a quiet notice opening your tab, never a row in Home's feed.
  [home-feed.test.ts › "a member who owes sees a notice opening their tab, and no row in the feed"](../../src/lib/home-feed.test.ts)
- Unpaid fees sums each member's unpaid charges by age: Up to 30 days, 31 to 60 days, 61 to 90 days, Over 90 days.
  [dues.edge-cases.test.ts › "30 days is the first bucket, 31 the second; 60 and 61; 90 and 91"](../../src/lib/dues.edge-cases.test.ts)
  [dues.ledger.use-cases.test.ts › "an admin's Unpaid fees is what everyone's whole list adds up to, by age, worst first, with credit beside it"](dues.ledger.use-cases.test.ts)
- What a night collected is the sum of what was paid on it, beside what it was due.
  [dues.ledger.use-cases.test.ts › "is each night's charges added up, as the whole list did; how many were charged for anyone who edits it"](dues.ledger.use-cases.test.ts)
