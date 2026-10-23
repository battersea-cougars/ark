# Code style audit, 2026-10-23

The code held to [ADR 0125](adr/0125-how-code-reads.md) (how code reads) and [ADR 0105](adr/0105-code-grouped-by-feature.md)
(where it goes), for the pre-launch review (#148). A report: only two things were fixed here, routes outside a
`.routes.ts` and unused code (below). The rest is paid down as each file is next worked on (ADR 0105); the big
pages wait for the shared components (#153).

Run it again: `npm run sizes` (files and component styles past the prompts), `npx eslint .` (the warnings), `npx knip`
(unused files and exports).

## Where it stands

| Check                                        | Count | Mostly                                                                 |
| -------------------------------------------- | ----: | ---------------------------------------------------------------------- |
| Files past ~400 lines (tests not counted)    |    35 | the team app's pages and big `src/lib` components, then worker domains |
| Component `<style>` past ~500 lines          |     6 | Draft, Shell, Training, Home, EventCard, Game                          |
| `max-lines-per-function` (80, tests excused) |    21 | worker domain functions, `nav-routes.ts`, the load scripts             |
| `max-depth` (past 3 blocks)                  |    31 | in 13 files: the team app's game logic, `api.ts`, scripts              |
| `id-length` (one-letter names)               | 4,229 | 1,723 in tests; 2,506 in code                                          |
| `no-else-return`                             |     0 | none: early exits already hold                                         |
| Routes outside a `.routes.ts`                |     0 | three moved in this change (below)                                     |
| Unused files, exports, types (knip)          |     0 | eight removed in this change (below)                                   |

## Files past the size prompt

From `npm run sizes`. Lines as they are in the file, comments included.

| Lines | File                                             | Style | What it holds that could be its own file                             |
| ----: | ------------------------------------------------ | ----: | -------------------------------------------------------------------- |
| 3,179 | `apps/team/src/pages/Draft.svelte`               | 1,736 | the board, the pick log, the order, captains' tools, its own CSS     |
| 1,793 | `apps/team/src/pages/Training.svelte`            |   662 | the night, the teams, sign-ups, the editor's openers                 |
| 1,605 | `apps/team/src/pages/Game.svelte`                |   537 | the scoreboard, the clock, the timeline, penalties                   |
| 1,507 | `apps/team/src/pages/Home.svelte`                |   591 | the feed's blocks: hero, coming up, admin, owed                      |
| 1,463 | `apps/team/src/lib/MemberSheet.svelte`           |       | profile, roles, dues, passkeys, sign-ins: one sheet per tab          |
| 1,295 | `apps/team/src/app/shell/Shell.svelte`           |   769 | the rail, the bar, the mobile nav, the update toast                  |
|   955 | `apps/team/src/lib/EventCard.svelte`             |   562 | one card per kind (training, tournament, social)                     |
|   831 | `apps/team/src/app/backend.svelte.ts`            |       | every feature's API calls: one file per feature                      |
|   827 | `apps/team/worker/tournaments/tournaments.ts`    |       | types, editions, teams, rules, playoffs (0105 already names it)      |
|   806 | `apps/team/src/lib/TournamentDateEditor.svelte`  |       |                                                                      |
|   805 | `apps/team/src/lib/TournamentHead.svelte`        |       | the Manage menu's list per stage (wanted pure, #148's workflow note) |
|   701 | `apps/team/src/lib/TrainingEditor.svelte`        |       |                                                                      |
|   666 | `apps/team/src/pages/Games.svelte`               |       |                                                                      |
|   651 | `apps/team/worker/dues/dues.ts`                  |       | charging, settling and the ledger                                    |
|   619 | `apps/team/src/app/nav-routes.ts`                |       | `buildRoutes` (185 lines): the app's route table                     |
|   603 | `apps/web/src/pages/index.astro`                 |       | the home page's sections                                             |
|   602 | `apps/team/worker/entries/entries.ts`            |       |                                                                      |
|   594 | `apps/team/src/lib/TournamentQuickCreate.svelte` |       |                                                                      |
|   592 | `apps/team/src/lib/KumiteInvite.svelte`          |       |                                                                      |
|   591 | `apps/team/worker/members/members.ts`            |       |                                                                      |
|   591 | `apps/team/worker/tournaments/draft.ts`          |       |                                                                      |
|   561 | `apps/team/worker/auth/auth.ts`                  |       | codes, sessions, cookies, mail setup                                 |

Then 13 between 400 and 550: `AwardStage.svelte`, `scripts/app-supervisor.mjs`, `AuditLog.svelte`,
`journeys/kumite.journey.ts`, `lib/home-feed.ts`, `tournaments/scoring.ts`, `DraftRoom.svelte`,
`web/components/KumitePoster.astro`, `shared/agenda.ts`, `FixtureRow.svelte`, `TeamCard.svelte`,
`PlayerCardZoom.svelte`, `lib/fixtures.ts`. Eleven test files are past 400 too (`npm run sizes -- --tests`); a test
file is a list of stories and can be long.

## Long functions and deep nesting

Functions past 80 lines (ESLint `max-lines-per-function`), longest first:

| Lines | Function                                    | Where                                                         |
| ----: | ------------------------------------------- | ------------------------------------------------------------- |
|   420 | the Kumite journey's one test               | `apps/team/journeys/kumite.journey.ts:34`                     |
|   215 | `said`                                      | `apps/team/src/pages/AuditLog.svelte:80` (one case per event) |
|   185 | `buildRoutes` (and an arrow inside it, 129) | `apps/team/src/app/nav-routes.ts:359`                         |
|   141 | `setTeams`                                  | `apps/team/worker/tournaments/tournaments.ts:519`             |
|   132 | `handleApi`                                 | `apps/team/worker/api/api.ts:109`                             |
|   129 | `fairOrder`                                 | `apps/team/src/lib/fixtures.ts:88`                            |
|   115 | `clashesOver`                               | `apps/team/worker/calendar/clashes.ts:71`                     |
|   111 | `checkUsage`                                | `apps/team/worker/settings/usage.ts:171`                      |
|   107 | `tournamentItems`                           | `packages/shared/agenda.ts:111`                               |
|   106 | `memberData`, and `eraseMember` (96)        | `apps/team/worker/members/members.erase.ts`                   |
|   105 | `shuffleAndDeal`                            | `apps/team/src/lib/shuffle.ts:36`                             |
|    98 | `clockGame`                                 | `apps/team/worker/tournaments/scoring.ts:148`                 |
|    90 | `awardsDataOf`, `editionsFrom`              | `worker/tournaments/awards.ts`, `apps/web/src/lib/results.ts` |
|    88 | `markAll`                                   | `apps/team/worker/entries/entries.ts:432`                     |

Also `testing.authenticator.ts`'s `authenticator` (103) and three load scripts (`liveDraft` 126, `phone` 122,
`startServer` 90).

