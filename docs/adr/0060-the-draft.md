# 0060. A captains' draft is run by an admin, picked by its captains, and seen by members once it's closed

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-21
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
- **Two steps: set the order, then start the draft.** The pick order is never the order the captains were named in,
  which means nothing: being named first mustn't mean picking first. Before it opens, whoever runs the draft taps
  **Set the order** (`POST …/draft/draw`, `run:Draft`): the server draws it, a Fisher-Yates shuffle on
  `crypto.getRandomValues`, and stores it as `tournament_teams.pick` (1 = first). Each number is set only while some
  captain is still without one, in one batch, so a second admin's tap a moment later changes nothing. Then **Start the
  draft** (`…/draft/open`) opens it; opening with no order set is refused (409, "Set the order first."). The order is
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
- **A closed draft reopens**, keeping its picks: the captain on the clock is whoever's next, as if it had never
  closed. Adding a player to a closed draft is refused (409): reopen it first.
- **Reset** (`run:Draft`, open or closed) takes every pick off and sets `draft_state` back to none. Sign-ups, captains
  (and admin-added players, who are sign-ups) and the fixtures stay. It's allowed after games have results; the app
  asks first, since it can't be undone.
- The draft night is on the agenda for its captains and whoever runs the draft until it's closed
  ([0042](0042-website-reads-the-club-agenda.md)); a reset puts it back.

### Picking

- Picks only while it's open, in snake order, from members who said they're in. **Captains are in automatically**, on
  their own team, never in the pool, and can't withdraw themselves.
- Each pick has a `pick_number` (`tournament_team_players`): turn order and Undo (the last pick) follow it.
- **Picking is two steps.** Pick marks a player on your screen (tap another to change your mind); **End turn** sends
  it. The server is unchanged: a pick is one request. Whoever runs the draft picks for the captain on the clock the
  same way. Picking out of turn, or someone no longer in the pool, is a 409.
- **A pick made for a captain says so.** Each pick records who made it (`tournament_team_players.picked_by`). When
  that isn't the team's captain, the app says it as theirs, for that team: "Dana picked Reg for Team Cara" on the
  last-pick line, "Dana took Reg" on the ticker, "Dana for Team Cara" in the pick log, "Dana's pick" on the team card,
  and before the pick "Picking for Team Cara" and "Pick for Cara". The record gets `draft.picked_for`, naming the
  player, the captain and who picked; a captain's own pick stays off it (it's the draft's own record). Members who
  see the teams once it's closed get no pick numbers and no pickers.
- **One goalie a team** (`members.position = 'G'`), counting its captain, however someone gets onto a team: a
  captain's pick, a pick by whoever runs it, or an admin's team edit. A second is refused: "They've got a goalie
  already." Teams that enter whole (`kind: "teams"`) bring their own side. The Draft page has goalies as their own
  filter, shows each team's D/F/G count, and drops Pick from a goalie's row once your team has one.
- Withdrawing while the draft is open takes the pick off their team; once it's closed, or for a captain, it goes
  through an admin.

### Where it's edited

- The Draft page is for picking and running the draft. It shows the teams but doesn't edit them. Before it starts
  it shows the captains and the order (and, for whoever runs it, Set the order, then Start the draft). Once it's on,
  the page is the draft: the order folds away (each team card shows its place, "1st"), the most room goes to the
  players left, and what isn't picking is small or behind a tap. One line says whose pick it is, one under it who's
  next and a captain's own place ("You pick 2nd"), one the last pick. Rules, the pick log and **Manage** (Undo, Add
  player, Close, Reset: a bottom sheet on a phone, a side drawer on a desktop, asking there before closing with
  players left or a reset) are icons on that first line. On a phone the series' header goes altogether (the page's
  tabs say where you are), the last pick is one small line ("Last: Dana picked Reg for Team Cara"), the ticker stays,
  shorter, the tabs and chips are a size smaller, and the players scroll inside the window's height (`.page.fit`),
  starting about a third of the way down. A closed draft keeps Reopen and Make the fixtures on the page.
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
