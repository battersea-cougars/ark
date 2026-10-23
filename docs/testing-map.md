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

## Journeys

Every workflow someone does in the team app, by role, and which journey covers it, or why none does (23 October
2026). One journey covers each workflow once; a rule's every case stays in its use case or unit test, and a journey
taps it once (ADR 0124). The people: **Ada** an admin, **players** in the Kumite (Fay, the captains), members not in
it (Nell, Ivy, Hal, Pia, Wes, Tam, Quin, Kit the keeper), **Mo** made a Session lead, **Jo** new and asking to join.

| Who                | Workflow                                                                                          | Journey › stage                                      | Or why not                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| New                | Asks to join, waits; no code before she's let in                                                  | sign-in › 1                                          |                                                                                           |
| Admin              | Lets someone in (The club, Approve); a member can't                                               | sign-in › 1                                          | Home doesn't tell the admin someone's asking (only The club): a decision                  |
| Member             | Signs in with a code; a wrong code refused                                                        | sign-in › 2                                          | Five wrong codes, 15 minutes, the limits: `auth.edge-cases`, `auth.test`                  |
| Member             | Adds a passkey, signs out, signs in with it                                                       | sign-in › 3                                          | Chrome's virtual authenticator; other devices' passkeys: `auth.passkeys.use-cases`        |
| Member             | Signs out; a page needing sign-in goes to Sign in                                                 | sign-in › 3                                          | Sign out everywhere: `auth.sessions`                                                      |
| Admin              | Adds a member; changes a name, email, position                                                    | members › 1                                          | Import members (CSV): `members.use-cases` only                                            |
| Admin              | Gives a role (Session lead), the member gets its jobs, takes it away                              | members › 2                                          | Editing a role's actions, the everyday role (Opens as): use cases                         |
| Admin              | Can't take the last admin's Admin role                                                            | members › 2                                          |                                                                                           |
| Member             | Can't open Settings → Members; Roles shows a role's actions                                       | members › 2                                          | The door for every route: `api.security`                                                  |
| Member             | Deletes their own account; can't sign in after; gone from lists                                   | members › 3                                          | An admin deleting someone: `members.erase`                                                |
| Everyone           | Home: the next night's hero, Coming up, the locker room, owed or not                              | calendar › 1, 4, 6; fridays › 7                      |                                                                                           |
| Everyone           | Today, Tonight, Tomorrow, In N days, In N weeks on the right London days                          | calendar › 6; fridays › 2–4, 10–12; kumite clock › 4 | Only check of EventCard's `soon` (inline in the component: worth a unit test)             |
| Admin              | Sets up a training (Settings → Training), pauses it                                               | fridays › 1, 13                                      |                                                                                           |
| Member             | A night's In/Out, from the page and Home; the waiting list and moving up; the keepers' own places | fridays › 3                                          | Every order and race: `entries`, `entries.concurrency`; who's told: `push.moved-up`       |
| Member             | Sign-up opening N days before at London midnight; refused before                                  | fridays › 2, 4, 11, 12                               | `lib/signup` units                                                                        |
| Session lead/Admin | The register on the night: a no-show, Add player, Let in                                          | fridays › 5                                          | Every register rule: `training` use cases                                                 |
| Member             | Their own In/Out refused once the night's over                                                    | fridays › 5, 11                                      | Locked once it **starts** (asked) vs **ends** (ADR 0030): a failing check, to decide      |
| Admin              | The register locked the next morning                                                              | fridays › 6                                          | #11, not built: a failing check                                                           |
| Admin              | Fees: charged on the night (the register) and by the next day's cron (sign-ups nobody ticked)     | fridays › 5, 6                                       | `dues` use cases own every charge rule                                                    |
| Admin              | Unpaid fees, a payment, an adjustment, reminders sent by hand                                     | fridays › 7                                          | Who's reminded and when: `reminders` use cases                                            |
| Member             | Their tab, Home's owed row; dues ageing past a month                                              | fridays › 7, 9                                       | Buckets: `lib/dues`                                                                       |
| Member             | Quarterly: chosen for next quarter, charged on its first day, nights then free                    | fridays › 10                                         | `dues` use cases                                                                          |
| Admin              | Cancels a training night; who was in sees it off                                                  | fridays › 8                                          | Who hears it: `training.cancel-night`                                                     |
| Admin              | A one-off club event; members In/Out; cancelled                                                   | calendar › 1, 3                                      | A one-off's limit and waiting list: its sheet has no places field (use cases only)        |
| Admin              | The clash prompt (a one-off over training): Close, Keep both                                      | calendar › 2                                         | Every clash: `calendar/clashes.use-cases`                                                 |
| Admin/Member       | The locker room: posted, Got it, gone after its last day; a member can't post                     | calendar › 4                                         | `announcements` use cases own the last day                                                |
| Member             | Notification switches kept                                                                        | calendar › 5                                         | No push leaves a local server: who hears what is `push.use-cases`                         |
| Admin              | Settings, one job each: Venues, Quips, Tournament series, Audit log                               | calendar › 7                                         | Email, Usage, Errors need real tokens: opened only (pages)                                |
| Everyone           | Every page and editor opens clean                                                                 | pages                                                |                                                                                           |
| Admin/Player       | The Kumite night, sign-up to the morning after                                                    | kumite › 1–10                                        |                                                                                           |
| Everyone           | The Kumite's sign-up opening and closing at London midnight; refused by the server                | kumite clock › 1, 2                                  | `signup.edge-cases`, `edition.edge-cases`                                                 |
| Admin              | The draft's day on the agenda, only for whoever runs it                                           | kumite clock › 3                                     | `home-feed` units, agenda use cases                                                       |
| Everyone           | Its day (Today, Tonight), the day after unplayed, played on another evening                       | kumite clock › 4–6                                   | `edition.edge-cases` (playedOn, atAfters), `tournament-front`                             |
| Everyone           | The final over midnight; The Anchor till 06:00, history at 06:01                                  | kumite clock › 6, 8, 9                               | `dates` londonEvening units; the Kumite night's morning after (kumite › 10) stays its end |
| Everyone           | A season-only Kumite; a past Kumite (history, never coming up)                                    | kumite clock › 7, 10                                 | `latestOf` units                                                                          |
| Everyone           | The clocks going back (25 Oct 2026) and forward (28 Mar 2027): times, the evening, In/Out         | fridays › 4, 11; kumite clock › 8, 9                 | `londonISO` units                                                                         |
| Everyone           | 29 February 2028                                                                                  | fridays › 12                                         |                                                                                           |
| Captain            | The draft room, choosing                                                                          | kumite › 4                                           |                                                                                           |
| Scorekeeper        | Keeps score live; full time                                                                       | kumite › 6                                           | Every scoring rule: `scoring` use cases                                                   |
| Admin              | Import members, Sign out everywhere, View as, Upload, Email reconnect, Usage                      | none                                                 | Use cases; Email and Usage need real tokens; Upload is still demo data (#63)              |
| Admin              | Recording a Kumite from before the app (ADR 0126), a tournament other than the Kumite             | none                                                 | `past.use-cases`; only the Kumite is set up                                               |

**What the journeys make redundant** (listed, nothing deleted: each lower test still checks every case of its rule,
and a journey taps one):

- `kumite.journey.ts` stage 10's morning after is checked at its boundary (05:59 / 06:01) by `kumite.on-the-clock`;
  it stays as that story's end.
- `home-feed.edge-cases`' three "Sign-up opens" rows and `edition.edge-cases`' second London deadline (in "Left"
  above) are now walked end to end too: the first to remove when that list is taken up.
- No use case or unit test is a pure copy of a journey step: none removed.

**Known gaps**: a stranger's sign-in pages are listened to like everyone's (`stranger`); the app's error screen counts
as a browser error. A one-off's places, real push, and a register opened for a past night aren't driveable.
