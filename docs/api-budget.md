# The API's D1 budget, route by route

The rule is [ADR 0003](adr/0003-free-tiers-only.md)'s "API functions stay cheap": a request makes at most **25 D1
calls** (round trips: a `batch()` is one, as Workers counts its 50 queries an invocation), whatever the club's size.
Two routes have their own, each still inside the free plan's 50: the Kumite simulator (45, dev only,
[ADR 0123](adr/0123-dev-only-tools.md)) and Move to (40: up to eight of the app's own jobs in one tap).

`apps/team/worker/api/api.budget.use-cases.test.ts` checks it. It drives every route on its happy path, through the
real handlers in the fake world, on a club of 60 (a season of Fridays with their charges, a Kumite played to its end,
another drafted and scored, sign-ups, dues, the calendar, the settings) and again on a club of 120, and fails if:

- a route isn't driven (a new route has to be added there);
- a request makes more D1 calls than its budget;
- a route costs more at 120 members than at 60: something is read or written a member at a time (N+1).

A count includes the wrapper's own calls (who's asking, the role's actions, the record before and after, the version,
the parts sent back) and what goes after the reply (`waitUntil` work: the outbox, the live hub), since it's the same
invocation. A plain change costs about 8 of them before its handler does anything; a read about 3.

```sh
BUDGET=1 npx vitest run apps/team/worker/api/api.budget      # the table below
BUDGET=sql npx vitest run apps/team/worker/api/api.budget    # each dear route's statements, in order
BUDGET=plan npx vitest run apps/team/worker/api/api.budget   # every statement whose query plan reads a whole table
```

## Every route, dearest first

Taken on 23 October 2026 on `team/api-budget`, a club of 60. Statements counts each statement of a batch: what D1
reads and bills, however it travels.

