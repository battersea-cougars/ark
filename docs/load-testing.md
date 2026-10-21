# Load and concurrency testing

Why and what we decided: [ADR 0121](adr/0121-load-and-concurrency.md). This page is how to run it, what D1 does
with requests at once, what the runs found, and the free-tier headroom. Everything here runs on your own machine:
**never send load to the dev or production Cloudflare accounts**.

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
cases under several seeds and checks the invariants, not one order of events.

| Area            | Test file                                                            | What's checked                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Friday sign-up  | `apps/team/worker/entries/entries.concurrency.use-cases.test.ts`     | 30 tap In for 20 places: 20 in, 10 waiting in tap order, nobody twice; keepers on their own side; Quarterly members bumping at once; a place freed while others join goes to the first waiting; a double tap; out twice |
| The draft       | `apps/team/worker/tournaments/draft.concurrency.use-cases.test.ts`   | Set the order twice; every captain tapping; two phones; the snake's double turn; captain and admin on one player, or two; Undo racing a pick; out as they're picked; one goalie a team; a whole draft of taps           |
| Scoring         | `apps/team/worker/tournaments/scoring.concurrency.use-cases.test.ts` | The same goal from two phones (two goals, #114); end of a period twice; full time twice; a goal as full time is called; goals and penalties at once                                                                     |
| Push outbox     | `apps/team/worker/push/push.concurrency.use-cases.test.ts`           | Two announcements and three drains at once: every phone hears each once, no invocation past 50 subrequests                                                                                                              |
| Dues reminders  | `apps/team/worker/dues/reminders.concurrency.use-cases.test.ts`      | An admin's Send beside the cron, two runs at once: each member emailed once; a club-wide send and reminders for everyone: no request or cron run past 50 subrequests                                                    |
| Charges, credit | `apps/team/worker/dues/dues.concurrency.use-cases.test.ts`           | Friday comes due while players tap and the cron runs twice: each charged once, no credit spent twice                                                                                                                    |

The fake world counts an invocation's **subrequests** (fetches, emails, live hub calls) once Firebase is on
(`fcm.invocations`), each invocation on its own however many run at once, and `w.scheduled(trigger, now)` runs a Cron
Trigger whole, as Cloudflare does.

### What they found

| Race                                                                                         | Was                                                         | Now                                                                 |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| A place freed (someone out) while others sign up                                             | A newcomer could take it ahead of the first waiting         | Out and the move up are one batch (an admin taking someone off too) |
| A double tap (or two phones) on the last place                                               | The second tap counted their own place: they waited         | Joining never rewrites an answer already in or waiting              |
| A drafted player says they're out as a captain picks them                                    | On a team, signed up as out                                 | Off their team in the same batch as their answer                    |
| A captain's tap landing after the turn moved on (two phones; the snake gives them two turns) | Spent their next pick                                       | A pick says its turn (`turn`); a stale one is refused               |
| An admin puts a goalie on a team as its captain picks the other                              | Two goalies                                                 | One goalie a team is inside the statements                          |
| End of a period sent by both of the scorekeeper's phones                                     | Skipped a period (the 1st's end went to the 3rd)            | Moves on only from the period said                                  |
| A goal, penalty or Undo landing as full time is called                                       | Changed the score after the result (and the playoffs)       | Lands only while the game's on and theirs                           |
| Two runs working the charges out (late taps and the hourly cron)                             | A night paid twice from the same credit, until the next run | An allocation goes in only while payment and charge are as read     |
| An admin's Send of reminders beside the five-minute cron                                     | Both emailed the same members                               | A run takes what it sends first (`dues_reminders.sending`)          |
| A five-minute cron run with a club-wide send and reminders waiting                           | 95 subrequests (Cloudflare stops at 50)                     | 35 at most: drains 25, reminders 10, `tell` queues the phones       |

Held already, now tested: a sign-up's place decided in its statement; picks guarded by the turn's count; the draw set
once; the push outbox claimed before sending; charges unique.

