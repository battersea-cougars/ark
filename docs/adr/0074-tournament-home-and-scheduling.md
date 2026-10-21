# 0074. A tournament's home follows the day in three acts, and the next one is scheduled from it in a few questions

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-21
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
- **The header carries the when** on every tournament page (`TournamentHead.svelte`): the day big (or _Date to be
  confirmed_), the season, the hours and place, and the state.
- **A series opens on its next one** (`currentOf`): the one under way, else the next one not done (a tentative date
  or just a season is enough). The series' other pages show the same one; there's no switcher. Once the last game's
  played it's history: nothing's on.
- **With nothing on, the series is one page.** No Fight card, The board, Teams, Draft or History (they're for one
  that's running), so no strip of pages. The front page says so big, in the series' motif: for the Kumite, 組手 down
  the side like a film poster with a 拳 hanko stamped on it, the gong, "No Kumite yet. The gong's quiet. Train hard."
  An admin's **Next Kumite** is on it. Under it, every past one, newest first.
- **Past ones are History**, a tab while the next one's on or coming up (the front page when nothing's on): each
  with how it ended (the day, the champions, the final's score), each opening its own page
  (`/tournaments/:slug/history/:id`: the champions, the final, every fight, the board, the awards), back to the list.
  Its teams' and games' pages work from there too; a past game's matchup goes back to its own page, not today's fight
  card.
- The app's **Home asks about each series' next one** while it takes sign-ups, a card with In and Out under
  Friday's; before then it's teased as a line in Home's feed ([0118](0118-home-calls-to-action-then-feed.md)).

### The acts (`Games.svelte`)

- **Before:** the sign-up line, the draft, the teams, the first fight once the card's out. Nothing else: no lede, no
  "not final" hint. The sign-up line says where sign-up stands ("Sign-up opens Fri 16 Oct" before it opens). The
  teams are "Teams", each with its crest and name, and a line under only when it adds something ("Your team", or its
  captain once the team has its own name). The draft card leads with the draft's day or "Draft date TBC", shows the
  captains as discs (initials in their team's colour, the name on hover and for a screen reader, a ring on yours),
  or says "Captains to be named."
- **During:** your turn to keep score, the fight on now and the next, the latest results.
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