| Route                                                  | D1 calls | Statements |
| ------------------------------------------------------ | -------: | ---------: |
| `POST /api/tournaments/:id/simulate`                   |       39 |         67 |
| `POST /api/tournaments/:id/move`                       |       37 |         79 |
| `POST /api/tournaments/:id/draft/finish`               |       24 |         30 |
| `PUT /api/tournaments/:id`                             |       23 |         51 |
| `PUT /api/series/:id`                                  |       22 |         46 |
| `POST /api/series`                                     |       22 |         42 |
| `POST /api/dues/reminders`                             |       22 |         28 |
| `POST /api/tournaments/:id/draft/open`                 |       21 |         26 |
| `POST /api/tournaments`                                |       19 |         50 |
| `POST /api/sessions/:id/cancelled`                     |       18 |         37 |
| `POST /api/tournaments/:id/players`                    |       18 |         36 |
| `POST /api/sessions/:id/players`                       |       17 |         35 |
| `POST /api/sessions/:id/register`                      |       17 |         40 |
| `GET /api/bootstrap`                                   |       16 |         43 |
| `POST /api/tournaments/:id/awards/reveal`              |       16 |         25 |
| `POST /api/tournaments/:id/draft/reset`                |       16 |         19 |
| `POST /api/tournaments/:id/teams/:id/players`          |       16 |         16 |
| `DELETE /api/tournaments/:id`                          |       16 |         34 |
| `PUT /api/members/:id/attendance`                      |       15 |         38 |
| `PUT /api/members/:id/contact`                         |       15 |         15 |
| `PUT /api/roles/:id`                                   |       15 |         17 |
| `DELETE /api/charges/:id`                              |       15 |         41 |
| `POST /api/tournaments/:id/answer`                     |       15 |         33 |
| `POST /api/tournaments/:id/draft/close`                |       15 |         18 |
| `POST /api/tournaments/:id/fixtures`                   |       15 |         18 |
| `POST /api/tournaments/:id/step-back`                  |       15 |         32 |
| `POST /api/me/email/confirm`                           |       14 |         14 |
| `PUT /api/members/:id/everyday-role`                   |       14 |         14 |
| `DELETE /api/members/:id`                              |       14 |         31 |
| `POST /api/sessions/:id/let-in`                        |       14 |         34 |
| `POST /api/sessions/:id/teams`                         |       14 |         20 |
| `POST /api/series/:id/sessions`                        |       14 |         18 |
| `POST /api/members/:id/charges`                        |       14 |         40 |
| `POST /api/charges/:id/payment`                        |       14 |         30 |
| `POST /api/members/:id/payments`                       |       14 |         30 |
| `POST /api/tournaments/:id/draft/picks`                |       14 |         14 |
| `POST /api/tournaments/:id/draft/reopen`               |       14 |         20 |
| `PUT /api/members/:id`                                 |       13 |         16 |
| `POST /api/sessions/:id/answer`                        |       13 |         31 |
| `POST /api/sessions/:id/reset`                         |       13 |         29 |
| `POST /api/series/:id/more`                            |       13 |         17 |
| `POST /api/members/:id/quarterly`                      |       13 |         28 |
| `DELETE /api/charges/:id/payment`                      |       13 |         31 |
| `POST /api/members/:id/recalculate`                    |       13 |         43 |
| `DELETE /api/me`                                       |       13 |         30 |
| `PUT /api/tournaments/:id/winners`                     |       13 |         25 |
| `POST /api/tournaments/:id/signup/close`               |       13 |         16 |
| `POST /api/tournaments/:id/draft/draw`                 |       13 |         16 |
| `POST /api/tournaments/:id/games/:id/clock`            |       13 |         19 |
| `DELETE /api/tournaments/:id/games/:id/goals/:id`      |       13 |         20 |
| `PUT /api/tournaments/:id/games/:id`                   |       13 |         23 |
| `PUT /api/me/plan`                                     |       12 |         12 |
| `POST /api/break-glass/sessions/:id/end`               |       12 |         12 |
| `DELETE /api/payments/:id`                             |       12 |         30 |
| `POST /api/club-events/:id/players`                    |       12 |         15 |
| `PUT /api/club-events/:id`                             |       12 |         19 |
| `POST /api/tournaments/:id/awards/next`                |       12 |         19 |
| `DELETE /api/tournaments/:id/fixtures`                 |       12 |         14 |
| `DELETE /api/tournaments/:id/teams/:id/players/:id`    |       12 |         12 |
| `POST /api/tournaments/:id/games/:id/goals`            |       12 |         16 |
| `POST /api/members`                                    |       11 |         11 |
| `POST /api/roles`                                      |       11 |         11 |
| `DELETE /api/members/:id/passkeys`                     |       11 |         11 |
| `POST /api/break-glass/codes/:id/end`                  |       11 |         11 |
| `POST /api/subscription-fees`                          |       11 |         26 |
| `POST /api/members/:id/adjustments`                    |       11 |         27 |
| `POST /api/club-events/:id/cancelled`                  |       11 |         14 |
| `PUT /api/venues/:id`                                  |       11 |         20 |
| `POST /api/mail/test`                                  |       11 |         11 |
| `DELETE /api/tournaments/:id/draft/picks/last`         |       11 |         11 |
| `PUT /api/tournaments/:id/teams/:id/look`              |       11 |         11 |
| `POST /api/tournaments/:id/games/:id/penalties`        |       11 |         14 |
| `POST /api/tournaments/:id/games/:id/scorer/admin`     |       11 |         14 |
| `DELETE /api/tournaments/:id/games/:id/penalties/:id`  |       11 |         14 |
| `POST /api/me/email`                                   |       10 |         10 |
| `POST /api/members/:id/sign-out`                       |       10 |         10 |
| `POST /api/club-events`                                |       10 |         13 |
| `DELETE /api/tournaments/:id/games/:id/goals/last`     |       10 |         14 |
| `DELETE /api/tournaments/:id/games/:id/penalties/last` |       10 |         13 |
| `PUT /api/tournament-types/:id`                        |       10 |         13 |
| `POST /api/announcements`                              |        9 |         11 |
| `POST /api/auth/verify`                                |        9 |          9 |
| `DELETE /api/sessions/:id/teams`                       |        9 |          9 |
| `PUT /api/quips/:id`                                   |        9 |          9 |
| `DELETE /api/quips/:id`                                |        9 |          9 |
| `POST /api/tournaments/:id/votes`                      |        9 |         16 |
| `POST /api/tournaments/:id/games/:id/scorer`           |        9 |         12 |
| `POST /api/tournament-types`                           |        9 |          9 |
| `DELETE /api/announcements/:id`                        |        8 |          8 |
| `PUT /api/me/everyday-role`                            |        8 |          8 |
| `POST /api/members/import`                             |        8 |          8 |
| `PUT /api/settings/bank`                               |        8 |          8 |
| `POST /api/club-events/:id/answer`                     |        8 |         11 |
| `POST /api/venues`                                     |        8 |          8 |
| `POST /api/dev/mail`                                   |        8 |          8 |
| `DELETE /api/dev/mail`                                 |        8 |          8 |
| `POST /api/auth/request`                               |        7 |          7 |
| `GET /api/calendar/clashes`                            |        7 |          7 |
| `PUT /api/settings`                                    |        7 |          7 |
| `POST /api/quips`                                      |        7 |          7 |
| `POST /api/announcements/:id/dismiss`                  |        6 |          6 |
| `PUT /api/me`                                          |        6 |          6 |
| `POST /api/auth/start`                                 |        6 |          6 |
| `POST /api/auth/passkeys/sign-in`                      |        6 |          6 |
| `GET /api/slices`                                      |        5 |          5 |
| `PUT /api/me/notifications`                            |        5 |          5 |
| `POST /api/auth/passkeys/register`                     |        5 |          5 |
| `GET /api/mail`                                        |        5 |          5 |
| `POST /api/mail/reconnect`                             |        5 |          5 |
| `GET /api/members/:id/attendance`                      |        4 |          4 |
| `POST /api/auth/passkeys/register-options`             |        4 |          4 |
| `GET /api/members/:id/passkeys`                        |        4 |          4 |
| `POST /api/auth/sign-out`                              |        4 |          4 |
| `POST /api/auth/sign-out-everywhere`                   |        4 |          4 |
| `GET /api/dues/reminders`                              |        4 |          5 |
| `GET /api/announcements`                               |        3 |          3 |
| `GET /api/me/data`                                     |        3 |         15 |
| `GET /api/me/notifications`                            |        3 |          3 |
| `GET /api/break-glass`                                 |        3 |          3 |
| `GET /api/usage`                                       |        3 |          4 |
| `GET /api/usage/levels`                                |        3 |          3 |
| `GET /api/audit`                                       |        3 |          3 |
| `GET /api/dev/mail`                                    |        3 |          3 |
| `GET /api/mail/callback`                               |        3 |          3 |
| `GET /api/live`                                        |        2 |          2 |
| `GET /api/auth/passkeys`                               |        2 |          2 |
| `PUT /api/auth/device`                                 |        2 |          2 |
| `DELETE /api/auth/device`                              |        2 |          2 |
| `POST /api/auth/passkeys/sign-in-options`              |        1 |          1 |