**`handleApi`** is the one to do first: it's the API's entry point (ADR 0105 wants it to read like a table of
contents) and it's long, four blocks deep at its end, and exits late: the record, the website rebuild, the recharge,
the push, the live hub and the reply's parts are one function. Each is a named step it could call in turn.

Nesting past three blocks (`max-depth`), deepest first: five deep in `journeys/kumite.journey.ts`,
`scripts/lib/dev-server.mjs` and `scripts/small-screens.mjs`; four deep in `src/lib/balance.ts`, `move-to.ts`,
`penalties.ts`, `simulation.ts`, `worker/api/api.ts` and five more scripts. No `else` after a `return` anywhere.

## Names

2,506 one-letter names in code (1,723 more in tests), against the exceptions ADR 0125 allows (`i`, `j`, `k`, `n`,
`a`, `b`, `e`, `x`, `y`, `_`). The most used:

| Name | Count | Usually                                                             |
| ---- | ----: | ------------------------------------------------------------------- |
| `t`  |   415 | a tournament, a team, or a time                                     |
| `p`  |   347 | a player, a person, a promise                                       |
| `c`  |   338 | a route's context (`handle: async (c) => …`), in every `.routes.ts` |
| `r`  |   301 | a row, a route, a result                                            |
| `s`  |   206 | a session, a string, a slot                                         |
| `v`  |   156 | a value                                                             |
| `m`  |   150 | a member, a match, a regexp match                                   |
| `g`  |   140 | a game, a goal                                                      |
| `o`  |   115 | an object from a request body                                       |
| `d`  |    93 | a date, a day                                                       |

