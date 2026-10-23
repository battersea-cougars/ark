# 0121. Requests at once are safe by statement, not by luck; every invocation keeps to 50 subrequests; load runs locally or on dev, never production

- **Status:** Accepted
- **Date:** 2026-10-21 · updated 2026-10-22

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
    its place); a drafted player saying they're out comes off their team in the same batch. A member's own answer to a
    tournament goes only while it hasn't started, inside each of that batch's statements (`STARTED`,
    `worker/tournaments/started.ts`), so an Out landing as it goes live is refused whole or done whole. A limit raised fills its
    room in the batch that saves it (#127).
  - The draft: a pick says which turn it's for (`turn`, the slot the page saw on the clock), so a tap landing after
    the turn moved on is refused, not spent on the captain's next pick; the pick goes in only while that slot is
    still the first free pick number; one goalie a team is inside the statements. Close draft & make fixtures claims
    the close (`UPDATE … WHERE draft_state = 'open'`, its changes checked) before making them, so two taps make one set.
  - Scoring: the end of a period moves on only from the period said; a goal, penalty or Undo lands only while the
    game is on and theirs to score, never after full time; a goal (or its Undo) and the score it makes are one batch,
    so full time never reads a goal without its score; each goal and penalty tap has an id made on the phone
    (`tap_id`, UNIQUE in its game, `ON CONFLICT DO NOTHING`), and an Undo names the one it takes back, so the same tap
    from two phones, or sent again, counts once (#114); an admin's typed-in result and its goals are one batch, each
    side's goals matched against the count inside its statement, so the same result saved twice adds them once (#124).
    An admin's take-over (or freeing) of the scoresheet goes only while it's still held by whoever their page saw
    and the game isn't over, so two admins at once leave one scorekeeper; every scorekeeper's write, the clock's
    included, goes only while they still hold the sheet, so the old phone's tap is refused after a take-over (#116).
  - Members: the last who can do everything (`manage:all` through any role, ADR [0024](0024-action-based-authorization.md))
    is kept inside the statements that change a member's roles, make them inactive, erase them or take `manage:all`
    off a role: each goes only while someone else active can still do everything, so two admins demoting or erasing
    each other at once, or a role and its holder changed at once, leave one, the other refused (#135, #136).
  - Dues: an allocation of credit goes in only while its payment and charge are as they were read; a charge marked
    paid is one payment only while what's left on it is as read, its allocation in the same batch (#119); a dues
    reminder is taken by the run that sends it (`dues_reminders.sending`).
- **The fake D1 interleaves like D1** (`db.interleave(seed)`, `packages/shared/testing/d1-sqlite.ts`): each round trip
  lands a few turns of the event loop after it's sent, atomic, and answers a few turns after that (mostly none to two,
  now and then many: D1's latency has a tail). Concurrency tests (`*.concurrency.use-cases.test.ts`) fire requests
  with `Promise.all` under several seeds (`seeds(n)`; `INTERLEAVE_SEEDS=500` looks further) and check the invariants.
  **A seed is one order of events**, however busy the machine: the tests' WebCrypto answers at once
  (`packages/shared/testing/crypto.ts`: SHA-256 and RS256, the same bytes), since the real one finishes on a thread
  pool after as many turns as the machine's load allows; a draw is the seed's luck too (`w.luck`). A seed that found a
  race stays in its test as the proof (`seeds(5, 35)`).
- **A test's time limit is 30 s** (`vitest.config.ts`): it catches a hang, not a slow machine; the club-sized tests
  take 1–2.5 s on a quiet one and went past Vitest's 5 s with other suites running.
- **A Worker invocation keeps to 50 subrequests**, counted by the fake world (fetches, emails, live hub calls): a
  request's push send is 40 phones (`SEND_AT_ONCE`); a five-minute cron run drains 25 (`DRAIN_AT_ONCE`) and sends 10
  reminder emails (`REMINDERS.perRun`), whose phones wait for the next drain (`tell`); the run every minute between
  does nothing but drain 40, with Google's token 41 ([0108](0108-store-apps.md)). The worst five-minute run is about 35
  (25 phones, 10 emails, Google's and Gmail's tokens, the club's address from Sanity, a website rebuild's 2).
- **Load runs on your own machine, or on dev once the user's been told, never on production** (`npm run load`,
  docs/load-testing.md): locally, the built Worker under `wrangler dev` with its own D1 in a temp folder, 120 members
  signed in as `dev-sign-in` does. On dev (`--target dev`, only dev's address and `cougars-dev`, refused otherwise),
  the run brings its own 120 members (`@load.test`) and mints their sign-ins as the app stores them, with no code
  and no change to the app; everything it makes carries a mark and is taken away at the end, Ctrl-C included
  (`--cleanup` for a run killed hard). Its numbers are Cloudflare's: CPU per request, D1 rows, the live hub. Dev
  can't enforce the per-address limits (no Cache API on `*.workers.dev`, the domain's rule is production's), so a
  dev run isn't paced: it counts what production's limits would have refused (#113).
- **D1 counts a sort's rows again** (a `USE TEMP B-TREE FOR ORDER BY` reads each row twice, as billed): a part read
  on every live update is read in an index's order (`db/schema.sql`), or unsorted and put in order by the Worker
  (sign-ups, `entries.ts`). A filter by day puts the viewer first (`viewer v CROSS JOIN …`), so the day picks the
  rows by index rather than every row there has ever been.

## Consequences

- A rule that's checked and then written is a bug waiting for a busy Friday; review asks where the check is.
- Pushes from a club-wide send reach the last of 200 phones in about five minutes (the minute drain; it was 35), and a
  reminder's phone hears it with the next drain, within a minute of the email.
- The load runs show that the Worker's CPU (1–3 ms a request) and requests (a few per cent of the day) have room,
  but **D1 rows read did not**: every live page reloaded the whole club on every change, so a draft night spent about
  87% of the free day's rows and a full Friday rush modelled at about 200% (#112). Live pages now read only the
  parts that changed, one read at a time ([0072](0072-live-updates.md)): a draft night about 33%, a game scored
  live about 3%, the Friday rush about 12%; and those parts are read without sorts, scans of the club's history or
  the agenda when nothing on it moved: a draft night about 20%, a game about 2%, the rush about 7%. Rows read is
  still the line to watch on a draft night.
- The load runs' phones use the app's own copy of the club (`apps/team/src/app/catch-up.ts`), so what they read is
  what the app reads. A rink's wifi is one address for the
  per-address limit (#113).

## History

- 2026-10-21: Concurrency tests with an interleaving fake D1, the races they found fixed in their statements, the
  subrequest budget per invocation, and the local load runs (#112, #113, #114 from them).
- 2026-10-21: The fan-out fixed (#112, [0072](0072-live-updates.md)) and rerun: rows read for a draft night 4.4M →
  1.7M, a game scored live 1.2M → 0.14M, the Friday rush with no errors at 0.6M; the phones in the runs use the app's
  own `catch-up.ts`.
- 2026-10-21: The club read's live parts made cheaper (no sorts, no scans of history; sign-ups joined once and put
  in order by the Worker; answers, picks and scoring don't bring the agenda): rows read for a draft night 1.49M ->
  1.01M (30% -> 20% of the free day), a game scored live 130k -> 87k, the Friday rush 565k -> 357k (docs/load-testing.md).
- 2026-10-21: `npm test` failed about one run in two with other suites running beside it, and passed on rerun. Most
  were time limits (the club-sized tests past 5 s: the limit is 30 s now). One was a real race, in production too: a
  goal went in while the game was on, full time landed and wrote the result (0–0), and only then the goal's score
  (1–0), so the record and the game disagreed (and a group game's playoffs were filled from the score without the
  goal). A goal, its Undo and an admin's removal now go in one batch with the score. It showed only on a busy machine
  because WebCrypto's timing moved requests apart; the tests' WebCrypto answers at once now, so a seed is one order of
  events, and the fake D1's latency has a tail, so seeds find such races themselves (seed 35, and 6 of 200). Three
  tests timed by the wall clock (balancing teams, the live hub's first event, the show switch's streaming) say it by
  CPU time or the order of events instead.
- 2026-10-21: Load on dev too (`--target dev`, the user agreed: "it's what dev is for"), never production: the run's
  own members with minted sign-ins, cleaned up after; Cloudflare's own CPU and D1 numbers for the run's window; a
  soak (`--minutes`) with a budget of the day's rows read; the per-address limits counted, not enforced, since dev
  can't. `--target local` runs the same path on your machine.
- 2026-10-22: Two more checked-then-written rules decided in their statements: a typed-in result's goals (two saves
  at once doubled them, #124) and the last admin (two admins demoting or erasing each other at once left none, #135),
  with their seeds' tests.
- 2026-10-22: The draft's one-tap close and fixtures claims the close first; a pick's turn is its slot, the first
  free pick number (#125).
- 2026-10-22: A training and its fees are one batch (a refused save had changed the fees, or made the training,
  #131), and a limit raised moves the first waiting up in that batch (#127).
- 2026-10-22: Marking a charge paid from two phones at once (or a double tap) recorded two payments for it; the
  payment now goes in only while the charge still has what was read left, with its allocation in one batch (#119).
- 2026-10-22: The last-admin condition counts `manage:all` through any role, and guards role edits too (#136).
- 2026-10-22: A push drain every minute between the five-minute runs, 40 phones and nothing else (41 subrequests), for
  quiet hours and the debounce ([0108](0108-store-apps.md)): 200 phones in about five minutes, not 35.
- 2026-10-22: Taking over a scoresheet decided in its statement (two admins at once: one scorekeeper), and the clock's
  writes, like goals', only while the tapper holds the sheet (#116), with their seeds' tests.
- 2026-10-23: A member's own In or Out for a tournament that's started is decided in its statements (ADR 0074), with a
  test of an Out landing as it goes live.
- 2026-10-23: The same goal or penalty from two phones (or a retry) was two; each tap now has an id from the phone and
  a repeat does nothing, and an Undo names the goal or penalty the page shows last, so a double tap takes one off
  (#114).
