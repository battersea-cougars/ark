# 0060. A captains' draft is run by an admin, picked by its captains, and seen by members once it's closed

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-22
- **Merges:** 0064, 0066, 0067, 0068, 0070

## Context

The Kumite's teams are drafted: members sign up, captains are assigned, and on the night the captains pick in turns
([0030](0030-training-and-tournament-schedule.md) has tournament kinds and teams). The first draft let captains pick
from midnight on the draft day with no end, kept withdrawn members on their teams, and let a save of the tournament's
editor rewrite every team mid-draft. Draft night is busy and on phones: one mis-tap must not lose a pick, a draft that
goes wrong needs a way back, and who was picked first or last is the stuff of a week's arguments.

## Decision

### Lifecycle

- `tournaments.draft_state`: none (reads as scheduled while it has a day and captains) → **open** → **closed**. Whoever
  runs the draft (`run:Draft`) opens and closes it; nothing happens on its own.
- **The night is led one step at a time**, one main (sticker-yellow) button for whoever runs it at each: **Shuffle**,
  then **Open draft**, then the picking, then **Close draft & make fixtures**; closed, the page says so and Reopen is
  in Manage. Each step is **one card in the middle of the page** (`lib/DraftStep.svelte`): the series' motif for the
  step as its mark (on the Kumite 籤 for the draw, 開 to open, the 決 hanko to seal the teams; other series their icon),
  its name ("Draw the order", "Open the draft", "Seal the teams"), one line and the button. Everyone else sees the
  same card without the button ("Draft not open yet"). **The draw is a moment**: before it there's only the card, the
  captains in it; the shuffle plays there, for whoever pressed it and every captain watching; once the order's stamped
  on, the card lets go, the order stays as the page's order row, and the Open the draft card, the players and the
  teams come in under it. With less motion, or opened after, it's just there.
- **Two steps before it opens: shuffle the order, then open the draft.** The pick order is never the order the
  captains were named in, which means nothing: being named first mustn't mean picking first. Before it opens, whoever
  runs the draft taps **Shuffle** (`POST …/draft/draw`, `run:Draft`): the server draws it, a Fisher-Yates shuffle on
  `crypto.getRandomValues`, and stores it as `tournament_teams.pick` (1 = first). Each number is set only while some
  captain is still without one, in one batch, so a second admin's tap a moment later changes nothing. Until it's drawn
  the page shows only the captains: the players and the teams come once the order's there. Then **Open draft**
  (`…/draft/open`) opens it; opening with no order set is refused (409, "Set the order first."). **Opening tells each
  captain on their phone** ([0108](0108-store-apps.md), topic `draft`), with their place: "Kumite Summer 2027 Draft
  Open", "You pick 2nd" (the tournament's name, then their place in round one), a tap opening the Draft page. Only
  the first time: a closed draft reopening isn't news. The order is
  fixed from then on: setting it again, opening, closing and reopening, and saving the editor keep it, and the editor
  can't reorder the captains. Changing the captains before it opens takes the order away (it was for the old ones),
  to be set again; a reset takes it away too. It's round one's; the snake turns it each round. Until it's set, `pick`
  is null and the app shows the captains without numbers ("Waiting for the order").