Still open: the same goal from two phones is two goals (#114, Undo takes one back; nothing retries on its own).

## Load runs

```sh
npm run load -- baseline       # one phone at a time: what each request costs on its own
npm run load -- friday-rush    # 120 members open the app and tap In within 10 s, Home following live; both crons
                               # in the middle; the teams published while everyone's on the page
npm run load -- live-draft     # 8 captains picking in turn, 60 players watching the draft room live; an Undo and a
                               # pick for a captain
npm run load -- scoring        # 1 scorekeeper, 80 members following the game live
npm run load -- all            # each, a fresh Worker each
npm run load -- cpu            # the Worker's own CPU a request (the fake world, SQLite's time taken off)
# --members 120  --one-address (the rink's wifi)  --no-build  --keep (the run's D1)  --server-log
```

Each run builds the team app, writes a config naming a small wrapper (`scripts/load/load.worker.mjs`: the built
Worker with its D1 binding counted), seeds its **own D1 in a temp folder** (schema, the club's seed, a roster of
120), and starts `wrangler dev` on a port the OS picks (never 4500/4510/4520, never main's local D1). Phones sign in
the way `scripts/dev-sign-in.mjs` does (`POST /api/auth/dev`, a local server only), each with its own address unless
`--one-address`, and do what the app does: the bootstrap with its ETag, a change with the page's Origin, a live
page's stream reloading on each event naming a part it follows. The crons are run through `wrangler dev
--test-scheduled`. The report gives each kind of request's p50/p95/p99 and errors, workerd's CPU, and D1's rows read
and written (each result's `meta`), against the free day.

**Reading the numbers**: latencies under load are this machine's, one workerd process serving everything with D1's
SQLite in it; Cloudflare spreads requests over many isolates, so treat them as a floor on what the code costs, not a
forecast. workerd's CPU includes the local runtime and SQLite, so a 304 already shows about 11 ms; the Worker's own
CPU comes from `npm run load -- cpu`. **D1 rows read and written, and the counts of requests and reloads, are what
Cloudflare would bill**, and are the numbers to plan with.

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

The friday-rush errors are this machine's one workerd process giving up ("Network connection lost") under 120
phones each reloading for each of 120 taps; only about a third of the reloads the app would make got made, so its
rows read are a floor. All 120 taps in a rerun on Cloudflare would be safe by statement (the tests above), but the
fan-out is the real cost.

### Free-tier headroom

| Limit (Workers Free, D1 Free)       | Per request / run                                 | A Friday                                                          | A Kumite day                                                        |
| ----------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| CPU, 10 ms a request                | 0.2–2.8 ms (the Worker's own)                     | fine                                                              | fine                                                                |
| Subrequests, 50 an invocation       | 42 at most (an announcement's request); 35 a cron | fine                                                              | fine                                                                |
| Requests, 100k a day                | —                                                 | a normal week a few thousand; the rush ~12k if every reload lands | draft ~4.6k; 15 games with 40 phones ~7k                            |
| D1 rows read, 5M a day              | ~900 a full reload, 8 a 304                       | normal ~1.2M (25%); **the rush ~120 × 100 × 900 ≈ 10.8M (216%)**  | **draft ~4.4M (87%); 15 games × 10 taps × 40 phones ≈ 5.4M (108%)** |
| D1 rows written, 100k a day         | 3–5 a tap                                         | under 2%                                                          | under 2%                                                            |
| Durable Object requests, 100k a day | one a change, one a stream connect                | hundreds                                                          | hundreds                                                            |

A normal Friday estimates sign-ups spread over the week (about five phones on Home at any tap) and five app opens a
member a day. Rows read per full reload grow with the club's history (sessions, attendance, charges): these are a
fresh database's.

### What to do next

1. **Cut the live fan-out's rows read (#112)**: the one limit a busy day passes. Every live page reloads the whole
   club for every change, so the cost is changes × phones × the club's size. One reload in flight with a short random
   wait (a burst is one reload), events coalesced in the hub (one per part a second), and a read of just the parts
   an event names each cut it many times over. Rerun `live-draft` and `friday-rush` to see it in the D1 line.
2. **Watch the Usage page on the first draft night and the first busy Friday** ([0059](adr/0059-usage-page-and-check.md)):
   rows read is the line to watch, not requests.
3. **The rink's wifi** is one address for the per-address limit (#113): count signed-in GETs per member.
4. **Give scoring taps an id** when a retry or a second device makes duplicates likely (#114).
5. A tap costs 29 round trips (the charges are worked out again for the whole club after each): fine for CPU today,
   and the place to look if a tap's CPU grows with the club.
