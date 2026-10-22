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

### Who sees what

- The server decides, in the `tournaments` slice (`draftSeenBy` in `worker/api/api.slices.ts`). A draft's captains, whoever runs
  it (`run:Draft`) and admins who edit teams (`manage:Tournament`) see everything, live.
- Anyone else, while it's scheduled or open: the captains and no players.
- Once it's closed: the teams with no pick numbers, each team's players in an order that says nothing (a hash of team
  and player, so it's the same each time and nothing moves on a refresh).
- Home tells members the draft is on (news, nothing to open) and, once it's closed, that the teams are out, linking to
  the Teams page. Captains and whoever runs the draft keep their Home link to the Draft page.

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