- **Everyone sees the order set.** Setting it reaches every open Draft page at once ([0072](0072-live-updates.md);
  the page follows the stream before it opens, from the draft's day); a page that sees the order arrive shuffles the
  captains' names (Svelte `flip`, about two and a half seconds) and settles them into the order with the numbers
  stamped on, and on the Kumite its blood seal (`lib/DraftOrder.svelte`). A captain reads their place in words ("you
  pick 2nd"), there and on the series' home card. Someone opening the page later, or asking for less motion, just
  sees the order. The shuffle on screen is only for show: the order is the server's.
- Opening needs at least two captains, and the first time enough sign-ups for every team to have its captain and two
  more (`MIN_TEAM_SIZE`, `playersNeeded` in `src/lib/draft.ts`). Otherwise 409.
- Closing needs everyone picked, or the admin choosing to leave the rest out. Closed locks the picks and the captains.
- **Closing makes the fixtures, in one tap** (`POST …/draft/finish`, `run:Draft`, `{ leaveOut }`): closed, then the
  round robin and playoffs ([0061](0061-fixtures-games-and-scoring.md)). Everything that could refuse is checked
  first (players left, enough teams for the playoffs), so a refusal changes nothing; the close is the claim
  ([0121](0121-load-and-concurrency.md)): only the request that turns it from open to closed makes the fixtures, so a
  double tap closes once and makes one set. Fixtures already made (before the draft, or before a reopen) are kept:
  they're between the same teams. With too few teams for the playoffs and none made, the page offers a plain close
  (`…/draft/close`) and says to change the playoffs; Make the fixtures follows on the closed page.
- **A closed draft reopens** (Reopen, in Manage; `POST …/draft/reopen`, `{ fixtures: "keep" | "clear" }`), keeping its
  picks: the captain on the clock is whoever's next, as if it had never closed. With fixtures made, the app asks what
  becomes of them. **Keep** (the default) while no match has started: they're between the same teams, and closing
  again keeps them. **Clear** deletes the matches with their results, goals, penalties and scoresheets, and needs
  someone who edits the tournament (`manage:Tournament`) as well. Once a match has started or has a result, clearing
  is the only way to reopen ("keep" is a 409, "A match has started: clear the fixtures to reopen the draft."), and the
  app says first what will go ("1 result and 3 goals will be deleted", counted from the matches the server sent), with
  a red "Clear the fixtures and reopen"; a team can still be changed on the Teams page without that. The clear and the
  reopen are one batch, each statement running only while the draft is still closed (and keeping only while nothing's
  been played), so a double tap reopens and clears once and the second is refused ([0121](0121-load-and-concurrency.md)).
  The record has `draft.reopened` with the matches, results and goals before and after. Adding a player to a closed
  draft is refused (409): reopen it first.
- **Reset** (`run:Draft`, open or closed) takes every pick off and sets `draft_state` back to none. Sign-ups, captains
  (and admin-added players, who are sign-ups) and the fixtures stay. It's allowed after games have results; the app
  asks first, since it can't be undone.
- The draft night is on the agenda for its captains and whoever runs the draft until it's closed
  ([0042](0042-website-reads-the-club-agenda.md)); a reset puts it back.

### Picking

- Picks only while it's open, in snake order, from members who said they're in. **Captains are in automatically**, on
  their own team, never in the pool, and can't withdraw themselves.
- Each pick has a `pick_number` (`tournament_team_players`): turn order and Undo (the last pick) follow it. **The turn
  is the first pick number nobody has** (`NEXT_SLOT` in `draft.ts`, `nextSlots` in `src/lib/draft.ts` for the page),
  not how many picks there are (#125): a pick that comes off (the player says they're out, an admin takes them off)
  leaves its number empty, and the team whose pick it was fills it next, with that number; then the draft goes on
  from the last. With no gaps it's the count, as before.
- **Picking is two steps.** Pick marks a player on your screen (tap another to change your mind); **End turn** sends
  it. The server is unchanged: a pick is one request. Whoever runs the draft picks for the captain on the clock the
  same way. Picking out of turn, or someone no longer in the pool, is a 409. A pick says which turn it's for (`turn`,
  the slot the page saw on the clock: the picks it had seen, with no gaps): one landing after the turn moved on (a second phone, the captain whose snake turn
  comes twice running) is refused, never spent on their next pick ([0121](0121-load-and-concurrency.md)).
- **The draft room** (`/tournaments/{slug}/draft/room`, lib/draft-room.ts, pages/DraftRoom.svelte): the draft as the
  whole screen, for its captains and whoever runs it while it's open. A focus page (no rail, dock, tabs, header,
  track or footer), and the browser's full screen where it gives a page one (requestFullscreen on the root; an
  iPhone's Safari doesn't, and the room is the whole page there). A slim bar: the mark, Draft room, whose turn (and,
  for a captain waiting, how long till theirs), Manage the draft for whoever runs it, and ✕. Under it, filling the
  window to its foot: the picks a size up, then on a desktop a board, the pool down the left and every team a column
  in pick order, each scrolling inside itself, the one on the clock lifted, each with a row for every pick to come
  (so a pick fills its row and moves nothing); narrower than the board, the teams are the page and the players open
  in a drawer from a button at the screen's foot (Your pick on your turn), the confirm inside it. Pick and End turn
  as ever, live as ever. The way in is a quiet Draft room on the draft's strip, lit red (no bigger) when your
  pick's now or two away; Home's row for a captain whose pick is that close goes straight in. Out by ✕, Escape (or
  the full screen ending), or Back (it's an address of its own); shown out to the page, the teams set sliding in,
  once the draft closes, and likewise if it steps back or it isn't yours.
- **A pick made for a captain says so.** Each pick records who made it (`tournament_team_players.picked_by`). When
  that isn't the team's captain, the app says it as theirs, for that team: "Dana picked Reg for Team Cara" on the
  last-pick line, "Dana took Reg" on the ticker, "Dana for Team Cara" in the pick log, "Dana's pick" on the team card,
  and before the pick "Picking for Team Cara" over the pick button and "Pick for Cara" on it (the turn at the top
  just says whose turn it is, "Team Cara picking", for everyone, and a tap on it brings the ticker back to that pick). The record gets `draft.picked_for`, naming the
  player, the captain and who picked; a captain's own pick stays off it (it's the draft's own record). Members who
  see the teams once it's closed get no pick numbers and no pickers.
- **One goalie a team** (`members.position = 'G'`), counting its captain, however someone gets onto a team: a
  captain's pick, a pick by whoever runs it, or an admin's team edit. A second is refused: "They've got a goalie
  already." Teams that enter whole (`kind: "teams"`) bring their own side. The Draft page has goalies as their own
  filter, shows each team's D/F/G count, and drops Pick from a goalie's row once your team has one.
- Withdrawing while the draft is open takes the pick off their team; once it's closed, or for a captain, it goes
  through an admin.

### Where it's edited

- The Draft page is for picking and running the draft. It shows the teams but doesn't edit them. Before it starts it
  shows the captains and the order (and, for whoever runs it, Shuffle, then Open draft; the players and teams only once the order's drawn). Once it's on, the
  page is the draft: the order folds away (each team card shows its place, "1st"), the most room goes to the players
  left, and what isn't picking is small or behind a tap. One line says whose pick it is, and one small line under it
  who's next (a captain's own place, "You pick 2nd", at its end on a phone, before the icons on a desktop). There's no
  last-pick line: the ticker's newest chip is the last pick ("2 · took Cal", or "2 · Dan took Cal" when someone picked
  for the captain), and it lights up as a pick lands (not with reduced motion); a screen reader hears each pick said
  whole. Rules, the pick log and **Manage** (Undo, Add player, Close, Reset: a bottom sheet on a phone, a side drawer on
  a desktop, asking there before closing with players left or a reset) are icons on that first line. On a phone the
  series' header goes altogether (the page's tabs say where you are), the ticker stays, shorter, the tabs and chips are
  a size smaller, and the players scroll inside the window's height (`.page.fit`), starting about a third of the way
  down. Once everyone's picked, whoever runs it has **Close draft & make fixtures** over the players and
  teams (one request: closed, then the fixtures). A closed draft says so on the page ("Draft closed", the teams set,
  See the fixtures); Reopen and Clear the fixtures (the same question, without reopening) are in Manage, and
  Make the fixtures is on the page only when none are made.