The same letter means different things a few lines apart (`t` is a team and a tournament in `tournaments.ts`), which
is what the rule is for. The files with most: `src/lib/fixtures.ts` (70), `worker/tournaments/tournaments.ts` (60),
`pages/Draft.svelte` (48), `scripts/load/load.scenarios.mjs` (44), `pages/Home.svelte` (32), `worker/api/api.slices.ts`
(31), then `MemberSheet.svelte`, `Training.svelte`, `TournamentDateEditor.svelte`, `balance.ts`, `penalties.ts`,
`dues.routes.ts`, `members.routes.ts` and `awards.ts` (27 to 30 each).

`c` for a route's context is one convention across all the routes; renaming it (`ask`, `request`, `ctx`) is one
mechanical change worth doing on its own, not file by file. Generic whole words are rare: `res` (76, nearly all a
`Response`, which is conventional), `data` (18), `result` (7), `item` (6), `tmp` (none).

## src/lib grouping

`apps/team/src/lib` is one flat folder of 222 files (160 without tests): Svelte components and plain helpers
side by side, by name alone. ADR 0105 and 0125 want it by feature, as the Worker is. The groups that are already
there by name:

- **Draft**: `DraftJobs`, `DraftOrder`, `DraftStatus`, `DraftStep`, `PickLog`, `draft`, `draft-follow`, `draft-jobs`,
  `draft-room`, `draft-sequence`, `shuffle`
- **Games and scoring**: `GameCard`, `GameHead`, `GameTimeline`, `BoxScore`, `FixtureRow`, `MatchCarousel`, `game-clock`,
  `penalties`, `periods`, `fixtures`, `matchups`, `simulation`, `SimulationControl`, `SimulateRest`
- **Awards**: `Awards`, `AwardsDrawer`, `AwardsEntry`, `AwardsField`, `AwardsWon`, `AwardStage`, `AwardCallSheet`,
  `CastYourVote`, `VoteSheet`, `ChampionCard`, `HankoPress`, `InkStamp`, `BurnReveal`, `awards`, `award-reveal.css`
- **Tournaments**: `TournamentDateEditor`, `TournamentEditor`, `TournamentEditorPanel`, `TournamentHead`,
  `TournamentPlayersDrawer`, `TournamentQuickCreate`, `KumiteInvite`, `FightCard`, `FinalResults`, `PastEditions`,
  `PlayoffsField`, `StageTrack`, `StepBack`, `MoveTo`, `edition`, `tournament-front`, `format-rules`, `leaders`,
  `Leaderboard`, `BoardTable`, `BoardWords`, `quick-create`, `move-to`, `step-back`, `manage`, `ManageList`, `signup`,
  `SignUpLine`
- **Teams**: `TeamCard`, `TeamCrest`, `TeamDrawer`, `TeamLookSheet`, `TeamRecord`, `YourTeam`, `PlayerCard`,
  `PlayerCardZoom`, `StylePicker`, `brought-team`, `team-tones`, `logo`, `names`, `fighters`, `balance`
- **Training and the calendar**: `TrainingEditor`, `TrainingEditorPanel`, `EventCard`, `ScheduleCards`, `WhosIn`,
  `ClashSheet`, `clashes`, `recurrence`, `night-off`, `new-event`, `afters`, `AfterFields`, `AfterParty`, `ics`
- **Members and money**: `MemberSheet`, `AddMemberSheet`, `ImportMembersDrawer`, `RegisterDrawer`, `RoleSwitch`,
  `Passkeys`, `ChangeEmail`, `YourData`, `NotificationPrefs`, `notification-topics`, `roster-groups`, `person-search`,
  `Person`, `PersonPicker`, `PeopleChoice`, `initials`, `dues`, `Ledger`, `BankSheet`, `MoneyField`, `RemindReview`
