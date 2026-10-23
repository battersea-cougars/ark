# Load and concurrency testing

Why and what we decided: [ADR 0121](adr/0121-load-and-concurrency.md). This page is how to run it, what D1 does
with requests at once, what the runs found, and the free-tier headroom. It runs on your own machine, or on dev once
the user's been told ([Against dev](#against-dev)): **never send load to production**.

## How D1 behaves with requests at once

- Each statement runs atomically, alone: no other statement sees it half done.
- Each `batch()` runs atomically too, its statements in order, all or nothing.
- There are no interactive transactions: a request can't hold anything between two round trips.
- Two requests' statements interleave between their awaits. A request that reads, decides in JavaScript, then writes
  can find the world changed by the time its write lands.

So a rule two requests could race (a place, a turn, a claim) is decided **inside the statement that writes it**, or
the statements that must go together go in **one batch**: `INSERT … SELECT … WHERE`, `UPDATE … WHERE` with
`meta.changes` checked, a UNIQUE constraint with `ON CONFLICT`, a claim before a send. A read first is only for the
words of a refusal.

## Concurrency tests

The fake D1 (`packages/shared/testing/d1-sqlite.ts`) answers at once by default. `w.db.interleave(seed)` makes it
behave like D1 under load: each round trip lands a few turns of the event loop after it was sent (chosen by a seeded
generator), runs atomically, and answers a few turns after that, so requests fired together with `Promise.all`
interleave at their awaits. `w.db.interleave(null)` turns it off. Each `*.concurrency.use-cases.test.ts` runs its
cases under several seeds (`seeds(5)`) and checks the invariants, not one order of events.

A seed is one order of events, run after run, however busy the machine: the tests' WebCrypto answers at once
(`packages/shared/testing/crypto.ts`), where Node's finishes on a thread pool whenever the machine gets to it, and a
draft's draw is the seed's luck too. So a seed that fails fails every time; keep it in the test as the proof
(`seeds(5, 35)`). To look further for a race:

```sh
INTERLEAVE_SEEDS=500 npx vitest run concurrency     # each case under seeds 1 to 500
```

