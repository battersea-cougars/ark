# 0074. A tournament's home follows the day in three acts, and the next one is scheduled from it in a few questions

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-22
- **Merges:** 0086, 0087, 0088, 0089, 0091

## Context

The Kumite's home stacked cards whatever the day: a date card with sign-up, the draft, the games, the teams, and once
it was won a champions card above a "Date TBC" card. The settings (status, date confirmed) said one thing and the
results another. Past Kumites were a list at the bottom.

Scheduling the next one was the last item in the Manage menu and opened the full editor on four tabs, with the day
next to series, name, type and season, and the draft's day and captains on the fourth. Sign-up was a status an admin
had to remember to set. Every new one started at 11:00–16:00, though the Kumite is usually instead of Friday
training, at its time. And a tournament made by mistake couldn't be removed.

The story: an admin opens the Kumite page and sees the last one. They schedule the next: its day, when sign-up opens,
the draft's day, its captains. The page then shows the new one, its day obvious, the draft's day obvious or TBC.

## Decision

### The page follows the tournament, not its settings

- **Its state comes from its games** (`lib/edition.ts`): under way once a game's being scored or has a result, done
  once every game's played (or an admin marked it finished). Before then, sign-up open or coming up. The day shows
  once it's confirmed or the games have been played; the season always.
- **The header carries the when** on every tournament page (`TournamentHead.svelte`), the date leading: the day,
  its hours and how far off on one line ("SAT 14 NOV · 7 to 9:30pm · in 24 days"; Tomorrow; Today in red), the
  season and place under it. Just a season: the season, "Day to be set" and the place.
- **A series opens on its next one** (`currentOf`): the one under way, else the next one not done (a tentative date
  or just a season is enough). The series' other pages show the same one; there's no switcher. Once the last game's
  played it's history: nothing's on.