## What was fixed (23 October 2026)

- **An agenda sync** (`packages/shared/agenda.ts`) was four round trips (is the agenda filled, the venues, the rows,
  the write); it's two (the three reads in one batch, then the write). `syncAll` was seven; it's two.
- **The day's first open** synced each training's new sessions one training at a time (N+1 on trainings), and a new
  training was synced twice. All at once now, and once (`training.ts ensureSessions`, `createSeries`).
- **Where a tournament stands** (step back, Move to: the check and the record before and after) was four or five round
  trips each time; one now.
- **Move to** put the tournament on the agenda after closing sign-up, after opening the draft and after setting the
  teams, then again at the end; only at the end now. Sign-up to the after-party: 41 calls, now 37.
- **The club read's dues parts** (charges, payments, credit) picked a member's own out of every charge, payment and
  allocation the club ever had, on every bootstrap and on every live update a sign-up makes. Found by index now,
  theirs only (`api.club.ts DUES_SHOWN`); whoever sees everyone's dues still reads them all.
- **Indexes** (`db/schema.sql`) for reads that scanned on an admin's Home or a sign-out: the week's break-glass codes
  and sign-ins (partial indexes), the last email reconnect in the audit log (`audit_log_action`), and a session's
  passkey challenges (the `ON DELETE CASCADE` scanned them).

## Left, for a decision

- **Recharging after a change reads every attendance and tournament entry ever** (`dues.ts attendanceCharges`): a
  constant number of calls, but its rows grow with the club's history, and every sign-up answer runs it. A future
  night's answer can't change a charge (only nights held up to today are charged), so the narrowest fix is to recharge
  only the nights a change touched, or not at all for a night still to come.
- **The members part counts each member's training nights** (`played`) from every attendance row on every bootstrap.
  A count kept on the member, or read for the members slice only, would bound it.
- **Each email sent writes the mail's health** (`mail-health.ts recordMail`): one call an email, so a reminders run of
  10 makes 10 (22 in all). Bounded by `REMINDERS.perRun`; one write after the run would do.
- **Opening the draft** reads the tournament, whether it's played, its teams, whether it's drawn, the picks and the pool
  one at a time (21 calls); one batch would make it about 16. The same for a draft's close and finish.
- **Scans the plan check still shows** (`BUDGET=plan`) are small tables (roles, venues, trainings, quips, the
  tournament types), the viewer row, or cold paths: the audit page, a member's data export and erasure (the audit log
  by its detail), the clash check's `held_on BETWEEN … OR moved_from BETWEEN …`.