| Area            | Test file                                                            | What's checked                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Friday sign-up  | `apps/team/worker/entries/entries.concurrency.use-cases.test.ts`     | 30 tap In for 20 places: 20 in, 10 waiting in tap order, nobody twice; keepers on their own side; Quarterly members bumping at once; a place freed while others join goes to the first waiting; a double tap; out twice |
| The draft       | `apps/team/worker/tournaments/draft.concurrency.use-cases.test.ts`   | Set the order twice; every captain tapping; two phones; the snake's double turn; captain and admin on one player, or two; Undo racing a pick; out as they're picked; one goalie a team; a whole draft of taps           |
| Scoring         | `apps/team/worker/tournaments/scoring.concurrency.use-cases.test.ts` | The same goal or penalty tap from two phones (one, #114); end of a period twice; full time twice; a goal as full time is called; goals and penalties at once                                                            |
| Taking over     | `apps/team/worker/tournaments/scoring.takeover.use-cases.test.ts`    | Two admins taking over one scoresheet at once (#116); the old scorekeeper's goal, or full time, as an admin takes over                                                                                                  |
| Push outbox     | `apps/team/worker/push/push.concurrency.use-cases.test.ts`           | Two announcements and three drains at once: every phone hears each once, no invocation past 50 subrequests                                                                                                              |
| Dues reminders  | `apps/team/worker/dues/reminders.concurrency.use-cases.test.ts`      | An admin's Send beside the five-minute cron, two runs at once: each member emailed once; a club-wide send and reminders for everyone: no request or cron run past 50 subrequests                                        |
| Charges, credit | `apps/team/worker/dues/dues.concurrency.use-cases.test.ts`           | Friday comes due while players tap and the cron runs twice: each charged once, no credit spent twice                                                                                                                    |

The fake world counts an invocation's **subrequests** (fetches, emails, live hub calls) once Firebase is on
(`fcm.invocations`), each invocation on its own however many run at once, and `w.scheduled(trigger, now)` runs a Cron
Trigger whole, as Cloudflare does.

### What they found

| Race                                                                                         | Was                                                         | Now                                                                   |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| A place freed (someone out) while others sign up                                             | A newcomer could take it ahead of the first waiting         | Out and the move up are one batch (an admin taking someone off too)   |
| A double tap (or two phones) on the last place                                               | The second tap counted their own place: they waited         | Joining never rewrites an answer already in or waiting                |
| A drafted player says they're out as a captain picks them                                    | On a team, signed up as out                                 | Off their team in the same batch as their answer                      |
| A captain's tap landing after the turn moved on (two phones; the snake gives them two turns) | Spent their next pick                                       | A pick says its turn (`turn`); a stale one is refused                 |
| An admin puts a goalie on a team as its captain picks the other                              | Two goalies                                                 | One goalie a team is inside the statements                            |
| End of a period sent by both of the scorekeeper's phones                                     | Skipped a period (the 1st's end went to the 3rd)            | Moves on only from the period said                                    |
| A goal, penalty or Undo landing as full time is called                                       | Changed the score after the result (and the playoffs)       | Lands only while the game's on and theirs                             |
| A goal landing just before full time (seed 35)                                               | The result said 0–0, the game 1–0: its score came after     | The goal and its score are one batch (Undo too)                       |
| An admin's typed-in result saved twice at once (seeds 2, 3, 5; #124)                         | The score 2–1, the goals 4–2                                | The result and its goals one batch, matched to the count in-statement |
| Two admins taking Admin off each other, or erasing themselves, at once (#135)                | No admin left                                               | Each goes only while another admin's there; the other gets a 409      |
| Two admins taking over a scoresheet at once (#116)                                           | Both told they had it; the last one held it                 | Only from who their page saw holding it; the other's told who has it  |
| The old scorekeeper's clock tap landing as an admin takes over (#116)                        | Landed after the take-over                                  | Every scorekeeper write goes only while they hold the sheet           |
| Two runs working the charges out (late taps and the hourly cron)                             | A night paid twice from the same credit, until the next run | An allocation goes in only while payment and charge are as read       |
| An admin's Send of reminders beside the five-minute cron                                     | Both emailed the same members                               | A run takes what it sends first (`dues_reminders.sending`)            |
| A five-minute cron run with a club-wide send and reminders waiting                           | 95 subrequests (Cloudflare stops at 50)                     | 35 at most: drains 25, reminders 10, `tell` queues the phones         |

Held already, now tested: a sign-up's place decided in its statement; picks guarded by the turn's count; the draw set
once; the push outbox claimed before sending (three drains at 08:00 at once, a club-wide send held overnight:
`push.outbox.use-cases.test.ts`); charges unique.

The same goal from two phones was two goals (#114): each tap now has an id, and a repeat does nothing.

## Load runs

```sh
npm run load -- baseline       # one phone at a time: what each request costs on its own
npm run load -- friday-rush    # 120 members open the app and tap In within 10 s, Home following live; both crons
                               # in the middle; the teams published while everyone's on the page
npm run load -- live-draft     # 8 captains picking in turn, 60 players watching the draft room live; an Undo and a
                               # pick for a captain
npm run load -- scoring        # 1 scorekeeper, 80 members following the game live (--followers 20)
npm run load -- all            # each, a fresh Worker each
npm run load -- soak --minutes 60   # the scenarios in turn, a minute's pause between, the crons every 5 min and hourly
npm run load -- cpu            # the Worker's own CPU a request (the fake world, SQLite's time taken off)
# --members 120  --one-address (the rink's wifi)  --no-build  --keep (the run's D1)  --server-log
# --minutes N (repeat a scenario)  --pause 60  --target local | dev (below)  --dry-run
```

Each run builds the team app, writes a config naming a small wrapper (`scripts/load/load.worker.mjs`: the built
Worker with its D1 binding counted), seeds its **own D1 in a temp folder** (schema, the club's seed, a roster of
120), and starts `wrangler dev` on a port the OS picks (never 4500/4510/4520, never main's local D1). Phones sign in
the way `scripts/dev-sign-in.mjs` does (`POST /api/auth/dev`, a local server only), each with its own address unless
`--one-address`, and do what the app does: the bootstrap with its ETag at the version the phone's copy holds, a
change with the page's Origin and its reply's parts put in place, and a live page's stream feeding the app's own copy
of the club (`apps/team/src/app/catch-up.ts`, imported as it is), which reads the parts an event names. The crons are run through `wrangler dev
--test-scheduled`. The report gives each kind of request's p50/p95/p99 and errors, workerd's CPU, and D1's rows read
and written (each result's `meta`), against the free day.

**Reading the numbers**: latencies under load are this machine's, one workerd process serving everything with D1's
SQLite in it; Cloudflare spreads requests over many isolates, so treat them as a floor on what the code costs, not a
forecast. workerd's CPU includes the local runtime and SQLite, so a 304 already shows about 11 ms; the Worker's own
CPU comes from `npm run load -- cpu`. **D1 rows read and written, and the counts of requests and reloads, are what
Cloudflare would bill**, and are the numbers to plan with.

`--one-address` also counts the run's requests as production's per-address limits would
([#113](https://github.com/battersea-cougars/ark/issues/113)): the API's ceiling of 6,000 a minute (`api.limits.ts`;
a signed-in member is counted as themselves, 600 a minute, not by address) and the domain's 150 in 10 seconds (`scripts/ratelimit-setup.mjs`), in the limiter's fixed windows, and how many would have
been 429s. A local server can't say for itself: `wrangler dev`'s Cache API holds no count.

`--target local` is the dev path on your machine: the run's own Worker and D1 as above, but with only the club's
seed, the run adding its own members and minting their sign-ins the way it does on dev, and taking them away at the
end (it checks nothing's left). Use it after changing anything in the dev path.

### Results (2026-10-21, 120 members, a fresh database)

On its own (`baseline`, `cpu`):

| Request                    | Statements | Rows read | Rows written | Worker's own CPU (median) |
| -------------------------- | ---------- | --------- | ------------ | ------------------------- |
| Bootstrap, a member        | 5          | ~705      | 0            | 1.0–1.6 ms                |
| Bootstrap, an admin        | 5          | more      | 0            | 1.5–2.8 ms                |
| Bootstrap, unchanged (304) | 3          | 8         | 0            | 0.2–0.3 ms                |
| A tap, In or Out           | 29         | ~440      | 3–5          | 1.0–1.6 ms                |

Busy moments:

| Run                      | Requests (s)  | Errors      | Key latencies (p50 / p95)                             | Reloads | D1 rows read (of 5M) | Rows written |
| ------------------------ | ------------- | ----------- | ----------------------------------------------------- | ------- | -------------------- | ------------ |
| friday-rush              | 4,587 (118 s) | 22% (local) | In 3.8 s / 22 s; open the app 9 s / 59 s              | 4,223   | 4.2M (84%)           | 1,840 (1.8%) |
| live-draft               | 4,643 (200 s) | 0           | pick 118 / 155 ms; a pick on every screen 1.5 / 2.4 s | 4,216   | 4.4M (87%)           | 1,390 (1.4%) |
| scoring                  | 1,786 (80 s)  | 1 (local)   | goal 323 ms / 7.3 s; on every screen 2.0 / 7.8 s      | 1,600   | 1.2M (23%)           | 928 (0.9%)   |
| scoring, `--one-address` | 1,866 (72 s)  | 0           | on every screen 2.5 / 4.0 s                           | 1,680   | 1.2M (24%)           | 933 (0.9%)   |

These were before #112: every phone read the whole club for every event.

### After #112 (2026-10-21): parts, not the club; one read at a time

Each live phone now reads only the parts an event names, one read at a time after a random wait of up to a second,
and the hub sends at most one event a second ([0072](adr/0072-live-updates.md)). Same machine, same 120 members, the
runs before and after on the same afternoon (the first column is the table above):

| Run         | D1 rows read, before (above) | Before, rerun today          | After                 | Reads on the phones, before → after              | Errors before → after |
| ----------- | ---------------------------- | ---------------------------- | --------------------- | ------------------------------------------------ | --------------------- |
| live-draft  | 4.4M (87%)                   | 4.38M (87.5%), 941 a request | **1.67M (33%)**, 372  | 4,216 whole → 4,135 in parts (~400 rows each)    | 0 → 0                 |
| scoring     | 1.2M (23%)                   | 1.22M (24.5%), 656 a request | **0.14M (2.9%)**, 109 | 1,680 whole → 1,131 in parts (~100 rows each)    | 0 → 0                 |
| friday-rush | 4.2M (84%), saturated        | 1.74M (35%), saturated       | **0.62M (12%)**, 755  | 1,539 of ~14,000 whole → 458 in parts (all made) | 71 → 0                |

- **friday-rush** is where coalescing counts: 120 taps in 10 seconds are about ten events, and each phone read about
  four times, not 120. Before, the local Worker gave up ("Network connection lost") and most reloads never landed,
  so its "before" rows are a floor; the full fan-out modelled at ~10.8M (216%). After, every read landed, with no
  errors. A read of the sign-ups is still about 1,000 rows once 120 have answered (each answer's place and plan are
  worked out in the read), about what the whole club was on an empty night.
- **live-draft** picks come a second or two apart, so each is still one read on each phone; what changed is the
  read: the tournaments and the agenda, not the club. 33% of the free day for a draft night of 68 phones.
- **scoring**: a game's goals are a few seconds apart; a read is the tournaments, about a hundred rows.
- **Latency**: a change reaches the other screens in about 1.2 s at the median (draft and scoring: 1.2 / 2.3 s and
  1.1 / 1.7 s p50 / p95, against 1.6 / 3.0 s and 2.6 / 3.0 s before): the random wait before a read (up to a second)
  and the hub's second cost a little, the lighter reads give it back.
- The scenarios now apply a change's reply as the app does (before, a captain reloaded the bootstrap after a pick),
  and a captain whose pick is refused waits for the next change rather than tapping again at once.

Before #112: the friday-rush errors are this machine's one workerd process giving up ("Network connection lost") under 120
phones each reloading for each of 120 taps; only about a third of the reloads the app would make got made, so its
rows read are a floor. All 120 taps in a rerun on Cloudflare would be safe by statement (the tests above), but the
fan-out is the real cost.

### After the cheaper reads (2026-10-21): no sorts, no history, no agenda for nothing

D1 bills the rows each statement reads, and a sort's rows count again. The live parts, read on every phone for every
change, were paying for things nobody sees: every tournament team, player, goal and penalty went through a sort; a
training's sign-ups worked each answer's skater, day and plan out in correlated subqueries (about eight rows an
answer); trainings and events filtered by day read every row there has ever been (the planner put the table before
the viewer); and an answer, a pick or a goal brought the agenda with it, which none of them touches. Now: indexes in
the read's order for teams, players, goals and penalties (`db/schema.sql`); the sign-ups joined once, read unsorted
and put in queue order by the Worker (`entries.ts`); the viewer first in a day's filter; and `calendar: false` on the
routes that can't move the calendar (`api.route.ts`). Same machine, the same hour, main's Worker against this one:

| Run         | D1 rows read, before | After                  | A read on a phone, before → after              |
| ----------- | -------------------- | ---------------------- | ---------------------------------------------- |
| live-draft  | 1.49M (29.7%), 334   | **1.01M (20.2%)**, 228 | the tournaments ~280 → ~150 rows               |
| scoring     | 130k (2.6%), 98      | **87k (1.7%)**, 66     | no agenda                                      |
| friday-rush | 565k (11.3%), 775    | **357k (7.1%)**, 475   | the sign-ups ~8 → ~3 rows an answer, no agenda |

(The "before" ran on this branch's schema, so its tournaments already had the new indexes' help: the real before is
a little higher, 1.64M for the draft earlier in the day.) On the local club's copy (28 members, a month of trainings), an admin's bootstrap went from 1,504 rows to 1,137, a read of the sign-ups from 577 to 244 and of the tournaments from 114 to 78.

### A live match pushed (2026-10-23, #161)

The game's own change now carries the match: the Worker reads the tournament's games once (one statement) and the hub
sends them in the event to every member ([0072](adr/0072-live-updates.md)); a phone holding the version just before
puts them in place and reads nothing. `npm run load -- scoring --followers N --one-address`, the same machine, main's
Worker against this one, each of the scorekeeper's 21 changes (12 goals, 3 penalties, an Undo, the sheet and the
clock) counted from once every phone is on the game page:

| Followers  | A change: requests (the tap + reads) | D1 rows read a change | Most requests in 10 s (domain's rule: 150) | Tap to every screen, p50 / p95 | Tap to each phone, p50 / p95 |
| ---------- | ------------------------------------ | --------------------- | ------------------------------------------ | ------------------------------ | ---------------------------- |
| 20, before | 14.3 (13.3 reads)                    | 567                   | 102                                        | 1.08 s / 1.31 s                | 0.61 s / 1.11 s              |
| 20, after  | **1.0** (no reads)                   | **140**               | **8**                                      | **0.17 s** / 1.00 s            | **0.17 s** / 1.00 s          |
| 80, before | 54.4 (53.4 reads)                    | 1,951                 | 327 (5 of 6 windows over)                  | 2.58 s / 3.14 s                | 1.60 s / 2.81 s              |
| 80, after  | **1.0** (no reads)                   | **140**               | **6**                                      | **0.13 s** / 1.00 s            | **0.13 s** / 1.00 s          |

- The cost of a change no longer grows with the phones following it: one request (the tap) and its rows (the tap's own
  and the match's one read), whether 20 or 80 are watching. The whole run at 80 read 62k rows, was 100k; what's left
  is opening the page (a bootstrap a phone, ~700 rows).
- The p95 of a second is the hub's one event a second: a penalty logged just after a goal waits for the end of it.
- The busiest 10 s of a whole 80-phone run is now everyone opening the game page at once (80 bootstraps and 80
  streams, 162 in 10 s); real phones open it over minutes. Before, the goals themselves went over 150 in five of six
  windows.
- Before, under this machine's other load, the 80-phone run varied (47 requests and 1,658 rows a change, 6.1 s to
  every screen, in a rerun with the machine busy); after, it didn't (the same numbers twice).
- The draft is still names only, one read a phone a pick (#162).

### Free-tier headroom

| Limit (Workers Free, D1 Free)       | Per request / run                                            | A Friday                                                          | A Kumite day                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| CPU, 10 ms a request                | 0.2–2.8 ms (the Worker's own)                                | fine                                                              | fine                                                                                                                             |
| Subrequests, 50 an invocation       | 42 at most (an announcement's request); 35 a cron            | fine                                                              | fine                                                                                                                             |
| Requests, 100k a day                | —                                                            | a normal week a few thousand; the rush ~12k if every reload lands | draft ~4.6k; 15 games with 40 phones ~7k                                                                                         |
| D1 rows read, 5M a day              | ~900 a full reload, 8 a 304; a live read in parts ~100–1,000 | normal ~1.2M (25%); the rush ~0.6M (12%), was ~10.8M (216%)       | draft ~1.7M (33%), was 4.4M; 15 games × 10 taps × ~140 rows ≈ 21k (0.4%) whatever the phones (#161), was 0.6M (12%) at 40 phones |
| D1 rows written, 100k a day         | 3–5 a tap                                                    | under 2%                                                          | under 2%                                                                                                                         |
| Durable Object requests, 100k a day | one a change, one a stream connect                           | hundreds                                                          | hundreds                                                                                                                         |

A normal Friday estimates sign-ups spread over the week (about five phones on Home at any tap) and five app opens a
member a day. Rows read per full reload grow with the club's history (sessions, attendance, charges): these are a
fresh database's.

## Against dev

Dev's deployment, `https://team.cougars-dev.workers.dev` and its D1 `cougars-dev`, is the real thing: Cloudflare's
isolates, D1 behind its network, the live hub as a Durable Object, the crons on their own schedule. The user agreed
to load on dev on 2026-10-21 ("it's what dev is for"). **Tell the user before each run**: what it is, about how much
of dev's day it uses (below), and that the run's people and a training night or tournament will show in dev's app
while it runs.

```sh
node scripts/env-pull.mjs -- npm run load -- friday-rush --target dev --dry-run   # read only: checks, today's use, the cost
node scripts/env-pull.mjs -- npm run load -- friday-rush --target dev --yes       # the run
node scripts/env-pull.mjs -- npm run load -- soak --minutes 60 --target dev --yes # --budget 0.5 (of the day's rows read)
node scripts/env-pull.mjs -- npm run load -- --cleanup --target dev               # anything a run left behind
node scripts/env-pull.mjs -- npm run load -- report --from <iso> --to <iso>       # Cloudflare's numbers again
```

**Only dev.** The address and the database are fixed in `scripts/load/load.dev.mjs`; the database is looked up by
name in the account the token reaches (production's has no `cougars-dev`), and the tests check that anything else
is refused. Run it through env-pull for dev, never `--environment production`.

**Its own people, no codes, no change to the app.** Dev's club is the real one anonymized (27 members, only the
user's real, the only Admin), so a run brings its own: 120 members at `@load.test` (`Load Admin`, an Admin, and
`Load Member 1`…), added as the roster seed adds people. It mints each a sign-in the way the app makes one (a random
token, stored as its SHA-256 in `auth_sessions`, `method` "load", a day long) and sends the token as the session
cookie; the tokens live only in the run's memory. The user's member and dev's anonymized members are never signed
in as, and nothing of theirs is changed.

**What it makes, and takes away.** Through the API, as Load Admin: a training night of its own (`Load night
(scripts/load)`, one session three days on, free, off the website) for `friday-rush` and `baseline`; a tournament
type and tournament for `live-draft`, a tournament for `scoring`, both off the website and deleted through the API
when the scenario ends. Everything it makes ends in `(scripts/load)`. At the end of each scenario, also on Ctrl-C or
an error, one batch takes away its tournaments, tournament types, training (sessions, sign-ups, teams, charges with
it), its members' rows in the audit log, its sign-ins and its members, and moves the data version on; the run then
checks nothing's left. A run killed hard leaves them (sign-ins expire in a day): `--cleanup` finds them by their mark.
What stays: the data version is higher, and dev's request logs and analytics have the run in them.

**What a run costs dev** (D1 Free: 5M rows read and 100k written a day, reset at 00:00 UTC; Workers Free: 100k
requests). From the local runs after #112, scaled to dev's club of 147 while a run's on:

| Run             | Rows read (of 5M) | Rows written | Requests | Takes   |
| --------------- | ----------------- | ------------ | -------- | ------- |
| `baseline`      | ~60k (1%)         | ~2k (2%)     | ~100     | 1 min   |
| `friday-rush`   | ~0.76M (15%)      | ~4k (4%)     | ~4k      | 2 min   |
| `live-draft`    | ~2.0M (41%)       | ~3.5k (3.5%) | ~4.5k    | 3–4 min |
| `scoring`       | ~0.17M (3%)       | ~3k (3%)     | ~1.3k    | 1–2 min |
| `all`           | ~3.0M (61%)       | ~12k (12%)   | ~10k     | 10 min  |
| `soak`, an hour | until `--budget`  |              |          | 60 min  |

Adding and removing the run's people is about 2k of the rows written, each scenario (each starts afresh). The dry run says what dev has used today
and refuses a run that would pass 90% of the day's rows (`--anyway` overrides); a soak starts nothing new once the
day passes `--budget` (Cloudflare's figures lag a few minutes, so leave room). Past 80%, or after a request
stopped at the CPU limit, dev's hourly usage check emails its admins (ADR 0059): the user, and Load Admin's undeliverable `admin@load.test` if the run's still on.
Everything else on dev counts against the same day: on 2026-10-21 dev had read 1.7M rows (35%) by 18:00 UTC
before any run, so `all` that evening would have been refused.

**What it measures.** The phones' own latency (p50/p95/p99) and status codes as before; then, two minutes after the
run (the analytics lag), Cloudflare's numbers for its window: the team Worker's requests by outcome (success,
`exceededResources` for a request stopped at the CPU limit, `clientDisconnected`), its CPU time p50/p90/p99, D1's
reads, writes and rows read and written for `cougars-dev`, the live hub's requests, and CPU by route from Workers
Logs (`scripts/cpu-by-route.mjs`, a sample of up to 2,000 invocations). They're the whole account's for the window,
so anyone else on dev is in them.

**The per-address limit (#113).** Every request comes from this machine, one address, as on the rink's wifi. But on
`*.workers.dev` the Cache API that `api.limits.ts` counts in does nothing (ADR 0055) and the domain's rate-limiting
rule is production's zone only, so **dev enforces neither limit**: no 429s, whatever the rate. Measuring them for
real needs a custom domain, which is production's. So a dev run doesn't pace its phones and dev's config gets no
higher limit (there's nothing to raise): its report counts the run as production's limits would, from the moment
each request was sent, as `--one-address` does locally, and prints any 429 actually received (there should be none;
one would mean dev gained a limit). The numbers are then dev's real costs at the club's real rate, and the count
says what the rink's wifi would have refused.

### What to do next

1. **The live fan-out's rows read (#112)**: done, above, and the parts made cheaper. What's left: a draft night is
   a fifth of the day, each pick one read on each phone of every tournament there has been (about 150 rows with one
   tournament; it grows with every season). Reading just the tournament the page shows (a part per tournament, the
   hub naming which) would hold it near today's cost however long the club's history. The bootstrap's `members` part
   counts every member's games played from all their attendance (two rows each), read on every whole read: a
   stored count (or an index covering it) would keep opening the app from growing with history.
2. **Watch the Usage page on the first draft night and the first busy Friday** ([0059](adr/0059-usage-page-and-check.md)):
   rows read is the line to watch, not requests.
3. **The rink's wifi** is one address for the per-address limit (#113): count signed-in GETs per member.
4. A tap costs 29 round trips (the charges are worked out again for the whole club after each): fine for CPU today,
   and the place to look if a tap's CPU grows with the club.
