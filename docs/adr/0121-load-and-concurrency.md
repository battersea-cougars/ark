# 0121. Requests at once are safe by statement, not by luck; every invocation keeps to 50 subrequests; load is run locally

- **Status:** Accepted
- **Date:** 2026-10-21 · updated 2026-10-21

## Context

The club is 60 to 120 members, and its busy moments are all at once: Friday sign-up opening, the teams going up while
everyone's on the page, a Kumite draft with eight captains and the room watching, a game scored live, and the crons
running through all of it. Until now the tests ran one request at a time, and the in-memory SQLite answered each
statement the moment it was sent, so a decision read in one statement and written in the next never met another
request in between.

D1 is SQLite behind a network: each statement, and each `batch()`, runs atomically, alone, in order; there are no
interactive transactions; two requests' statements interleave between their awaits. Workers Free allows 50
subrequests an invocation (a fetch, an email, a call to the live hub) and 10 ms of CPU a request (waiting on D1 is
free); D1 Free allows 5M rows read and 100k written a day ([0003](0003-free-tiers-only.md)).

## Decision

- **Every rule that two requests could race is decided inside the statement that writes it**, or the statements that
  must go together go in one `batch()`: a conditional `INSERT … SELECT … WHERE`, an `UPDATE … WHERE` with its changes
  checked, a UNIQUE constraint, a claim (`UPDATE … RETURNING`, or a claim id) before anything is sent. A read before
  it is only for the words of a refusal. As found (docs/load-testing.md has each, with its test):
  - Sign-ups: out and the first waiting moving up are one batch (an admin taking someone off too), so nobody
    signing up between takes the place; joining never rewrites an answer already in or waiting (a double tap kept
    its place); a drafted player saying they're out comes off their team in the same batch.
  - The draft: a pick says which turn it's for (`turn`, the picks the page had seen), so a tap landing after the turn
    moved on is refused, not spent on the captain's next pick; one goalie a team is inside the statements.
  - Scoring: the end of a period moves on only from the period said; a goal, penalty or Undo lands only while the
    game is on and theirs to score, never after full time.
  - Dues: an allocation of credit goes in only while its payment and charge are as they were read; a dues reminder
    is taken by the run that sends it (`dues_reminders.sending`).
- **The fake D1 interleaves like D1** (`db.interleave(seed)`, `packages/shared/testing/d1-sqlite.ts`): each round trip
  lands a few turns of the event loop after it's sent, atomic, and answers a few turns after that. Concurrency tests
  (`*.concurrency.use-cases.test.ts`) fire requests with `Promise.all` under several seeds and check the invariants.
- **A Worker invocation keeps to 50 subrequests**, counted by the fake world (fetches, emails, live hub calls): a
  request's push send is 40 phones (`SEND_AT_ONCE`); a cron run drains 25 (`DRAIN_AT_ONCE`) and sends 10 reminder
  emails (`REMINDERS.perRun`), whose phones wait for the next drain (`tell`). The worst five-minute run is about 35
  (25 phones, 10 emails, Google's and Gmail's tokens, the club's address from Sanity, a website rebuild's 2).
- **Load is run on your own machine, never on dev or production** (`npm run load`, docs/load-testing.md): the built
  Worker under `wrangler dev` with its own D1 in a temp folder, 120 members signed in as `dev-sign-in` does.

## Consequences

- A rule that's checked and then written is a bug waiting for a busy Friday; review asks where the check is.
- Pushes from a club-wide send reach the last of 200 phones in about 35 minutes (it was 20), and a reminder's phone
  hears it with the next drain, up to five minutes after the email.
- The load runs show that the Worker's CPU (1–3 ms a request) and requests (a few per cent of the day) have room,
  but **D1 rows read did not**: every live page reloaded the whole club on every change, so a draft night spent about
  87% of the free day's rows and a full Friday rush modelled at about 200% (#112). Live pages now read only the
  parts that changed, one read at a time ([0072](0072-live-updates.md)): a draft night about 33%, a game scored
  live about 3%, the Friday rush about 12%. Rows read is still the line to watch on a draft night.
- The load runs' phones use the app's own copy of the club (`apps/team/src/app/catch-up.ts`), so what they read is
  what the app reads. A rink's wifi is one address for the
  per-address limit (#113). A goal sent twice is two goals (#114).

## History

- 2026-10-21: Concurrency tests with an interleaving fake D1, the races they found fixed in their statements, the
  subrequest budget per invocation, and the local load runs (#112, #113, #114 from them).
- 2026-10-21: The fan-out fixed (#112, [0072](0072-live-updates.md)) and rerun: rows read for a draft night 4.4M →
  1.7M, a game scored live 1.2M → 0.14M, the Friday rush with no errors at 0.6M; the phones in the runs use the app's
  own `catch-up.ts`.