- Teams are edited on the **Teams page** (`/tournaments/:slug/teams`): every team and its players, Edit opening the
  team drawer over it (`manage:Tournament`). The page itself is everyone's (`read:Event`).
- The tournament editor changes teams **in place** (by id), never writes a draft's players or its pick order, and
  can't change the captains once the draft is open. A save without some rules keeps the tournament's own, not the
  series'.

### A captain brings their team to the series' next edition

- Nothing about it lives on the member: another club may have no Kumite. When a member is named captain of a new
  edition of a draft series (the editor, the quick form, `worker/tournaments/team-name.ts`), their new team starts
  with the **name and logo of the team they last captained in an earlier edition of the same series** (by day, then
  the edition made first), unless it's given a name or logo of its own. Never captained in it: blank, the automatic
  "Team <first name>" and initials. Other series neither bring it nor change it.
- Each edition keeps its own team's name and logo (`tournament_teams`), so the history stays per edition: renaming
  during an edition (Name and logo, by the captain or an admin, or in the tournament's editor) changes only that
  edition's team, which is then the last one for next time. The Name and logo sheet says so, and the captains form
  shows what a new captain brings as the name's placeholder ("Brings: Reacher Rounds") and the logo, quiet, until it's
  saved (`lib/brought-team.ts`).
- A brought name another team in that edition goes by, case aside, gives way: its captain has the automatic name and
  initials. Going by it: a team already called it, one bringing it named before, or another captain's automatic name
  ("Team Alex" brought by Bob, beside Alex's own).
- A team the tournament editor sends with neither its id nor a name, an editor that hasn't seen what the server named
  it, keeps its name and, unless it sends one, its logo. An erased member's old teams are never read as theirs.
- Future (#150): in a series teams enter, the team, not its captain, would carry its name from edition to edition.
- Not recorded: like the team's look, it's the captain's own.

### Who sees what

- The server decides, in the `tournaments` slice (`draftSeenBy` in `worker/api/api.slices.ts`). A draft's captains, whoever runs
  it (`run:Draft`) and admins who edit teams (`manage:Tournament`) see everything, live.
- Anyone else, while it's scheduled or open: the captains and no players.
- Once it's closed: the teams with no pick numbers, each team's players in an order that says nothing (a hash of team
  and player, so it's the same each time and nothing moves on a refresh).
- On the tournament's page (ADR [0074](0074-tournament-home-and-scheduling.md)), the Draft open view is the draft for
  its captains and whoever runs it, and once it's done its teams and the pick log, round by round. Anyone else gets a
  card instead, the Kumite's Dux fighting blind ("Fighting blind" and a line from Settings → Quips), before, during
  and after: they see the teams under Teams set. Its jobs are in the page's Manage, the pick log there too for its
  captains and whoever runs it, and a captain's own team (its name and crest).
- Home tells members the draft is on (news, nothing to open) and, once it's closed, that the teams are out, linking to
  the tournament's page at Teams set. Captains and whoever runs the draft keep their Home link to the draft.

### The draft and the fixtures are independent

A draft's captains are its teams, so fixtures can be made before, during or after the draft
([0061](0061-fixtures-games-and-scoring.md)). Neither waits for the other, and a reset leaves the fixtures alone.

## Consequences

- A draft can't be left running by itself or rewritten by a stale editor, and a test draft can be run on the real
  tournament and thrown away.
- A captain who picks and walks away holds the draft until they end their turn; whoever runs it can pick for them.
- With fewer goalies than teams, the last teams go without; the page says so, which is a reason to take one early. A
  team whose goalie drops out gets a replacement through the admin's team edit, once the first has come off.
- Resetting after games are played empties the teams' rosters while their results stand.
- A member picked during the draft doesn't see their team until it closes; reopening hides the teams again.
- Captains' phones see a reset's picks vanish at the next live update ([0072](0072-live-updates.md)); nothing tells
  them why.

## History

- 2026-10-07: The first draft let captains pick from midnight on draft day with no end, and saving the editor
  replaced every team (was 0052).
- 2026-10-07: An admin opens and closes the draft; picks numbered, captains in automatically, teams edited in place,
  closed is final (was 0060).
- 2026-10-07: An admin can reset a draft, taking the picks and the fixtures, refused once a game had a result (was 0064).
- 2026-10-07: Fixtures no longer wait for the draft to close; a closed draft reopens; a reset only takes the picks and
  is allowed after results (was 0066).
- 2026-10-08: One goalie a team, for every way onto a team (was 0067).
- 2026-10-08: Pick then End turn, so a mis-tap isn't sent; teams edited on their own Teams page, not the Draft page
  (was 0068).
- 2026-10-08: The server hides picks from members until the draft closes, then shows teams in no order; the Teams page
  opens to everyone (was 0070).
- 2026-10-21: The pick order is drawn at random on the server as the draft first opens, not the order the captains
  were named in; fixed until a reset; shown without numbers until then, and shuffled into place for whoever's
  watching. The editor's pick numbers and its earlier/later buttons go.
- 2026-10-21: Setting the order is its own step before the draft starts (Set the order, then Start the draft;
  starting without it is refused), and a captain sees their place once it's set. A pick made for a captain records
  who made it (`picked_by`) and says so everywhere, and on the record. Once the draft's on the Draft page gives the
  room to the picking: the order folds away onto the team cards, the admin's buttons go behind Manage, and on a phone
  the players scroll inside the window.
- 2026-10-21: More room on a phone once it's on: no series header, whose pick, who's next and your place in two tight
  lines, the last pick one small line, a shorter ticker, smaller tabs and chips, half the gaps; the players start at
  about a third of the screen. A desktop tightens the lines under the tabs, which don't move.
- 2026-10-21: No last-pick line: the ticker's newest chip is it, lighting up as a pick lands and naming whoever picked
  for a captain; the Next line is labelled, one size and two weights.
- 2026-10-21: The ticker scrolls freely through every pick made and to come (swipe, trackpad, arrow keys), follows
  the picks only while you're at the current one, and shows Now over its edge to bring you back (Home too).
- 2026-10-21: A search on the Players view, as Friday's (a magnifier that widens over the row): by name, with the
  position chips and their counts, kept as typed after a pick; matching players are lit on the Teams view.
- 2026-10-21: A desktop's ticker has a half-seen chevron over each edge (about a ticker's width a click, gone at the
  end; the one on the current pick's side, dotted, leads back to it) and its wheel scrolls it sideways while it can; a
  phone's way back is a small round arrow. A desktop's search is its own row over the chips.
- 2026-10-21: Picks at once ([0121](0121-load-and-concurrency.md)): a pick says its turn, so a stale tap is refused; a
  player saying they're out as they're picked comes off their team with their answer; one goalie a team holds when
  an admin's edit and a pick land together.
- 2026-10-22: The night led a step at a time, one main button each: Shuffle (the players and teams hidden until the
  order's drawn), Open draft (each captain told on their phone, "<tournament> Draft Open", "You pick 2nd"), the
  picking, then Close draft & make fixtures as one request (the close is the claim, so a double tap makes one set;
  fixtures already made are kept). Closed says so, Reopen moves into Manage and keeps the fixtures, and is refused
  once a game has started or has a result. The turn follows the pick numbers, not the count: a pick that came off is
  filled first by its own team (#125).
- 2026-10-22: Reopening asks what becomes of the fixtures: keep them (no match started) or clear them, results and
  all, which is the only way once a match has started, said plainly first; one batch with the reopen. An admin can
  clear them without reopening too (0061).
- 2026-10-22: Each step a card in the middle, themed by the motif (籤, 開, the 決 seal; two characters added to the
  Kumite's font); the draw plays in its card and hands over to the next step, the players and teams coming in after.
- 2026-10-22: The draft's steps back ([0074](0074-tournament-home-and-scheduling.md)): open → the drawn order (the
  picks off, captains told it's paused) and drawn → before the draw, from the Draft page's Manage, for whoever runs
  it; closed → open is Reopen (Back to the draft).
- 2026-10-22: Once everyone's picked, and once it's closed, the page is the teams: no ticker, no Next line, no
  Players/Teams tabs (anyone left out when it closed listed under the teams), and the page itself scrolls, not a box
  in it. Making the fixtures, from the Seal the teams card or the closed page, takes whoever made them on to the
  Fight Card; captains watching stay, with Fight Card on the closed page.
- 2026-10-22: The draft is a status of the tournament's one page (ADR 0074). Anyone who isn't a captain or running it
  fights blind there ("no, they should not see the draft", the user), a card and a quip; the server already kept the
  picks from them. Its Rules join the page's one Rules, its Manage and pick log the page's Manage; done, its captains
  see the teams and the pick log together.
- 2026-10-22: The draft room ("can we create a full page draft mode? It would help to enter/exit this mode and get as
  much space as possible", the user): the draft alone on the screen, for its captains and whoever runs it, entered
  from the draft's strip (lit when your pick's close) or Home, left by ✕, Escape or Back, and by itself when the draft
  closes.
- 2026-10-22: The draft room fills the window ("we have more space we could use in the draft room", the user): on a
  desktop a board under the bar and the picks, the pool down the left (search and chips at its top, bigger rows) and
  every team a column beside it in pick order, each to the window's foot and scrolling inside, the one on the clock
  lifted, each with a row already for every pick still to come, so a pick fills its row and moves nothing. The bar's
  turn says how long till yours ("Team Charlie picking · you in 1"); the Next line goes. A phone keeps the pool and
  the teams a tab apart, filling the height, the teams with their rows to come too.
- 2026-10-22: The teams wrap to the width there is ("we don't need to try to fit them all on one row mate", the user),
  never past the page's edge, each team's badges (its place, yours, No goalie, Picking) on a line under its name so
  a name is never cut; the room's teams wrap into rows sharing the height once a column would be under 14rem. The
  step cards are their title and button ("superfluous", of "Who picks first is drawn at random, for everyone
  watching"): only what stops a step, or that the draft isn't open yet, is said; how it runs is in Rules.
- 2026-10-22: Done (everyone picked, or closed), the draft view for its captains and whoever runs it is two tabs,
  Teams (first) and Pick log, rather than the two stacked; the page scrolls on under them. The header gear's Pick log
  stays, for the draft while it's live and the statuses after it.
- 2026-10-22: A captain carries their team name to the next Kumite ("A team captain usually carries a team name with
  them. If I was in a Kumite and set my team name, I want that to be my default team name next time"), first derived
  from their history; then, as "the admin and player should be able to manage this on their profile" and "just make it
  one field - that changes every time - the default kumite team name or something", one field on the member, on You and
  in the member editor, overwritten by every rename, their history only while it's never been set.
- 2026-10-22: A carried name gives way to any team's name in the Kumite, automatic ones included, and a stale
  tournament editor's re-save neither clears a carried name nor counts as a rename.
- 2026-10-22: The draft's jobs (undo the last pick, add a player, close it early, reset) are rows of the page's gear
  and the draft room's, not a Manage the draft drawer of their own (ADR 0074); closing it once everyone's picked is
  the Seal card's, and reopening a closed one is Back a step.
- 2026-10-22: Simpler ("currently picking should be obvious, in the header"; "I don't like the grey box"; "each team
  should probably just look like a fixed height card", the user): the room's bar says who's picking big, in the
  display face ("TEAM CAL IS PICKING" by its crest, or YOUR PICK in red with its light), then quietly "you're in 9";
  Kumite · Draft room is a small eyebrow by the seal. Every team is the same card (the app's panel), all the same
  height, a row for its captain and each pick it'll have, a pick to come a faint dashed line; packed from the top,
  on the board six to a row on a wide screen (the pool 20 to 26rem, a card 12rem at least), the board's side
  scrolling, never the room. The team picking is lit (the others' crests and names quieter) with the red Picking
  badge, no box round it; the only badges are Picking, No goalie and Your team (the order and In N are the
  carousel's). The same cards on the page's Teams tab and done view.
- 2026-10-22: "The team that is picking needs to be much more obvious", "when they pick a player, that player
  should appear in that list, like it should burn in", "is it possible to do a fire reveal?" (the user): the team
  picking's card is lifted and lit (the carousel's glint across it, a lit top edge, a touch larger, its crest
  glowing in its colour; yours in the club's red), every other card stepped back, the Picking badge's light
  pulsing; the light passes to the next in 300ms. A pick landing burns in on its team (lib/BurnReveal): the row
  under a charcoal sheet that a flame front burns away left to right, a ragged flickering edge and ember rim, a few
  sparks, the name glowing hot and cooling, about 1.2s; the newest pick only, so a catch-up burns the last and the
  rest just appear; the player leaves the pool with a quick fade. Less motion: a 300ms glow, no lift.
- 2026-10-22: Following the draft on a phone ("when I make my pick, switch to Teams and bring that team forward into
  view… when it's my turn, switch me back to the player list"; "the name should burn in, then move to the next one",
  the user; lib/draft-follow.ts): your pick made, the Teams tab slides in, your team in front while it burns in, then
  the team on the clock; each pick burns into its team in front, the cooled name held a second, and only then on to
  the next team (a pick landing meanwhile waits its turn, shown as the row it'll fill); your turn, back to the
  players, with a short buzz. Touch a tab or move the teams and it leaves you be until your next pick or turn;
  Follow the draft picks it up again. The board scrolls the team burning in, else the one picking, into view in its
  own area. A phone's teams list shows the card in front whole at its top, its top and foot fading, never cut ("why
  do we keep cutting off the card at the top!"); the room's bar on a phone says CHARLIE B PICKING, never cut.
- 2026-10-22: The room is where the picking is ("maybe we should make the draft room mandatory, so that the draft
  page shows just who is currently picking. You enter the room explicitly — and can also go full screen", the user).
  The Kumite page's Draft open is a summary (who's picking, big, with their crest, the pick's number, the last pick
  burning in as it lands, and Enter the draft room); the pool, teams and carousel are the room's alone. Home's rows
  for a captain with picks to make, and whoever runs it, go to the room; the Draft Open push to the page. Full screen
  is the room's own button, never automatic; Escape only leaves it, ✕ and Back leave the room. A turn changing is one
  timeline (lib/draft-sequence.ts; "burn in the name, scroll to next team, and then highlight"): the pick burns in,
  a moment held, the carousels glide to the next team together, then the light moves and the bar says so, and on a
  phone your turn brings the players last; picks landing meanwhile wait. The card's glint plays once as the light
  arrives ("just the first time it becomes active"). Your pick has no red outline, glow or fill, only its red Your
  pick badge ("too much red highlight"). On a phone the room opens on Teams (Players if it's your turn), tabs Teams |
  Players; the board (pool beside the team cards) from about 900px wide.
- 2026-10-23: The room on a phone has no tabs ("the workflow between shifting between tabs is awkward"): the teams
  are the page, following the draft as before (each pick burns in, then on to the next team). Your turn brings up
  YOUR PICK, the main button, at the foot of the screen (no jump to the players); it opens the players (search,
  chips, list) in a drawer, the confirm at its foot; confirmed, it shuts and the pick burns into your team. The turn
  passing while it's open for your pick (picked for you, or on your other phone) shuts it and the note says so.
  Anyone else's way to the players is the same button, quiet: PLAYERS and how many are left. The team picking's tag
  is on its name's line ("why does the picking badge have to be on the second row?"): PICKING, YOUR PICK or YOURS in
  the tabs' italic caps, the light and the word the only red, no filled pill; each card keeps the room for its
  widest tag and the name ends in an ellipsis, so nothing moves as the turn goes round (lib/draft-follow.ts).
- 2026-10-23: The room's actions in the Kumite's own hand, and its words say choose, not pick. On your turn the
  floating button reads CHOOSE YOUR CHAMPION (sticker yellow, the same fixed box as PLAYERS, two lines inside it on a
  narrow phone), a red 選 seal pressed on its left and one ring of ink going out as the turn arrives, like a gong, then
  still. Each player's Choose is a small seal-shaped button (the red seal's outline, italic caps); the one chosen has a
  small red 選 beside the name, never a filled row. Confirming is "Are you sure? <name>" (with "for <captain>" when an
  admin chooses for them) and a red hanko button, 決 YES, that stamps down with DraftStep's press and ink specks as the
  choice goes, in the drawer and on a desktop's bar alike. The drawer has 組手 faint behind its header; Follow the
  draft, Players, Change and Manage are the italic caps with the red slash, no grey pills. The room's bar: the live
  light sits on the eyebrow's line (red, softly pulsing, while the stream's open; grey with how often it checks
  otherwise), and whose turn is one fixed box: a crest or, yours, the 選 seal, then YOUR CHOICE in red italic caps;
  nothing once everyone's chosen. The last choice made with the room watching gets a finale: it burns in like any
  other, the light leaves the team, each team's edge lights in turn and "The teams are chosen" rises where the button
  was, then the Seal the teams card rises in with its 決 fading up last (about 2s after the burn; less motion, a
  crossfade). A room 1100px or wider has the choices as a column of their own (the newest first, burning in as it
  lands, the snake's rounds as quiet breaks, an admin's choice marked "Dan's choice"): on the board beside the pool
  and the teams (two to a row, every card one height), and once everyone's chosen as the last third beside the teams'
  two thirds; narrower, the Teams and Choices tabs as before. The room scrolls once everyone's chosen (the guard that
  keeps it from moving sideways had been resetting it). 選 added to the kanji subset.
- 2026-10-23: The captain's team name no longer lives on the member (`members.kumite_team_name`, on You and in the
  member editor, gone): "Kumite-specific data must not live on the member", since another club may not have a Kumite.
  In a draft series it's worked out from the last edition the captain captained in ("once I set my team name, if I get
  chosen as captain again, that would be my team name again unless I change it"), name and logo, with no separate
  copy, and for any draft series, not only the Kumite. Team-entry series, where the team carries it, are #150.
- 2026-10-23: Once the draft is open, a save must keep the same captains, in any order: an editor opened before the
  draw sends them as it saw them, and the order is the draw's (each team's pick), never the save's. It refused a save
  whose order differed from the draw's, so an editor opened at sign-up failed to save half the time after the draw.
