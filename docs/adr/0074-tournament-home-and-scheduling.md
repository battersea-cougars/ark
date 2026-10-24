# 0074. A tournament's page follows its status: one page per edition, a track of its statuses, a view for each

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-24
- **Merges:** 0086

## Context

The Kumite's home stacked cards whatever the day: a date card with sign-up, the draft, the games, the teams, and once it
was won a champions card above a "Date TBC" card. The settings (status, date confirmed) said one thing and the results
another. Past Kumites were a list at the bottom.

Running a tournament from Manage is [0127](0127-running-a-tournament-from-manage.md), scheduling one
[0128](0128-scheduling-a-tournament.md), and its after-party and the awards' reveal
[0129](0129-the-after-party-and-the-reveal.md): all three were part of this record until 2026-10-24.

## Decision

### The page follows the tournament, not its settings

- **Its state comes from its games** (`lib/edition.ts`): under way once a game's being scored or has a result, done once
  every game's played (or an admin marked it finished). Before then, sign-up open or coming up. The day shows once it's
  confirmed or the games have been played; the season always.
- **The header carries the when and the where** on every tournament page (`TournamentHead.svelte`), two fixed lines. The
  first: within a week, how far off leads, big, in the club's red ("TOMORROW · Fri 23 Oct · 7 to 9:30pm"; Today,
  Tomorrow, This Friday, In 7 days; `countdownOf` in `lib/edition.ts`; a phone drops the hours to keep it one line);
  further off, the date leads with "in 24 days" quiet after it. The second: the place on the map (pin) and, beside it,
  where everyone goes after (a pint glass: "📍Battersea Sports Centre · 🍺The Anchor"); just a season, "Day to be set".
  Its actions, the same on every status: **Rules** (one sheet, a topic a page: Sign-up, The draft, Format, Points,
  Penalties, House rules; `formatAndRules` in `lib/format-rules.ts`, from what's stored and enforced, nothing invented;
  a series' house rules are plain text an admin writes, `tournament_types.house_rules`) and **Manage** (the gear).
- **A series opens on its next one** (`currentOf`): the one under way, else the next one not done (a tentative date or
  just a season is enough). One whose day passed unplayed is still the one, until an admin plays it, moves it or deletes
  it. The series' other pages show the same one; there's no switcher. Once the last game's played it's history:
  nothing's on.
- **With nothing on, the series is one page.** No Fight card, The board, Teams, Draft or History (they're for one that's
  running), so no strip of pages. The front page says so big, in the series' motif: for the Kumite, 組手 down the side
  like a film poster with a 拳 hanko stamped on it, the gong, "No Kumite yet. The gong's quiet. Train hard." An admin's
  **Next Kumite** is on it. Under it, every past one, newest first.
- **One page, by status** (`Games.svelte`): "Fight Card is confusing if we think of the kumite in stages. It should
  really be a status: Draft Open, Draft Completed, Fixtures Created, Kumite!" (the user, 2026-10-22). The tournament is
  one page: the header, the track of its statuses, then that status's view. Its draft, teams, fixtures and board are no
  longer pages of their own.
- **Every edition has its own address** ("this page is the layout for that specific kumite — the url should reflect
  that", the user, 2026-10-23): `/tournaments/:slug/:id`, its statuses under it (`/:id/sign-up`, `/draft`, `/teams`,
  `/schedule`, `/day`, `/afters`; `lib/edition-address.ts`). The id decides what everything on the page shows: the page
  hands its edition to each status's view (the draft, the teams, the fixtures) rather than each looking up the one on.
  The series' address, `/tournaments/:slug`, is its front door: with one on it's replaced by that one's address, and so
  are its old status addresses (`/tournaments/kumite/draft` → `/tournaments/kumite/12/draft`), so the pushes, Home's
  cards and emails that use them keep working and the address always says which one (`frontDoorTo`, `App.svelte`); with
  nothing on, it stays No Kumite yet. An edition that's gone goes back to the front door. Not a tab of its own: the
  Kumite tab opens the front door, so it never sticks on last week's.
- **The statuses** (`statusOf`, `statusesOf` in `lib/tournament-front.ts`): **Sign-up open** → **Draft open** → **Teams
  set** → **Fixtures set** → **KUMITE!** (the series' own name, on the day or once a match has started) → **THE ANCHOR**
  (the after-party, named after its afterwards; **AFTERS** when it has none); teams that enter skip the draft. "Teams
  set" for both, draft or not: "Teams finalised" didn't fit a phone's track. A draft leaves Sign-up open when sign-up
  closes (its closing day gone by, or an admin's **Close sign-up**); Draft open is where the order's drawn and the draft
  opened.
- **The after-party** is the last status: from the last match played (or an admin's finish) till 06:00 London the next
  morning, the series' page stays on it, even with the next one scheduled; then it's in History. Its view, the awards'
  stage and the reveal are [0129](0129-the-after-party-and-the-reveal.md).
- **The track** (`lib/StageTrack`) is a journey: one line through the statuses, filled to where it is and faint after,
  a node each (done: a tick; where it is: lit, pulsing while the Kumite runs on its day; ahead: hollow), each status's
  name a badge under its node (upright, done quiet, ahead faint). Fill, tick and size say it without colour. A phone
  shows the short names (Sign-up, Draft, Teams, Fixtures, Kumite!). It's also the navigation: a status it's reached
  opens its view, read-only if it's gone by, at its own address under the edition's (`/sign-up`, `/draft`, `/teams`,
  `/schedule`, `/day`, `/afters`; `viewOf`, `statusHref`); the one being looked at has its badge brought forward (the
  header stamp's red, bigger, transform only). Badge forward: what you're looking at; lit node and fill: where it is.
  One fixed height.
- **The view** has the same shape whatever the status: its one action card for whoever runs it (`lib/DraftStep`:
  Shuffle, Open the draft, Seal the teams, Make the fixtures), members seeing the card without the button or nothing,
  then what it's about. Every other admin job is in Manage. Moving between statuses (a tap on the track, or the status
  moving on: the draft opened, closed, the fixtures made, the day starting) the header and the track stay still, the
  track's marks slide, and the view slides in from the way you went (forward from the right), the one leaving the other
  way, stacked in one cell so the area never collapses; less motion, at once. The draw's shuffle stays the draw to open:
  the same view from sign-up through the picking, for those who run it.

  | Status       | For whoever runs it                                                                  | What's on it                                                                                                                                                          |
  | ------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Sign-up open | Close sign-up (small, not a card)                                                    | the Friday card (`lib/EventCard`: are you in, In / Out, your place), the Kumite's invitation (below), then who's in, waiting and out (`lib/WhosIn`)                   |
  | Draft open   | Draw the order, Open, Seal                                                           | the draft (order, ticker, players, teams) for its captains and whoever runs it; everyone else is fighting blind                                                       |
  | Teams set    | Make the fixtures                                                                    | every team top to bottom in full (captain, players with positions, the pick quietly, no goalie said), yours first, each opening its page                              |
  | Fixtures set | (made again from Manage)                                                             | the matches, a plain list in order of play, each card opening its matchup                                                                                             |
  | KUMITE!      |                                                                                      | your turn to keep score, a switch (Fight card / The board), the matches as a carousel (`lib/MatchCarousel`) or the board in its place, then where everyone goes after |
  | THE ANCHOR   | Confirm the awards, then the reveal ([0129](0129-the-after-party-and-the-reveal.md)) | where everyone is, The awards, Cast your vote till they're confirmed, the final table, the results                                                                    |

- **Fighting blind**: a draft is its captains' and whoever runs it (ADR [0060](0060-the-draft.md)), so anyone else's
  Draft open view is a card with a blindfold, "Fighting blind" and a line from Settings → Quips ("Fighting blind", the
  first one: "Can't see the draft? Neither could Dux. He did all right."). The Worker never sends them the picks.
- **The KUMITE! carousel**: every match in order, the one that matters (`currentMatchOf`: on now, else up next, else the
  last) near the top, brought forward (full size, bright, raised), a sliver of the one before over it and the ones after
  below, smaller and dim, the depth following the scroll; a thumb scrolls it a match a snap, a desktop has arrows, ↑/↓
  and the wheel. It glides to the new current match unless someone's just been looking along it; Back to now when the
  one in front isn't it, and back by itself once it's been left alone 8 seconds; a tap on a peeking one brings it
  forward. On a phone a card's stamp (KUMITE!, You are next!, a result) is a sticker on its top edge, so no card is
  taller for one; the names are one line, plain text (the card opens the match, whose page links both teams, with a
  chevron); where a team is a link it looks like one.
- **The board on the day**: a switch above the fight card, the app's Tabs (Fight card / The board), Fight card first;
  The board shows the table as it stands in the carousel's place, not under it, so the page has one scroll and the
  carousel the other. The switch never moves, and the cell keeps the carousel's height, so Your next and where everyone
  goes after stay put; the one coming in slides from its side (less motion: at once). The choice holds while the app's
  open, never stored. Everyone sees it, once there are matches.
- **Manage** (the gear) holds every admin job, following where the tournament stands: what it offers at each stage, a
  step back and Move to… are [0127](0127-running-a-tournament-from-manage.md). Scheduling the next one, sign-up's
  opening day and deleting one are [0128](0128-scheduling-a-tournament.md).
- **History** is a quiet link at the foot; so is, on the Kumite, "Don't get the references? You've got some training to
  do." (the film, "Required viewing").
- **Past ones are History**, a row at the foot of the front page while the next one's on or coming up (the front page
  itself when nothing's on): each with how it ended (the day, the champions, the final's score), each opening its own
  page (`/tournaments/:slug/:id`; History's old `/history/:id` goes there): the same page as the one on, its header and
  its track, every status it reached a tap away and read-only where it's over, its eyebrow the way back to the list ("‹
  All Kumites"). Its after-party's view, any day after its evening, is its results (`lib/EditionResults`: the champions,
  the final, every fight, the board, the leaders, the awards); its draft, once it's all played, is everyone's to look
  back on, not just its captains'. Its teams' and games' pages work from there too and go back to its page, not today's.
- **Past ones are read when they're opened** (#175): the app opens with each series' ones still to play, its last one
  played and any from the last fortnight, never every one there's been. A past one's page (or a link to one of its
  games or teams) reads it in full (`GET /api/tournaments/:id`, by a game or team too), showing the page's room while
  it comes, and keeps it; History, and the front page with nothing on, list the played ones a page at a time, newest
  first, as the list's end comes into view (`GET /api/tournament-types/:id/editions?before=<day>_<id>&limit=N`), with
  the all-time leaders counted by the Worker. A team's logo is at its own address, kept by the browser; one of 2 KB
  or less (a generated crest) comes as itself, so History's crests aren't a request each (#177).
- The app's **Home asks about each series' next one** while it takes sign-ups, a card with In and Out under Friday's;
  before then it's teased as a line in Home's feed ([0118](0118-home-calls-to-action-then-feed.md)).
- **Once it's started, who's in is an admin's to change**: "once the kumite goes live, the player cannot remove
  themselves. only the admin can adjust it. it has fees implications" (the user, 2026-10-23). Started is what the page
  calls under way (`hasStarted` in `lib/edition.ts`, `worker/tournaments/started.ts`): marked live or finished (KUMITE!,
  The Anchor), or a match being played or played, whatever its status says. From then a member's own In or Out (`POST
/api/tournaments/:id/answer`) is refused with a 409 ("The Kumite's started: ask an admin to take you off."), inside
  the statements that write it ([0121](0121-load-and-concurrency.md)), so one landing as it goes live is refused or done
  whole; their place, their team and their charge ([0007](0007-dues-and-payments.md): charged from its day, an unpaid
  one goes when they do) stay as they are. The app shows where they stand without the button: the header's answer sheet
  says "The Kumite's started · Ask an admin to change it" in Can't make it's place, a card's In and Out are that line,
  the same height. An admin's Add player and take-off (`/players`, update:Event) work as ever. Before it starts nothing
  changes: a drafted player already goes through an admin once the draft's closed, a captain always.
- **Your next match on Home** too: it's Home's lead card when it's your soonest thing (ADR 0118), with its day and
  pitch.
- **Crests tell teams apart** (`teamInitials` in `lib/logo.ts`): without a logo, the initials skip a generic first word
  ("Team Charlie" is CH, "Team Cal" CA, "The Dim Maks" DM), and within a tournament no two share them: the first keeps
  its own, a later one takes its next letters, never another team's own.
- **The Kumite's sign-up is an invitation** (`lib/KumiteInvite`; only the Kumite, `invitationOnly` in `lib/motif.ts`:
  every other tournament and Friday stay plain): Bloodsport's Kumite is invitation-only, so a member who hasn't answered
  gets a dark card sealed with the club's red wax (招), "You've been invited to the Kumite", the day, time and place,
  Accept or Decline (the same calls as In and Out). Accepting breaks the seal and the card becomes your pass:
  "Admission", your name as a poster, "By invitation only" and your number (your place in the sign-up order), an
  ADMITTED ink stamp (a faint RESERVE on a reserve's); across its middle TELL NO ONE., then "Not your mates. Not your
  mum. No one…" landing a phrase at a time, then the switch, an aside ("ok, tell your mates. We need 6 more.", or full,
  "maybe tell your physio. That knee's dodgy."); on its torn-off stub "Can't make it?" and Punk out ("Punk out? Tanaka
  will be disappointed."). Declined, a quiet line and Accept. Every face takes the same space. The pass stays on the
  Sign-up view once you're in or a reserve, through the day; Punk out goes once it's started. The words are a secret
  invitation, not a real fight: no "fighter" in what members read; the header's answer is "Admitted · No. 2". Home asks
  "You've been invited to the Kumite".
- **Ink stamps** (`lib/InkStamp`) say a status and a match's state: the header's status is one stamp in the club's red,
  its kanji in a block of ink, patchy and askew (KUMITE! filled; the after-party and Done in bone; no green). A Kumite's
  match up next always says You are next! (with 次 when it's your team's, faint otherwise); a win is bone with 勝, a draw
  faint with 分; the match being played wears 組手 KUMITE!, glowing and breathing while it's on; the champions wear 優勝. A
  card's stamp sits in one fixed box, so nothing shifts as one gives way to the next. The stage track's badges stand
  upright (slanted they read as buttons); the header's stamp keeps its tilt.
- **A record is written 1-0-0 · 3 Pts** (won-drawn-lost, then points), on the match cards, the matchup, the teams' list
  and the board, all through `lib/TeamRecord`; the board's rows each link to the team.
- **Your answer** is a badge in the header (You're in, Waiting, You're out) opening a sheet with Can't make it; the
  In/Out card is only for those who haven't answered.

### The Kumite's motif

It's Bloodsport (`lib/motif.ts`): kanji beside its section headings (組手, 決勝, 試合, 闘, 賞), a red 優勝 hanko seal on the
champions' crest, and a gong for its matches. The kanji come from Noto Serif JP Black (SIL Open Font License) cut to
just those characters (under 5 KB, self-hosted). Other series have no motif. Its draft for the uninvited is Dux fighting
blind (Chong Li's powder), and its page's foot sends the newcomer to watch the film.

### Where it is, and where everyone goes after

- **The header's place opens the map**, and beside it where everyone goes after (see the header above).
- **A series has an afterwards** (`tournament_types.after_venue_id`, `after_time`, `after_note`): a saved venue, an
  optional time and what for. The Kumite's is The Anchor, for the celebration and awards (the seed), so every Kumite has
  it without anyone retyping it. Set in the series' Defaults (Afterwards), beside its place and hours.
- **A tournament follows it, or not** (`tournaments.after_mode`): `usual` (its series', the default), `own` (its own
  `after_venue_id`, `after_time`, `after_note`) or `none` (not this time). Its editor's Details has Afterwards: Usual, a
  venue, or None this time. A save that leaves it out keeps what it had. Only a saved venue counts, and the API refuses
  one that doesn't exist. One rule, `afterOf` in `packages/shared/places.ts`, for the app and the agenda.
- **The page says it in the header** before the day and on it; in the KUMITE! view, once the last match is on, it's Then
  (`afterMomentOf`), with a Map button; once every match is played it's the after-party's own status, its view leading
  with it as Now.
- **The day's calendar entry says it** in its description ("Afterwards: The Anchor, from 9:45pm. Celebration and
  awards."), so the website's What's on does too.

## Consequences

- A tournament's status matters less: an admin needn't mark it live or finished, or open sign-up, for the page to move
  on.
- Every edition has an address of its own, so it can be shared, and a past one reads as it did on the night.
- The page's look is the Kumite's own (the motif, the invitation, the stamps); another series gets the plain page.

## History

- 2026-10-08: The page follows the day, its state from its games; the header carries the when; past ones move to
  History; the series opens on its next one; the Kumite gets its motif (was 0074).
- 2026-10-08: The before act says less: no lede, captains as discs (was 0086).
- 2026-10-20: With nothing on, the series is one page: a big "No Kumite yet" with every past one under it.
- 2026-10-21: Home asks about the Kumite while sign-up is open, and teases it before
  ([0118](0118-home-calls-to-action-then-feed.md)).
- 2026-10-21: The front page follows the stage, each leading with one thing; crests skip a generic first word and never
  share initials.
- 2026-10-22: A track of the stages leads the page and replaces the tabs as its navigation.
- 2026-10-22: The header's place is a map link; a series has an afterwards, The Anchor for the Kumite, which a
  tournament keeps, replaces or skips.
- 2026-10-22: One page, by status (Sign-up open, Draft open, Teams set, Fixtures set, KUMITE!); members fight blind
  through the draft; the fixtures are a list and the day a carousel; Rules and Manage are the header's only buttons.
- 2026-10-22: The track's status names are badges under the nodes, the one you're looking at brought forward (no NOW
  stamp or red bar); your answer is a badge in the header, the In/Out card only for those who haven't answered.
- 2026-10-23: Sign-up open is the Friday card; the header's status is an ink stamp; Rules is a topic a page.
- 2026-10-23: The Kumite's sign-up is an invitation that becomes your pass; a tournament's opening is told once.
- 2026-10-23: One ink stamp for the status and the match cards (You are next!, 勝, 分).
- 2026-10-23: Once it's started, who's in is an admin's to change ("it has fees implications", the user).
- 2026-10-23: The carousel goes back to the current match by itself after 8 seconds.
- 2026-10-23: No "fighter" in what members read; the pass is "Admission", stamped ADMITTED, its rule TELL NO ONE.
  landing a phrase at a time, then the switch; Punk out on its stub.
- 2026-10-23: The champions and the match being played wear ink stamps; a stamp sits in one fixed box.
- 2026-10-23: A record is written 1-0-0 · 3 Pts, through `lib/TeamRecord`.
- 2026-10-23: The board is a switch above the fight card on the day, in its place, live from the fixtures.
- 2026-10-23: The track's badges stand upright.
- 2026-10-23: Every edition has its own address (`/tournaments/:slug/:id`), its statuses under it; the series' address
  is its front door; a past one's draft is everyone's.
- 2026-10-23: A Kumite whose day passed unplayed stays the one until an admin plays, moves or deletes it (#169).
- 2026-10-24: Split: Manage's jobs to ADR 0127, scheduling to 0128, the after-party and reveal to 0129; History
  shortened to a line per change; the invitation, the stamps and the record's format, which had been only in History,
  stated in the Decision, and the track as it is (badges, no NOW stamp).
- 2026-10-24: Past ones read when they're opened, History a page at a time, logos at their own address (#175, the
  user: "there's no need to load all the kumites to the UI").
- 2026-10-24: A logo of 2 KB or less is sent as itself, not its address (#177): a page of History with twenty generated
  crests made twenty requests that queued. Sent back as it came, the team keeps it. The matchup's past meetings and
  the editor's Brings are read from the server, not looked for in the editions the app holds.
