# Load and concurrency testing

Why and what we decided: [ADR 0003](adr/0003-free-tiers-only.md). This page is how to run it and what D1 does
with requests at once. It runs on your own machine, or on dev once
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

Each race these found, and how it's decided now, is in [ADR 0003](adr/0003-free-tiers-only.md); its seed or
case stays in the test as the proof.

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
requests). `live-draft` is the dearest scenario and `all` runs every one. Adding and removing the run's people is
about 2k of the rows written, each scenario (each starts afresh). The dry run says what dev has used today and what
the run would cost, and refuses a run that would pass 90% of the day's rows (`--anyway` overrides); a soak starts nothing new once the
day passes `--budget` (Cloudflare's figures lag a few minutes, so leave room). Past 80%, or after a request
stopped at the CPU limit, dev's hourly usage check emails its admins (ADR 0003): the user, and Load Admin's undeliverable `admin@load.test` if the run's still on.
Everything else on dev counts against the same day.

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
