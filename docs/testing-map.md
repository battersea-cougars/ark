# The team app's tests, mapped

What checks what, at which level, and where two levels or two files checked the same thing (#154). The levels are
[ADR 0124](adr/0124-test-levels.md)'s: **unit** for tricky pure logic (`src/lib`, `src/app`), **use case** for
rules and routes through the real Worker handlers (`worker/**/*.use-cases.test.ts`), and **journey** for whole
workflows by role in a browser (`apps/team/journeys/`, `npm run journeys`). Each check should live at one of them.
Taken on 23 October 2026 at `1fa5e83` (`team/review`).

## Feature by level

| Feature                    | Unit (files / tests)                                                                                                         | Use case (files / tests)                                                    | Who owns what                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tournaments, the Kumite    | most of `src/lib` (61 files / 682 tests in all): draft order, fixtures, table, awards, penalties, edition, manage, home feed | 24 / 486 (`worker/tournaments`)                                             | Unit: the maths (round robin, tie-breaks, vote counts, penalty clock, what Manage offers at each stage). Use case: who may do what, what's stored, the races (`*.concurrency`). |
| Live                       | `live.hub.test` 1 / 9                                                                                                        | 2 / 20                                                                      | Hub: coalescing. Use cases: the handlers' wiring.                                                                                                                               |
| Website results            | -                                                                                                                            | 3 / 18                                                                      | Use cases only.                                                                                                                                                                 |
| Training, entries          | recurrence, clashes, dates, ics                                                                                              | training 6 / 100, entries 5 / 102 (+ `entries.test` 3)                      | Unit: recurrence, London dates. Use case: sign-up order, waitlist, Quarterly Members, cancelling a night (`training.cancel-night` owns who hears it's off).                     |
| Dues                       | `lib/dues` 2 files                                                                                                           | 9 / 144                                                                     | Unit: buckets, ledger, fee in force. Use case: charging, allocation, reminders (server SQL).                                                                                    |
| Push                       | `webpush.test` 1 / 7 (RFC 8291, VAPID)                                                                                       | 6 / 111                                                                     | Unit: the crypto. Use case: who hears what (`push.moved-up` owns moving up, `push.outbox` the drain).                                                                           |
| Auth                       | -                                                                                                                            | 7 / 101 (+ `auth.test` 24)                                                  | Use cases. `auth.test.ts` is older, named as a unit file but driving handlers: rename later.                                                                                    |
| API shell, permissions     | `api.test`, `api.security.test` 2 / 59                                                                                       | 6 / 100                                                                     | `api.security` owns the door for a plain member and the stranger; `api.permissions` the role-by-role sweep. Feature files don't re-check "a member gets 403".                   |
| Members, settings, others  | -                                                                                                                            | members 6 / 77, settings 6 / 38, announcements, calendar, mail, tell, store | Use cases.                                                                                                                                                                      |
| App shell (`src/app`)      | 11 / 90                                                                                                                      | -                                                                           | Unit: brake, stale code, trail, nav.                                                                                                                                            |
| Shared (`packages/shared`) | rate limit, breaker, scribe, email, payment reference, turnstile, crypto                                                     | via the team use cases                                                      | Unit only where the use cases can't reach (a window moving, a token never sent).                                                                                                |

Slowest files before (summed per file, machine shared with other sessions): `entries.concurrency` 21 s,
`draft.concurrency` 18 s, `live.reads` 13 s, `api.permissions` 13 s, `push.outbox` 11 s, `tournaments` 11 s,
`dues.concurrency` 10 s, `lib/fixtures.fair-order` 7.7 s (the one slow unit file: it searches fixture orders). The
concurrency files are slow on purpose (several seeds each, ADR 0121), and they don't re-check plain rules.

## What changed

**Duplicates removed** (36 tests, 43 cases; each kept where its level says):

- **The door**: "a member gets 403" in `settings`, `usage` and `members` (the plain-member sweep in `api.security`
  checks every route); "nobody signed in gets 401" in `api.test` (the sweep again); the last admin's 409 in
  `api.test` (its message is now asserted in `api.security`'s).
- **Auth**: `auth.test`'s sign-out and made-inactive (stricter in `auth.sessions`, which now also checks the signed-out
  phone's 401); `auth.edge-cases`' "asking to join gets no code" (the first half of `auth.test`'s join story); the
  capitals-email 409 in `members.edge-cases` (same request as `members.use-cases`).
- **Turnstile**: three `packages/shared/turnstile.test` cases (confirmed, refused or down, another form's token): the
  same rules through the handler in `auth.turnstile.use-cases`. "Doesn't ask without a token" stays.
- **Tournaments**: the table's tie-breaks (goal difference, goals scored) through the Final in `scoring.edge-cases`
  (the server calls `lib/fixtures`' `table`, whose unit tests own them; "order the teams entered" stays, as it's the
  order the database passes); "the most votes wins" through the handler (`lib/awards`' `countVotes`; the tie-break
  use case stays for the wiring); two draft stories in `tournaments.use-cases` covered by `draft.edge-cases` (picks
  before open, out of turn); a scorer-not-on-the-team check in `scoring.use-cases` (all in `scoring.edge-cases`);
  playoff level at full time, told twice (kept in `scoring.use-cases`, with the error message); a 5-team round robin
  (in the `it.each` of `fixtures.edge-cases`); one row of Home's Kumite invitation, said twice.
- **Training, push, dues**: moving up off the waitlist (`push.moved-up` owns it); out members and an empty night not
  hearing it's off (`training.cancel-night`); clearing teams told twice in `training.teams`; a Quarterly Member's
  full night told twice in `entries`; the reminder held within the week and the over-90 send in
  `reminders.edge-cases` (`reminders.use-cases`).
- **Unit pairs**: `names.edge-cases`' copies of the initials and person-search tests (into `initials.test` and
  `person-search.test`, their one new case each moved along; the #140 `it.fails` stays); `dues.test`'s buckets
  (`dues.edge-cases`); `recurrence.test`'s `londonISO` (`dates.edge-cases`); `ics.test`'s venue and address
  (`ics.edge-cases`).

**Builders shared**: `src/lib/kumite.testing.ts` has the Kumite for unit tests (`kumite`, `team`, `game`, a
two-captain `snakeDraft`, the penalty clock's `penalty`/`goalAt`), in place of copies in `tournament-front`, `manage`,
`edition`, `edition.edge-cases`, `home-feed.lead`, `draft-room`, `draft-jobs`, `penalties` and `penalties.edge-cases`.

Known bugs: every `it.fails` stays (20 expected fails before and after).

## Left, for a decision

Close, but each still checks something of its own, or moving it is more than removing a copy:

- **Older files named as units that drive handlers**: `auth.test.ts`, `api.test.ts`, `api.security.test.ts` (all
  unique checks now). Rename to `*.use-cases.test.ts`? `entries.test.ts`: its "at once" isn't interleaved, and its
  "an admin puts someone in past a club event's limit" is covered nowhere else: move into a use case, then delete.
- **`webpush.test`'s "where a subscription may point"** (`pushService`, `validKeys`) overlaps
  `webpush.use-cases:82,92`; three inputs are only in the unit test. Move them into the use case, then drop the block.
  `webpush.use-cases`' teams/place/off reruns repeat `push.use-cases` with browsers.
- **`src/access/actions.test`'s `can` cases**: every branch runs through the handlers (`api.permissions`); keep the
  catalog check.
- **`packages/shared`**: `rate-limit.test`'s "allows up to the limit" (`api.load` checks it through the handler);
  `payment-reference.test`'s same-name numbering (also `members.edge-cases`). Shared with the website, which has no
  use cases of its own for them, so left.
- **Similar stories in two files**: closing and reopening a draft (`tournaments.use-cases` / `draft.edge-cases`);
  back to Sign-up open (`signup-close` / `step-back`); Teams set back to Draft open (`step-back` / `move-to`);
  `latestOf` edges in both `latest-edition` and `edition.edge-cases`; London's sign-up deadline in `signup.edge-cases`
  and `edition.edge-cases`; Home's "Sign-up opens" row three times in `home-feed.edge-cases`; `push.use-cases`' "a
  session's off" (also checks a member with the app who isn't signed up hears nothing); `announcements`' last day;
  `auth.test`'s 15 minutes and five wrong codes against `auth.edge-cases`.
- **Builders not shared**: `afters`, `home-feed`, `home-feed.edge-cases`, `matchups`, `move-to`, `step-back`,
  `awards`, `leaders` and `periods` build theirs with different defaults (a 2–1 score, ids the tests assert on, other
  types). The use cases' `cup()`/`kumite()` setups (eleven and nine of them) differ per story; `boot`, `phone`,
  `idOf` one-liners repeat in ~15 files and could become `testWorld` helpers.
- **Journeys** (`apps/team/journeys/`): the Kumite journey has landed; the use cases it re-walks end to end (sign-up
  to awards) are the next to compare; nothing was removed for it yet. It schedules by season only and plays tonight
  (The Anchor follows the kick-off, `edition.edge-cases`' unit cases); being on its day (KUMITE! from the fixtures out)
  is `tournament-front.test`'s only. Its other checks that units also hold: No captains yet for whoever runs the draft
  (`tournament-front.test` paneOf), Done that evening and history the morning after (`edition.edge-cases`). Every page
  opens clean (`pages.journey.ts`) is the only check that the pages render without browser errors.
