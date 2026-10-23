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
- **The header carries the when and the where** on every tournament page (`TournamentHead.svelte`), two fixed lines.
  The first: within a week, how far off leads, big, in the club's red ("TOMORROW · Fri 23 Oct · 7 to 9:30pm"; Today,
  Tomorrow, This Friday, In 7 days; `countdownOf` in `lib/edition.ts`; a phone drops the hours to keep it one line);
  further off, the date leads with "in 24 days" quiet after it. The second: the place on the map (pin) and, beside it,
  where everyone goes after (a pint glass: "📍Battersea Sports Centre · 🍺The Anchor"); just a season, "Day to be set".
  Its actions, the same on every status: **Rules** (one sheet, a topic a page: Sign-up, The draft, Format, Points,
  Penalties, House rules; `formatAndRules` in `lib/format-rules.ts`, from what's stored and enforced, nothing invented;
  a series' house rules are plain text an admin writes, `tournament_types.house_rules`) and **Manage** (the gear).
- **A series opens on its next one** (`currentOf`): the one under way, else the next one not done (a tentative date
  or just a season is enough). The series' other pages show the same one; there's no switcher. Once the last game's
  played it's history: nothing's on.
- **With nothing on, the series is one page.** No Fight card, The board, Teams, Draft or History (they're for one
  that's running), so no strip of pages. The front page says so big, in the series' motif: for the Kumite, 組手 down
  the side like a film poster with a 拳 hanko stamped on it, the gong, "No Kumite yet. The gong's quiet. Train hard."
  An admin's **Next Kumite** is on it. Under it, every past one, newest first.
- **One page, by status** (`Games.svelte`): "Fight Card is confusing if we think of the kumite in stages. It should
  really be a status: Draft Open, Draft Completed, Fixtures Created, Kumite!" (the user, 2026-10-22). The tournament
  is one page, `/tournaments/:slug`: the header, the track of its statuses, then that status's view. Its draft, teams,
  fixtures and board are no longer pages of their own.
- **The statuses** (`statusOf`, `statusesOf` in `lib/tournament-front.ts`): **Sign-up open** → **Draft open** →
  **Teams set** → **Fixtures set** → **KUMITE!** (the series' own name, on the day or once a match has started) →
  **THE ANCHOR** (the after-party, named after its afterwards; **AFTERS** when it has none); teams that enter skip the
  draft. "Teams set" for both, draft or not: "Teams finalised" didn't fit a phone's track. A draft leaves Sign-up open
  when sign-up closes (its closing day gone by, or an admin's **Close sign-up**); Draft open is where the order's
  drawn and the draft opened.
- **The after-party** ("The evening a Kumite ends: the last step should be the after party", the user, 2026-10-22)
  starts when the last match is played (or an admin marks it finished) and lasts till 06:00 London the next morning
  (`atAfters` in `lib/edition.ts`, `londonEvening` in `lib/dates.ts`: before 06:00 it's still the night before's
  evening). All that time the series' page is still on it, even with the next one scheduled (`currentOf`); then it
  moves on to the next one or "No Kumite yet", and it's in History. Results typed in on another day, or a tournament
  with only a season, go straight to history. Home's hero is its card ("At The Anchor · awards", the awards so far),
  ahead of everything else, as it's on now (`lib/home-feed.ts`, lead kind `afters`).
- **The track** (`lib/StageTrack`) is a journey: one line through the statuses, filled to where it is and faint after,
  a node each (done: filled with a tick; where it is: a bigger bright node with a red NOW stamp over it, pulsing in
  red the whole time the Kumite's running on its day; ahead: hollow). Shape and fill say it without colour. A phone
  shows the short names (Sign-up, Draft, Teams, Fixtures, Kumite!). It's also the navigation: a status it's reached
  opens its view, read-only if it's gone by, at its own address (`/sign-up`, `/draft`, `/teams`, `/schedule`;
  `viewOf`, `statusHref`); the one being looked at has a solid red bar under it, as a lit tab. Red bar: what you're
  looking at; node and NOW: where it is. One fixed height, no Next line under it.
- **The view** has the same shape whatever the status: its one action card for whoever runs it (`lib/DraftStep`:
  Shuffle, Open the draft, Seal the teams, Make the fixtures), members seeing the card without the button or nothing,
  then what it's about. Every other admin job is in Manage. Moving between statuses (a tap on the track, or the status
  moving on: the draft opened, closed, the fixtures made, the day starting) the header and the track stay still, the
  track's marks slide, and the view slides in from the way you went (forward from the right), the one leaving the
  other way, stacked in one cell so the area never collapses; less motion, at once. The draw's shuffle stays the draw
  to open: the same view from sign-up through the picking, for those who run it.

  | Status       | For whoever runs it               | What's on it                                                                                                                             |
  | ------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
  | Sign-up open | Close sign-up (small, not a card) | the Friday card (`lib/EventCard`: are you in, In / Out, your place), then who's in, waiting and out (`lib/WhosIn`)                       |
  | Draft open   | Draw the order, Open, Seal        | the draft (order, ticker, players, teams) for its captains and whoever runs it; everyone else is fighting blind                          |
  | Teams set    | Make the fixtures                 | every team top to bottom in full (captain, players with positions, the pick quietly, no goalie said), yours first, each opening its page |
  | Fixtures set | (made again from Manage)          | the matches, a plain list in order of play, each card opening its matchup                                                                |
  | KUMITE!      |                                   | your turn to keep score, the matches as a carousel (`lib/MatchCarousel`), then where everyone goes after, then the board                 |

| THE ANCHOR | Reveal the next award | where everyone is (🍺 The Anchor · celebration and awards, Map), the awards face down or turned over, the final table, the results |

- **Fighting blind**: a draft is its captains' and whoever runs it (ADR [0060](0060-the-draft.md)), so anyone else's
  Draft open view is a card with a blindfold, "Fighting blind" and a line from Settings → Quips ("Fighting blind", the
  first one: "Can't see the draft? Neither could Dux. He did all right."). The Worker never sends them the picks.
- **The KUMITE! carousel**: every match in order, the one that matters (`currentMatchOf`: on now, else up next, else
  the last) near the top, brought forward (full size, bright, raised), a sliver of the one before over it and the ones
  after below, smaller and dim, the depth following the scroll; a thumb scrolls it a match a snap, a desktop has
  arrows, ↑/↓ and the wheel. It glides to the new current match unless someone's just been looking along it; Back to
  now when the one in front isn't it, and back by itself once it's been left alone 8 seconds; a tap on a peeking one brings it forward. On a phone a card's stamp (KUMITE!, You
  are next!, a result) is a sticker on its top edge, so no card is taller for one; the names are one line, plain text
  (the card opens the match, whose page links both teams, with a chevron); where a team is a link it looks like one.
- **Manage** (the gear) holds every job, a row each, never a menu inside the menu, in the order they're needed: the
  step it's at first (at the draft: Undo the last pick, naming it; Add a player; Close it now, only to close early
  leaving the rest out, the Seal card closing it once everyone's picked; Reset the draft, in red words; then Make the
  fixtures again while none's played, and Confirm the awards once there are results), then Back a step, then for a
  captain **Your team** (its name and crest) and, with whoever runs the draft, the **Pick log**, and the settings
  last. A captain sees the gear for those even with nothing else in it. Back a step is the gear's alone, one on the
  page, for whoever runs the draft too (the draft's own steps). The draft room's gear has the same draft items and
  Back. A drawer opens only from a tap.
- **The after-party's view** (`lib/AfterParty.svelte`) is the pub after the film's last fight: brass on the carbon
  (a warm glow in place of the red, award names in brass), the motif kept (賞 beside the awards, a 賞 hanko on each
  one turned over, 優勝 beside the final table). Whoever runs it (`manage:Tournament`) has one card, **Reveal the next
  award**, saying which is next ("Next: Top scorer · 1 of 4 out"); before the awards are confirmed its button is
  **Confirm the awards** (the drawer, ADR [0044](0044-champions-and-awards.md)). Each tap turns one award over for
  everyone watching, in the order listed: an award still to come is a face-down card (a brass question mark, 賞 faint
  behind it); turned over while you watch, it flips, the winner burns in (`lib/BurnReveal`, the draft's) and the hanko
  comes down; opened later, what's out is just there. Face up or down, a card is the same size. After the last: "That's
  the Kumite. See you at the next one." Then where everyone is, the final table (the champions first, then the final's
  loser, then the table: `finalOrder` in `lib/afters.ts`), and the day's results, a line a match. The page follows the
  live hub all evening, as it does a match (ADR [0072](0072-live-updates.md)).
- **Revealing is the server's** (`tournaments.awards_revealed`, how many are out): `POST
/api/tournaments/:id/awards/reveal { next }` names the award the tap saw face down, by its place in the list. Only
  once the last match is played and the awards are confirmed (409 otherwise); one `UPDATE` guarded on the count the tap
  saw, so a double tap or two phones at once reveal one, the second tap finding it out already and doing nothing (ADR
  [0121](0121-load-and-concurrency.md)); a tap from a page further behind is refused. On the record as
  `tournament.award_revealed` (how many out, which one). **A member isn't sent an award's winner on its evening until
  it's revealed** (the club read's `viewer` has the evening and who runs tournaments, as the blind draft keeps its
  picks); from 06:00 every winner is history. The first one out tells everyone with the app, once ("Awards at The
  Anchor", topic `announcements`); the rest they see on the page.
- **History** is a quiet link at the foot; so is, on the Kumite, "Don't get the references? You've got some training
  to do." (the film, "Required viewing").
- **Past ones are History**, a row at the foot of the front page while the next one's on or coming up (the front
  page itself when nothing's on): each
  with how it ended (the day, the champions, the final's score), each opening its own page
  (`/tournaments/:slug/history/:id`: the champions, the final, every fight, the board, the awards), back to the list.
  Its teams' and games' pages work from there too; a past game's matchup goes back to its own page, not today's fight
  card.
- The app's **Home asks about each series' next one** while it takes sign-ups, a card with In and Out under
  Friday's; before then it's teased as a line in Home's feed ([0118](0118-home-calls-to-action-then-feed.md)).
- **Once it's started, who's in is an admin's to change**: "once the kumite goes live, the player cannot remove
  themselves. only the admin can adjust it. it has fees implications" (the user, 2026-10-23). Started is what the page
  calls under way (`hasStarted` in `lib/edition.ts`, `worker/tournaments/started.ts`): marked live or finished
  (KUMITE!, The Anchor), or a match being played or played, whatever its status says. From then a member's own In or
  Out (`POST /api/tournaments/:id/answer`) is refused with a 409 ("The Kumite's started: ask an admin to take you
  off."), inside the statements that write it ([0121](0121-load-and-concurrency.md)), so one landing as it goes live
  is refused or done whole; their place, their team and their charge ([0007](0007-dues-and-payments.md): charged from
  its day, an unpaid one goes when they do) stay as they are. The app shows where they stand without the button: the
  header's answer sheet says "The Kumite's started · Ask an admin to change it" in Can't make it's place, a card's In
  and Out are that line, the same height. An admin's Add player and take-off (`/players`, update:Event) work as ever.
  Before it starts nothing changes: a drafted player already goes through an admin once the draft's closed, a captain
  always.

- **Your next match on Home** too: it's Home's lead card when it's your soonest thing (ADR 0118), with its day and
  pitch.
- **Crests tell teams apart** (`teamInitials` in `lib/logo.ts`): without a logo, the initials skip a generic first
  word ("Team Charlie" is CH, "Team Cal" CA, "The Dim Maks" DM), and within a tournament no two share them: the
  first keeps its own, a later one takes its next letters, never another team's own.
- **After:** the champions (crest, name, how they won it), the final, every match, the awards: on its own page in
  History, with the page back to nothing on.

### The Kumite's motif

It's Bloodsport (`lib/motif.ts`): kanji beside its section headings (組手, 決勝, 試合, 闘, 賞), a red 優勝 hanko
seal on the champions' crest, and a gong for its matches. The kanji come from Noto Serif JP Black (SIL Open Font
License) cut to just those characters (under 5 KB, self-hosted). Other series have no motif. Its draft for the
uninvited is Dux fighting blind (Chong Li's powder), and its page's foot sends the newcomer to watch the film.

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
  | awards revealed (The Anchor) | before the awards           | the reveals: every award face down again (results, winners stay)    | no                      |
  | a match started or played    | the fight card, not started | results, goals, penalties, clocks, scoresheets; the playoffs' teams | red, counted            |
  | the fight card out           | the teams                   | the fixtures (made again the same)                                  | quietly                 |
  | a draft closed               | the draft, open             | nothing                                                             | no                      |
  | the draft open               | the drawn order             | the picks so far ("Draft paused" to its captains)                   | red, counted (none: no) |
  | the order drawn              | before the draw             | the order                                                           | quietly                 |
  | sign-up closed               | sign-up open                | the admin's close, and a closing day gone by                        | no                      |

  **Close sign-up** (`POST /api/tournaments/:id/signup/close`, manage:Tournament, audited `tournament.signup_closed`)
  records when, on its own (`signup_closed_at`), its dates left as they were; sign-up is over once that's set or its
  closing day's gone by (`lib/signup.ts signupOver`, the app and the Worker alike): one guarded statement, only while
  sign-up is open with nothing drawn or made (ADR 0121); Back to Sign-up open clears it. A save checks the sign-up
  dates against each other only when they change, so dates already stored closing before they open never stop one.

  `POST /api/tournaments/:id/step-back { from }` says which step it's leaving; it's refused (409) if the tournament
  has moved on since, so a tap from a page that's out of date never takes a second step. Each is one batch whose
  statements only do anything while it's still at that step, so two taps at once step back once
  ([0121](0121-load-and-concurrency.md)). An admin (`manage:Tournament`) steps back any step; whoever runs the draft
  (`run:Draft`) the draft's three, from the Draft page's Manage. It's on the record as `tournament.stepped_back`, with
  the step and the picks, order, matches, results and goals before and after. Only an open draft stepped back is
  news: each captain hears "<tournament> Draft Paused"; nothing else is sent. The awards an admin confirmed stay.

- **An admin can move a captains' draft to any status at once** (Manage: "Move to…", beside the step back): a sheet
  on a phone, a side drawer on a desktop, listing its six statuses (Sign-up open, Draft open, Teams set, Fixtures set,
  KUMITE!, The Anchor), the one it's at marked, each saying what moving there will do or why it can't. A tap asks
  first, listing every step in order. The plan is `src/lib/move-to.ts planMove`, the same for the app and the Worker:
  - **Back** any number of statuses is the steps back above, in order, in one batch: "3 results and 11 goals deleted,
    the fixtures cleared, the draft reopened"; its confirm's tap is the red-filled "Move back". Off the day (KUMITE!
    or The Anchor) the status goes back to open; The Anchor back to KUMITE! is "the day under way again" (marked
    finished undone; every match played, their results go too). On its day, Fixtures set is KUMITE!, so it isn't one
    to move back to.
  - **Forward** is the jobs in between, as an admin would do them: sign-up closed (if open), the order drawn, then
    the draft opened (Draft open); or, for Teams set and on, **everyone still to pick chosen at random** (the user,
    2026-10-23: in production too), for the team on the clock in snake order, a goalie first while the team has none,
    never a second (one a team), captains on their own teams, a goalie no team can take left out
    (`draft.ts setTeamsAtRandom`, the simulator's choosing as a real use case), each pick naming the admin, and the
    draft closed; the fixtures made in a fair order (Fixtures set); marked under way, status `live`, so the first
    match can start (KUMITE!); marked finished, status `finished` (The Anchor; matches not played stay unplayed; the
    awards are still confirmed and revealed by hand). Refused before anything changes when it can't be done (too few
    signed up for the draft, too few teams for the playoffs).

  `POST /api/tournaments/:id/move { from, to }` (manage:Tournament) sends the status the admin's page saw; it's
  refused (409) if the tournament has moved on since, so of two admins at once one moves and the other is told to
  look again. Back is one batch whose every statement only does anything while it's at that step; a step that finds
  nothing to do means someone got there first, and it's a 409 (ADR [0121](0121-load-and-concurrency.md)); forward is
  the jobs' own use cases in turn, each with its own guards, the random picks and the close one batch. One entry on
  the record, `tournament.moved`: the status and the picks, matches, results and goals before and after, and what was
  done, in words. Live to every open page; captains hear a draft opened or paused as they would from the Draft page,
  and "<tournament> Teams Set: the draft's closed, the rest were chosen at random" when it was.

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
  (19:30–21:30). A tournament's hours change only when an admin edits them: the matches starting early or late, or on
  another day, never move them (each match keeps its own actual start, [0061](0061-fixtures-games-and-scoring.md)).
- **The draft has a day, not a time** (`draft_on`). It's a reminder for the captains, on their calendar as a day; an
  admin messages them when it opens (ADR [0060](0060-the-draft.md)).

### Afterwards, and where it is

- **The header's place opens the map**, and beside it where everyone goes after (see the header above).
- **A series has an afterwards** (`tournament_types.after_venue_id`, `after_time`, `after_note`): a saved venue, an
  optional time and what for. The Kumite's is The Anchor, for the celebration and awards (the seed), so every Kumite
  has it without anyone retyping it. Set in the series' Defaults (Afterwards), beside its place and hours.
- **A tournament follows it, or not** (`tournaments.after_mode`): `usual` (its series', the default), `own` (its own
  `after_venue_id`, `after_time`, `after_note`) or `none` (not this time). Its editor's Details has Afterwards: Usual,
  a venue, or None this time. A save that leaves it out keeps what it had. Only a saved venue counts, and the API
  refuses one that doesn't exist. One rule, `afterOf` in `packages/shared/places.ts`, for the app and the agenda.
- **The page says it in the header** before the day and on it; in the KUMITE! view, once the last match is on, it's
  Then (`afterMomentOf`), with a Map button; once every match is played it's the after-party's own status, its view
  leading with it as Now.
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
- 2026-10-22: One page, by status ("It should really be a status: Draft Open, Draft Completed, Fixtures Created,
  Kumite!", the user): Sign-up open, Draft open, Teams set, Fixtures set, KUMITE!. The draft, teams, fight card and
  board pages go; their addresses show their status on the one page. The track is a journey with a NOW node (pulsing
  while it runs) and the navigation (a red bar for the status you're looking at); views slide between statuses. The
  header leads with how far off within a week and carries the afterwards beside the place; Rules (a topic each, with
  house rules) and Manage are its only buttons, the draft's own Rules, Pick log and Manage going into them. Members
  fight blind through the draft; the teams set are listed in full; the fixtures are a list, the day a carousel.
- 2026-10-22: "When undoing some of kumite steps as admin - the drawer keeps opening on its own" and "even when picking
  a player during the draft - the drawer opened" (the user): the draft handed its Manage opener up from an effect that
  returned it, so Svelte ran it as the effect's teardown on every change (a pick, a step back). The effect returns
  nothing now (lib/effects.test.ts keeps it so), and Back a step is one, in the gear, for whoever runs the draft too;
  its question keeps the step it asked about while it closes.
- 2026-10-22: The track keeps its nodes (done: a crisp tick; where it is: lit, pulsing while the Kumite runs) with each
  status's name a badge under it; the badge of the status you're looking at comes forward (red, bigger, transform
  only), no NOW stamp and no red bar, and the track measures the same on every view. Your answer is a badge in the
  header (You're in, Waiting, You're out) opening a popover (a sheet on a phone) with Can't make it, saying what it
  means for your team; the In/Out card is only for those who haven't answered. A match card's stamp sits inside it, top
  right, and the live card has no Live button (the card opens the live page). The KUMITE! carousel has more depth and a
  sheen on the match in front. The fixtures made while you watch are dealt in, the status's badge stamped in.
- 2026-10-22: "Why is add player behind the manage draft setting?" (the user): no Manage the draft drawer inside the
  gear. The draft's jobs are the gear's own rows (lib/draft-jobs.ts, done by lib/DraftJobs.svelte), the step's jobs
  first, then Back, Your team and Pick log, the settings last; Confirm the awards only once there are results.
- 2026-10-22: "The evening a Kumite ends: the last step should be the after party. Something in theme with The Anchor
  in mind. The admin reveals the award winners one at a time." (the user). A sixth status, the after-party (THE
  ANCHOR, or AFTERS), from the last match played till 06:00 the next morning, the page and Home's hero holding it
  meanwhile; its view in brass (where everyone is, the awards face down and turned over one at a time live, the final
  table champions first, the results). Revealing is server state (`awards_revealed`), one guarded statement a tap,
  audited; members aren't sent a winner before it's out; the first out is pushed once. Back a step from it turns every
  award face down again and keeps the results: going back to KUMITE! itself would mean un-playing the last match, which
  is the results step, still there once nothing's revealed.
- 2026-10-22: On dev and locally, Manage → Play out the Kumite plays the rest at random through the real draft and
  scoring, to the after-party with the awards provisional, to try it without scoring every match
  ([0123](0123-dev-only-tools.md)).
- 2026-10-23: "When in sign-up mode, the CTA for the admin is 'Draw the order' for the draft, which is confusing since
  we're in sign-up. There should be a smaller CTA instead that closes the sign-up and advances to the draft." (the
  user). Sign-up open's admin action is a small Close sign-up under the card, not the draw's step card; closing it
  (now, a route of its own, or by its closing day) moves a draft on to Draft open, where Draw the order is; Back to
  Sign-up open opens it again.
- 2026-10-23: "As a member, the sign-up card should be styled like the Friday training card." (the user). Sign-up
  open is the Friday card (lib/EventCard: are you in, In / Out, your number), then Who's in with the Kumite's kanji.
- 2026-10-23: The header's status "lacks imagination" next to your answer, both green (the user). The status is one
  ink stamp in the club's red, the status's kanji in a block of ink, the ink patchy, the edge uneven, askew; every
  status alike, KUMITE! filled; the after-party and Done in bone; no green. Your answer is your choice, not a status:
  a tick (red) or a cross, plain words, a caret; it steps aside while the sign-up card is on the page. Rules is a
  topic a page ("Pages would be better" than scrolling to it): the tabs, a swipe on a phone, the topics either side at
  the foot; it opens on the status's topic; each rule leads with its fact in bold, its figures standing out.
- 2026-10-23: Close sign-up moved the closing day to yesterday, so sign-up that opened today then closed before it
  opened, and every later save of the tournament (starting a match moves it to now) was refused. An early close is now
  its own record, `signup_closed_at`, the dates left alone; Back to Sign-up open clears it; and a save checks the
  sign-up dates against each other only when it changes them, so a tournament already stored that way still saves.
- 2026-10-23: The Kumite's sign-up is an invitation, as an object (Bloodsport's Kumite is invitation-only): a dark card
  sealed with the club's red wax (招), "You've been invited to the Kumite", the day, time and place, Accept or Decline
  (the same calls as In and Out). Accepting breaks the seal and the card becomes your fighter's pass: Fighter No. 07
  (your place in the sign-up order), your name in the poster type, 組手, the day, Withdraw with a confirm; on the
  waitlist a reserve's pass; declined, a quiet line and Accept. Every face takes the same space. Who's in is The
  fighters, numbered, with Reserves and Declined; the header's answer says Fighter No. 7, Reserve No. 3 or Declined;
  Home asks "You've been invited to the Kumite" / "Accept the invitation". A tournament's sign-up opening is now told
  to members once (topic `places`): on its opening day by the cron, or as an admin opens it by hand (or makes it open),
  marked `signup_told_at`; the Kumite's reads "An invitation has arrived", "The Cougars Kumite, Fri 23 Oct.". Only the
  Kumite (lib/motif.ts invitationOnly); every other tournament and Friday stay plain.
- 2026-10-23: One ink stamp (lib/InkStamp) for the status and the match cards: a Kumite's match up next always
  says You are next! (Chong Li's line, the club's joke, never "Up next"), a red stamp with 次 stamped down as it shows
  when it's your team's, faint otherwise; a win bone with 勝, a draw faint with 分 (red stays for yours and what's on). One vocabulary for a record: the table's columns, W D L then Pts, the same letters and figures under a team on
  a card and its matchup (lib/TeamRecord: 1W 0D 0L · 3 Pts), never "1-0-0" or "1W 0D 0L" without points. The board's
  rows are each a link to the team, the chevron at the row's end, a long name cut short. A page under the series' front
  page (a team, a match, History, an edition) has its way back as the header's eyebrow, "‹ The Cougars Kumite", a
  quiet button top left over the title, in place of a link under the header.
- 2026-10-23: An admin can move a captains' draft to any status at once (Manage, Move to…): back any number of
  statuses is the steps back in order, in one batch, its confirm listing what's undone with a red-filled Move back;
  forward does the jobs in between, and Teams set chooses everyone still to pick at random, in production too (one
  goalie a team, captains told). `POST /api/tournaments/:id/move { from, to }`, refused with a 409 when the page is out
  of date, audited `tournament.moved` (from, to, what was done).
- 2026-10-23: Once a tournament's started (marked live or finished, or a match played), a member can't say they're out
  or in: the server refuses it in the statement that writes it, and the app shows their place with "Ask an admin to
  change it"; an admin's Add player and take-off are unchanged ("it has fees implications", the user).
- 2026-10-23: The KUMITE! carousel goes back to the current match by itself, 8 seconds after it was last touched,
  scrolled or hovered, so a phone left on an old match catches up.
- 2026-10-23: The match being played wears the status's live ink stamp (組手 KUMITE!, the block of red) in place of
  the outlined badge with a dot, and it breathes, its glow swelling and fading, for as long as the match is on.
- 2026-10-23: No "fighter" in what members read (the user's call): the header's answer is "You're in · No. 7", the
  pass "Your pass" with "You're in · No. 07", Who's in keeps its own heading, the invitation counts "12 in". Reserves
  are still Reserve No. 3. The carousel's sliver of the match before is 4.5rem, so Back to now (and opening) shows
  enough of it to read as a card above the one in front.
- 2026-10-23: The champions wear an ink stamp like the match cards' (bone, 優勝, "Kumite Champions": the series' short
  name), on the board and the after-party's final table, in place of the trophy badge; on the final table the points
  keep their own last column, so the champions' stamp never pushes theirs out of line, and they read Pts as
  everywhere else.
- 2026-10-23: The pass speaks for a secret, invitation-only night, not a real fight (it's a hockey tournament
  playing at being the Kumite): "Admission", "Admitted · No. 02" (the header's answer "Admitted · No. 2"), signed off
  "Tell no one." in place of "See you on the mat."; the number a size smaller, so it no longer dwarfs the name.
- 2026-10-23: "When the admin is revealing the awards … bring each card up one at a time", then "how about the admin
  taps the card to reveal" (the user). The after-party's awards come up one at a time: what's out face up, the next one
  sealed (the question mark and 賞), the rest empty numbered slots with their room kept, so nothing moves. Whoever runs
  it taps the sealed card itself to reveal it (Tap to reveal: the award's name; Enter or Space too), in place of the
  Reveal the next award card, which stays only to confirm the awards first; everyone else's sealed card says Waiting for
  the reveal. Each reveal flips the card over for everyone watching, brings it into view, and the next sealed card rises
  in; with reduced motion the face and the next card fade in instead.
- 2026-10-23: The pass is stamped: an ADMITTED ink stamp (招, red, askew) lands in its corner as it turns over, a
  faint RESERVE for a reserve, in place of the red 組手 seal; the name is a poster, the page titles' heavy italic
  capitals with the red slash under them; "No. 02" is a small line under "By invitation only", not the headline. Who's
  in's rows turn the player's card over (PlayerCardZoom), as Friday's do.
- 2026-10-23: The pass's middle is its one rule as a poster: TELL NO ONE. in worn italic capitals, "Not your mates.
  Not your mum. No one." under it; its foot is a stub torn off along a dashed line, with "Can't make it?" and Punk out
  (in place of Withdraw), whose confirm asks "Punk out? Tanaka will be disappointed." (Dux's master in the film).
- 2026-10-23: The pass's rule gets its switch a beat after the bait: "…OK, tell your mates. We need 6 more." (the
  places left), or, full, "…OK, tell your mum. She can watch."
- 2026-10-23: The pass's rule is revealed a phrase at a time as it shows, each pressed down like an ink stamp (TELL NO
  ONE., then Not your mates., Not your mum., No one.), the switch last after a beat; with less motion, all at once.
- 2026-10-23: The rule's phrases are rubber-stamped words (the poster face in worn ink, each askew), one to a line,
  pressed down about a second apart for the drama: TELL NO ONE., Not your mates., Not your mum., No one., then the
  switch.
- 2026-10-23: A tournament's hours change only when an admin edits them, never by its matches starting early, late or
  on another day; the card shows a match's actual start once it's on (0061).
- 2026-10-23: No stamp effect on the bait after all: under TELL NO ONE. the phrases take turns in one place, each
  shown and gone before the next (Not your mates., Not your mum., No one.), then the switch, which stays; with less
  motion they're all shown, one to a line.
- 2026-10-23: Then the reveal the user settled on: TELL NO ONE. and each phrase under it fly in and land like a stamp
  (InkStamp's land, without the ink), one at a time about a second apart, the switch last after a beat, and all of
  them stay; with less motion all are there at once.
- 2026-10-23: Slower, and the bait on one line (Not your mates. Not your mum. No one.) with the switch under it: the
  phrases land about 1.4s apart, the switch 2s after the last.