- **With nothing on, the series is one page.** No Fight card, The board, Teams, Draft or History (they're for one
  that's running), so no strip of pages. The front page says so big, in the series' motif: for the Kumite, 組手 down
  the side like a film poster with a 拳 hanko stamped on it, the gong, "No Kumite yet. The gong's quiet. Train hard."
  An admin's **Next Kumite** is on it. Under it, every past one, newest first.
- **The track of its stages is the navigation** (`TournamentHead` with `lib/StageTrack`, `trackLinksOf` and
  `pageStepOf` in `lib/tournament-front.ts`), not a strip of tabs: every running page of the series (the front page,
  Draft, Teams, Fight card, The board; `onTrack` in `app/mobile-nav.ts`) is one template, the header then the track
  with its Next line, so nothing moves from page to page, and on a phone there's no bar above the header. Each step
  opens its page once it has one: **Sign-up** the front page, until the fight card's out; **Draft** the draft, for its
  captains and whoever runs it (a plain step for everyone else); **Teams** the teams, once there are some; **Fight
  card** the fight card, once it's made; then **KUMITE!** (the series' own name) the front page, which is the day's
  (on now, next). So the front page is always one step, never two. **The board** isn't a step: it's a link at the foot
  of the front page and beside the fight card; nor is **History**, a link at the foot of the front page. Two marks
  that never mix: the stage it's at, in the club's red, italic with a slash; the page you're on, its name bright and
  underlined, as a lit tab is (red and underlined when it's both). On a phone the fight card's step says Card. A team's,
  a game's and History's pages keep their Back. The route tree still keeps the pages that matter at its stage as the
  series' own (`nav-routes.ts`): the rest are under the front page, so Back and the rail go there.
- **Past ones are History**, a row at the foot of the front page while the next one's on or coming up (the front
  page itself when nothing's on): each
  with how it ended (the day, the champions, the final's score), each opening its own page
  (`/tournaments/:slug/history/:id`: the champions, the final, every fight, the board, the awards), back to the list.
  Its teams' and games' pages work from there too; a past game's matchup goes back to its own page, not today's fight
  card.
- The app's **Home asks about each series' next one** while it takes sign-ups, a card with In and Out under
  Friday's; before then it's teased as a line in Home's feed ([0118](0118-home-calls-to-action-then-feed.md)).

### The acts (`Games.svelte`)

- **A track of its stages leads the page** (`stepsOf`, `nextOf` in `lib/tournament-front.ts`, `lib/StageTrack`):
  Sign-up, Draft (a draft's only), Teams, Fight card, then the day (KUMITE!), a filled bar and a name each, the one
  it's at in the club's red, italic with a slash, those done quiet, those ahead faint. The fixtures out, it's at the
  fight card until the day (or a match starts), then at the day. Under it, one line: what's next and when (sign-up
  opening or closing, the draft's day, the teams once the draft closes, the first match on the day at its start), or
  on the day how many are played. Both lines keep their height whatever the stage, so nothing under them moves.
- **Before: the page follows the stage**, each leading with one thing, the stage's main action (`frontOf`); what's
  had its day goes from the page (History keeps it). The teams are never listed here: they're the Teams tab, and a
  quiet line of links at the foot (Fight card, The board, Teams, History, as each has something on it).

  | Stage            | Stamp                                                   | Leads with                                                          | Then                                                                         |
  | ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
  | sign-up          | SIGN-UP OPEN (COMING UP before it opens)                | you're in, or In / Out, and the count                               | (the draft's day is the track's Next)                                        |
  | the draft open   | DRAFT LIVE                                              | the draft: who's picking, Go to the draft (its captains, run:Draft) | your sign-up, one small line, no buttons                                     |
  | the teams set    | TEAMS SET                                               | "You're on Team X": its crest, captain, teammates                   | "Draft done", one line, with Go to the draft; an admin's Make the fight card |
  | the fixtures out | FIXTURES OUT; on the day KUMITE! (the series' own name) | First up: the first match (Up next), and yours if it's a later one  | Full fight card                                                              |

  The fight card rows (`lib/FightCard.svelte`) are one compact row a game, the same at every stage of the game: the
  time (Up next under the next one to be played, the chant on one being played, Final once done), the two teams one
  over the other, a crest and a name each (yours in red) with the score once there is one, and the game's number (a
  playoff's name). A tap opens the game. The whole card is its own page, the Fight card tab.
  Teams that enter have no draft, so no draft step; while they're still taking sign-ups, the sign-up line sits under
  your team. The draft's done is said once ("Draft done"), not a Closed stamp and a shout. The stamp in the header
  is the stage (`stageBadge`), on every page of the series; under way on another day it's ON NOW, and DONE once every
  game's played. Nothing else: no lede, no "not final" hint. The draft card leads with the draft's day or "Draft
  date TBC", shows the captains as discs, or says "Captains to be named."

- **Your next fight on Home** too: it's Home's lead card when it's your soonest thing (ADR 0118), the game as
  `FightCard` shows it, with its day and pitch.
- **During:** your turn to keep score, then the match on now (or, between matches, Up next) and the next one, a card
  each (`onTheDayOf`); your next, when it's neither, one line under them. Nothing else competes: results are on the
  board, a link at the foot.
- **Crests tell teams apart** (`teamInitials` in `lib/logo.ts`): without a logo, the initials skip a generic first
  word ("Team Charlie" is CH, "Team Cal" CA, "The Dim Maks" DM), and within a tournament no two share them: the
  first keeps its own, a later one takes its next letters, never another team's own.
- **After:** the champions (crest, name, how they won it), the final, every fight, the awards: on its own page in
  History, with the front page back to nothing on.
- **Fewer cards:** the champions, sign-up, keep-score duty and teams sit on the page, set apart by space, type and a
  rule, not each in its own dark panel.

### The Kumite's motif

It's Bloodsport (`lib/motif.ts`): kanji beside its section headings (組手, 決勝, 試合, 闘, 賞), a red 優勝 hanko
seal on the champions' crest, and a gong for its fight card. The kanji come from Noto Serif JP Black (SIL Open Font
License) cut to just those characters (under 5 KB, self-hosted). Other series have no motif.

### An admin's jobs

- **Manage** on the series page (a bottom sheet on a phone, a side drawer on a desktop, ADR
  [0065](0065-page-frame-and-admin-actions.md)) holds what has no page of its own: the tournament's settings (day,
  sign-up, captains and draft day, rules, awards) and Confirm the awards. The draft is run on its own tab and the
  fight card made on its own, so neither is in the menu.
- **An admin can always step it back one step** (Manage: one item, "Back to …", while there's a step before it).
  The steps are the front page's track and the draft's own (`src/lib/step-back.ts`, the same for the app and the
  Worker); teams that enter skip the draft's:

  | It's at                      | Back to                     | What goes                                                           | Asked                   |
  | ---------------------------- | --------------------------- | ------------------------------------------------------------------- | ----------------------- |
  | a match started or played    | the fight card, not started | results, goals, penalties, clocks, scoresheets; the playoffs' teams | red, counted            |
  | the fight card out           | the teams                   | the fixtures (made again the same)                                  | quietly                 |
  | a draft closed               | the draft, open             | nothing                                                             | no                      |
  | the draft open               | the drawn order             | the picks so far ("Draft paused" to its captains)                   | red, counted (none: no) |
  | the order drawn              | before the draw             | the order                                                           | quietly                 |
  | sign-up past its closing day | sign-up open                | the closing day                                                     | no                      |

  `POST /api/tournaments/:id/step-back { from }` says which step it's leaving; it's refused (409) if the tournament
  has moved on since, so a tap from a page that's out of date never takes a second step. Each is one batch whose
  statements only do anything while it's still at that step, so two taps at once step back once
  ([0121](0121-load-and-concurrency.md)). An admin (`manage:Tournament`) steps back any step; whoever runs the draft
  (`run:Draft`) the draft's three, from the Draft page's Manage. It's on the record as `tournament.stepped_back`, with
  the step and the picks, order, matches, results and goals before and after. Only an open draft stepped back is
  news: each captain hears "<tournament> Draft Paused"; nothing else is sent. The awards an admin confirmed stay.

- **When nothing's coming up** (the last one's been played, or there's never been one), an admin sees **Next
  Kumite** as the main button on the page, in the big "No Kumite yet". This is the one admin button on the page
  outside Manage.

### Scheduling the next one in a few questions

- A new date in a series opens on its questions as a wizard, a step at a time (`TournamentQuickCreate.svelte`, ADR
  [0117](0117-wizards-for-multi-step-creates.md)):
  1. **When:** the season, a day or none for TBC, and Starts and Ends filled in from the series.
  2. **Sign-up:** when sign-up opens (today by default) and, a draft series only, the draft's day (optional).
  3. **Captains** (a draft series only, optional): the whole club in a list as Add player has it, a search narrowing
     it and an Add on each row (Added once picked; Enter adds the first match). The captains so far sit above the
     search as chips with a ×, on one line that scrolls sideways so the list never moves. They're a set, not an
     order: the pick order is drawn when the draft starts. Too few for the playoffs is said at the foot.
  4. **Check:** each answer in words, with Change back to its step.
- Only the season is needed, so every step is open from the start; hours the wrong way round, or sign-up or the
  draft after the day, hold it on that step and the foot says why.
- **Schedule it** creates it and closes the panel on the page, which now shows the new one.
- **The rest comes from the series:** its name, fee, place, rules, awards and playoffs; status planned. The server
  fills in what a new one leaves out (hours, status, the series' fee, rules), so the quick form sends only what it
  asked.
- **Advanced** (at the wizard's foot, and on Check) opens the full editor with the answers filled in. **Back to the questions** returns to them, keeping
  what was changed there. A one-off tournament (no series) and Settings → Tournaments use the full editor.
- **A series has usual hours** (`tournament_types.default_start_time`, `default_end_time`, defaulting to
  11:00–16:00), set in its settings (Settings → Tournament Series → When, where and fee) beside its place and fee.
  Each new tournament starts with them and can change them. The seed has the Kumite at Friday training's hours
  (19:30–21:30).
- **The draft has a day, not a time** (`draft_on`). It's a reminder for the captains, on their calendar as a day; an
  admin messages them when it opens (ADR [0060](0060-the-draft.md)).

### Afterwards, and where it is

- **The header's place opens the map**: on every page of the series, the place under the day is a pin and its name,
  a link to its map (`placeOf`, ADR [0030](0030-training-and-tournament-schedule.md)), on the header's fixed second line.
- **A series has an afterwards** (`tournament_types.after_venue_id`, `after_time`, `after_note`): a saved venue, an
  optional time and what for. The Kumite's is The Anchor, for the celebration and awards (the seed), so every Kumite
  has it without anyone retyping it. Set in the series' Defaults (Afterwards), beside its place and hours.
- **A tournament follows it, or not** (`tournaments.after_mode`): `usual` (its series', the default), `own` (its own
  `after_venue_id`, `after_time`, `after_note`) or `none` (not this time). Its editor's Details has Afterwards: Usual,
  a venue, or None this time. A save that leaves it out keeps what it had. Only a saved venue counts, and the API
  refuses one that doesn't exist. One rule, `afterOf` in `packages/shared/places.ts`, for the app and the agenda.
- **The front page says it when it matters** (`afterMomentOf` in `lib/tournament-front.ts`): before the day, one quiet
  line under the track's Next ("Afterwards · The Anchor · from 9:45pm · celebration and awards", the place a map link);
  on the day nothing while the matches are what matters, until the last one's on, when it's Then (in the next match's
  place); once it's played, that evening, it's Now, big, with a Map button, above the nothing-on page.
- **The day's calendar entry says it** in its description ("Afterwards: The Anchor, from 9:45pm. Celebration and
  awards."), so the website's What's on does too.

### Sign-up opens on a day

- `tournaments.signup_opens_on`: from that day (London) members can say they're in, until the end of the closing day
  (`signup_closes_on`, ADR [0030](0030-training-and-tournament-schedule.md)). An admin can still open it by hand
  (status `open`).
- **One rule** shared by the app and the Worker (`lib/signup.ts`, `signupOpen`): open by hand, or planned and past its
  opening day; never after its closing day. The Worker refuses an early "in" with the day it opens.
- The full editor has it on Sign-up, beside the closing day. It can't be after the tournament's day, and sign-up
  can't close before it opens.

### Deleting a tournament

- **Delete is in the tournament's editor** (Settings → Tournaments, or from its page): a quiet red Delete at the start
  of the footer. Tapping it asks there, in so many words ("Delete it? Its teams, sign-ups and results go too."), with
  Keep it and a red Delete, the one red fill.
- **The database deletes it, not the Worker** (`DELETE /api/tournaments/:id`, `manage:Tournament`): one
  `DELETE FROM tournaments`, and the schema's `ON DELETE CASCADE`s take its sign-ups, teams and their players, games
  and goals, and the awards' winners. D1 enforces foreign keys, as does the SQLite the tests use. Work the database
  can do stays out of a Worker's CPU time (ADR [0059](0059-usage-page-and-check.md)).
- **Its agenda rows go by syncing it away.** The agenda points at a tournament by `source` and `source_id`, with no
  foreign key, so the Worker removes them (ADR [0042](0042-website-reads-the-club-agenda.md)).

## Consequences

- A tournament's status matters less: an admin needn't mark it live or finished, or open sign-up, for the page to
  move on.
- A past one has an address of its own, so it can be shared.
- Scheduling the next one is one button and up to four steps.
- Tournaments made before sign-up had a day have no opening day, so they wait for an admin as before. A series made
  before it had hours keeps 11:00–16:00 until an admin sets them.
- There's no undo for a delete. A played tournament's results go with it, so the question says so.
- A new table that belongs to a tournament needs `ON DELETE CASCADE` to its tournament (or its team or game), or a
  delete leaves it behind; the use-case test checks no team's players are left over.

## History

- 2026-10-08: The home page follows the day in three acts, its state from its games; the header carries the when;
  past ones move to History; the series opens on its next one with Last time; Manage gathers an admin's jobs; the
  Kumite gets its motif (was 0074).
- 2026-10-08: The before act says less: no lede, no "not final" hint, captains as discs, and Last time goes once the
  next one is set (was 0086).
- 2026-10-09: The next one is scheduled in three questions from a Next Kumite button when nothing's coming up; Manage
  keeps only what has no page; the draft has a day, not a time (`draft_time` dropped). It also amended ADR 0065 to
  allow that button outside Manage (was 0087).
- 2026-10-09: An admin deletes a tournament, the cascade doing the work (was 0088).
- 2026-10-09: Sign-up opens on a day, asked as a new second question (was 0089).
- 2026-10-09: A series has usual hours, shown in the first question; the Kumite at Friday training's (was 0091).
- 2026-10-20: With nothing on, the series is one page: no Fight card, board, Teams, Draft or History; a big "No Kumite
  yet" in the motif with an admin's Next Kumite, and every past one under it. The last one played no longer holds the
  front page (`currentOf`); its after act is its own page in History.
- 2026-10-21: The questions are a wizard (lib/Wizard, ADR 0117): When, Sign-up (with the draft's day), Captains with
  the whole step to find them in, then Check. Captains can be moved up the pick order.
- 2026-10-21: Captains are picked from the whole club's list with an Add on each row, shown as chips; no pick order
  is set here, since it's drawn when the draft starts.
- 2026-10-21: Home asks "Are you in for the Kumite?" right after Friday while sign-up is open, and teases it in its
  feed before ([0118](0118-home-calls-to-action-then-feed.md)).
- 2026-10-21: A running one's tabs follow its stage (sign-up, the draft, the teams, the fixtures) and say less
  (Kumite, Fights, Board), so they fit an iPhone: My team is no longer a tab (Teams has yours first), nor History
  while one's running (a row at the foot of the front page); hidden pages keep their links, under the front page.
- 2026-10-21: The front page follows the stage, each leading with one thing: sign-up (are you in), the draft (the
  draft card, your sign-up a line), the teams set (your team, then the others, "Draft done" in a line), the fixtures
  out (your next fight, then the first up and the teams); what's had its day goes. The header's stamp is the stage
  (Sign-up open, Draft live, Teams set, Fight night, KUMITE! on the day). Your next fight is on Home too.
- 2026-10-21: The fixtures out, the front page leads with the date (the day, its hours and how far off, under the
  title) and one fight card: every game a compact row in order of play (time, the two teams, the game's number), yours
  in red, the next marked Up next, the score once there is one; more than six, yours and the next, then Full fight
  card. It replaces "Your next fight" and "First up" there (Home keeps its own). The stamp says FIXTURES OUT until
  the day, then KUMITE!; no more Fight night. Crests skip a generic first word ("Team Charlie" CH) and never share
  initials within a tournament. The teams lose See all, every team being on the page.
- 2026-10-22: Each stage is obvious: a track of the stages (Sign-up, Draft, Teams, Fight card, KUMITE!) leads the
  front page with what's next under it. The teams are no longer listed on the front page (their tab, and a quiet
  link at the foot); before the day it shows the first match (and yours), on the day only the match on now and the
  next (no latest results, no separate Your next fight). The tab is "Fight card", not "Fights", and History's page
  says "Fight card", not "Every fight".
- 2026-10-22: Back a step, from any step, in Manage: one item, asking as much as it costs; one route that says the
  step it's leaving and is one batch.
- 2026-10-22: The header's place is a map link. A series has an afterwards (a saved venue, an optional time, what
  for), the Kumite's The Anchor for the celebration and awards; a tournament keeps its series', has its own, or none
  this time. The front page says it before the day as a quiet line, as Then once the last match is on, and as Now
  that evening; the day's calendar entry says it too.
- 2026-10-22: The track of its stages replaces the tabs as the series' navigation, under the header on every running
  page (the front page, Draft, Teams, Fight card, The board): each step opens its page (Sign-up the front page till the
  fight card's out, then KUMITE! does), the page you're on marked apart from the stage it's at; no strip, and no bar
  above the header on a phone. The board and History are links from the front page (the board from the fight card too).