- **Home**: `home-feed`, `greetings`, `quips`, `LiveNote`, `live-stream`, `live-updates`
- **The kit every page shares** (#153 folds its duplicates): `Sheet`, `Drawer`, `EditorPanel`, `Wizard`, `SaveBar`,
  `Choice`, `Select`, `Pills`, `SearchField`, `DateField`, `DateBlock`, `TimeSelect`, `PlacePicker`, `DataGrid`,
  `EmptyState`, `FormSection`, `PageHeader`, `SettingsButton`, `AnswerMenu`, `PrivacyNotice`, `RollNumber`, `Kanji`,
  `dirty`, `overlay`, `portal`, `sheet`, `wizard`, `list-scroll`, `page-column`, `viewport`, `dates`, `slug`, `places`,
  `motif`, `turnstile`

A folder per group (flat inside, ADR 0105) is a move of its own, with imports changed and nothing else; it's best
done after #153 has folded the kit, so the kit's files move once. `src/app/backend.svelte.ts` (831 lines, every
feature's calls) splits the same way, one file per feature beside its components.

## Routes

Every API route is now in its component's `.routes.ts`. Three weren't, and moved here (behaviour unchanged):

- sign-in's own routes (`handleAuth`, under `/api/auth`): from `auth/auth.ts` to `auth/auth.routes.ts`;
- a member's own passkey routes (`handlePasskeys`, under `/api/auth/passkeys`): from `auth/auth.passkeys.ts` to
  `auth/auth.passkeys.routes.ts`, beside the admin's ones; removing one became `forgetPasskey` in `auth.passkeys.ts`;
- break glass's routes (`BREAK_GLASS_ROUTES`): from `auth/auth.break-glass.ts` to `auth/auth.break-glass.routes.ts`.

Not API routes, so left where they are: the live hub's own paths inside its Durable Object (`live/live.ts`), the
Worker's `/.well-known` answer (`store/store.links.ts`), and `/api/health` and `/api/errors` in `api.ts` itself (what
every request shares). The website's server routes are Astro's files under `src/pages/api/`, which is how Astro routes.

## Unused code

Removed (knip, `npx knip`; behaviour unchanged, the tests as they were):

- `reopenDraft` and `clearFixtures` in `src/app/backend.svelte.ts`: nothing in the app calls them;
- `stopWaiting` in `src/app/passkeys.ts`;
- `leaders` and `SAMPLE_TOURNAMENT_ID` in `src/demo/kumite.ts`, `previousTournament` in `src/demo/schedule.svelte.ts`;
- `hashKey` in the website's `lib/server/cache.ts`;
- `sanityRequestsMade` in `packages/shared/sanity-requests.ts`, and the count only it read;
- the `Infraction` type in `src/lib/penalties.ts`.

Kept, tagged `@public` with why: `mayOfferPasskey` and `offered` (Home imports `passkeys.ts` lazily, which knip doesn't
follow) and `downloadIcs` (Add to calendar is off for now).

For a decision, not removed:

- **Two routes the app no longer calls**: `POST /api/tournaments/:id/draft/reopen` and `DELETE /api/tournaments/:id/fixtures`
  (the app's Manage menu moves a tournament with `move` and `step-back` instead). Their use cases still drive them. Removing them changes
  the API, so it's for whoever owns the draft (ADR 0060, 0061).
- **Exports used only in their own file**: 56 values and 72 types are exported but imported nowhere else
  (`npx knip --include exports,types` with `ignoreExportsUsedInFile` set to false in `knip.json`). Not dead, but the `export`
  says "used elsewhere" when it isn't; drop it as each file is next worked on.
- **Two dependencies knip can't see used**: `@capacitor/splash-screen` and `@capacitor/ios`, which the iPhone app's
  native project uses, not the JavaScript. They stay.

## Classes and functions

Few classes, each cohesive state with what guards it: `LiveHub` (the live hub), `Brake`, `ClubCopy` (the app's copy of
the club), `Edits` (an editor's unsaved changes), and the error types. No classes as namespaces. The other side,
functions handed a bag of state that wants to be an object, wasn't measured; a reviewer looks for it in the long
functions above.
