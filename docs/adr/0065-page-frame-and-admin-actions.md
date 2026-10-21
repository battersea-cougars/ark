# 0065. One page frame; admin actions live on the thing's own page, not under Settings

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-20
- **Merges:** 0078

## Context

An admin's jobs were reached through Settings: to add a Kumite date or its captains you went to Settings →
Tournaments, found the card and opened its editor, then went back to the tournament to run the draft. That's how the
data is organised, not how an admin works. They are on the tournament's page when they think "next date" or "who
captains", and the trip through Settings made the app feel harder than it is.

The team app's pages also came in two widths on a desktop: `.page`, a column centred at about 60% of the window, and
`.page.wide` (76rem), centred too. Going between them on the dock moved the title 176px sideways at 1440px, and titles
sat at three heights (pages with an eyebrow pushed theirs down; Home had its own taller header). Editor panels
(EditorPanel, MemberSheet) were 60rem, centred beside the dock: never the width of the cards they opened from.

## Decision

**Admin actions where the thing is**

- **An admin acts on a thing from the thing's own page.** Its page carries the actions the admin's role allows (Next
  Kumite, the settings, Add the captains, Add member, Reset), and they open over the page: a sheet, drawer or editor
  panel, never a navigation to Settings.
- **Admin jobs sit behind one quiet Manage button** in the page's header bar: a bottom sheet on a phone, a side drawer
  on a desktop. The menu holds only what has no page of its own; something with its own tab (running the draft,
  making the fixtures) is done there, not from the menu.
- **One main button may sit beside Manage** when it's the job the page is waiting for: Next Kumite on a series page
  when nothing's coming up (in the page's own "No Kumite yet", [0074](0074-tournament-home-and-scheduling.md)), Make
  teams on a training for whoever makes the teams ([0076](0076-training-teams.md)). Once that job is done it goes, and
  the rest stays in Manage. (Make teams stays as Remake teams, with Clear teams beside it, since the team maker's night
  is making and remaking them.)
- **Settings is for setting up, not for running.** It keeps the full list (every tournament, every series, the members
  table) and configuration nothing else owns (roles, fees, venues), and its editors are the same components the pages
  open, so there's one editor per thing.
- Members see the same pages without the admin actions; nothing about the page changes shape for them.
- New features are designed from the page out: where is the admin when they need this? Put it there first.

**One page frame**

- On a desktop every page is the same frame (`--page-max`, 76rem) and its content keeps a reading width (52rem) from
  the frame's left edge. A page that needs the room (the Draft, the club, Settings → Tournaments) is `.page.full` and
  uses the whole frame. A page that is one big table (Settings → Members) is `.page.fill`
  ([0069](0069-members.md)). Nothing is centred on its own.
- Every title is at the same height: PageHeader keeps the eyebrow's line on a desktop even when there's none, and
  Home's own header matches it.
- An editor panel opens in the page's column: the same left edge and width as the content under it
  (`lib/page-column.ts`), the reading width or the whole frame for a `.full` page. Phones are unchanged: full screen.
- Settings keeps its list beside the dock, so its pages share their own left edge, all of them.
- **One way into Settings: the gear**, at the foot of a desktop's dock (below the member pages, set apart by space,
  lit on Settings and its pages) and top right in a phone's You bar (its own icon: a chunky cog with a puck). A
  desktop's top right is just your avatar, opening You.
- On a phone the slim bar slides up out of sight as you scroll down and comes back the moment you scroll up or reach
  the top (#83). A transform over the page, so nothing moves; the bottom tabs stay; not while a sheet is open. A
  page's search stays in the page and scrolls with it. Every page, Friday's too: what sticks under the bar (its
  table's header) follows it up into its room (the shell's `bar-tucked`, `--bar-h`), and the bar's empty room never
  takes a tap.
- **A page whose subject is one list is `.page.fit`**: the window's height, in the usual frame. The list
  (`.scroll-fill`) is as tall as its rows, up to the height left, and scrolls inside; its tabs and search sit above
  it and never move. Nothing pins, so a search or filter that shortens the list moves nothing else (a pinned header
  over a page-scrolling list unpinned whenever a filter shortened the page). Lists are glass (`fg` at 3%, the
  chrome's blur, square corners: `--r-table`, no outer edge, soft lines under the header and between rows, edge to
  edge: `--rule`), not solid panels. Members' grid (`lib/DataGrid.svelte`) follows the same rules, its header a
  frosted band as rows scroll under it. Text inputs and selects are the same glass (`--field-bg`). Quarterly rate so far.
- **A long list under a header (Friday's Who's coming, Unpaid fees, Roles, Tournaments) has one scroller, the page, and the list's box is a window
  on the rows.** The page scrolls until the list's tabs and search reach the top, where they stay as the table's own header row (inside its glass edge, transparent), with
  the box under them exactly the height left; then the page scrolls on, by the height of the rows that don't fit (a
  spacer), and the box scrolls its rows by the same amount (`lib/list-scroll.ts`). A wheel anywhere on the page, or
  one swipe, does the lot; the page scrolls the same however short a tab or a search makes the list, so the tabs never
  let go. Tried and dropped: tabs that pinned only once stuck (restyled, and a filter unpinned them); a bar the rows
  pass under (it needs a solid or blurred band, which read as a black bar); the list as a second scroller (a wheel
  had to be over it, and on touch a swipe stays with the box it began in). The styles are `.hybrid` in app.css; a
  table without tabs has its row of column names as its header.
- **Tables look like Roles'**: a header row of column names (small caps, muted), rows on the same columns, a
  hairline between, a faint fill under the pointer (`.table-head`, `.table-row`, columns from `--cols`; a phone drops
  the columns it can spare). A long one searches the way Friday does: a magnifier at the end of its header row that
  widens leftwards into the field, over the headings, and rows that sift as you type. Short lists (Quarterly rate,
  Venues) get the columns but no search.

## Consequences

- The tournament pages open the tournament editor in place (`TournamentEditorPanel`), on the tab the action needs;
  Settings → Tournaments uses the same panel. A new date in a series opens on its quick questions
  (`TournamentQuickCreate`, [0074](0074-tournament-home-and-scheduling.md)).
- The Calendar is where an admin puts any date on: its **New event** button (in words on a phone too) opens one
  sheet asking what kind (a one-off, a training, a series' next date, a tournament), only the kinds their full role
  can create (`lib/new-event.ts`), each in the editor Settings uses (`TrainingEditorPanel`, `TournamentEditorPanel`),
  over the Calendar; with one kind there's no question. In their everyday role it still shows and switches them up as
  they pick, as the gear does.
- Admin flows still in Settings (training dates, fees) should move the same way as they're touched.
- Nothing moves sideways or up and down when you go between pages, and a panel reads as the card grown.
- On a very wide window a reading page sits left of centre with room on its right. That's the cost of one edge.
- A new page gets `class="page"`, or `page full` if it really needs the width.

## History

- 2026-10-07: Admin actions moved from Settings onto the thing's own page, opening over it; Settings kept for setting
  up, with the same editors (was 0065).
- 2026-10-08: One page frame on a desktop: 76rem, a 52rem reading width from its left edge, `.page.full` for pages that
  need the room, every title at the same height, editors in the page's column; `wide` and `wide reading` went
  (was 0078).
- 2026-10-09: A main button beside Manage, not only an item in the menu, when the page is waiting for it (Next Kumite
  when nothing's scheduled); the Manage menu keeps only what has no page of its own (was 0087, now in 0074).
- 2026-10-10: On a phone the bar hides on scrolling down and returns on scrolling up (#83); a page's search stays
  in the page (pinned under the bar, it read as a black band).
- 2026-10-10: A page whose subject is one list fits the window and the list scrolls inside (`.page.fit`,
  `.scroll-fill`); lists are glass. Replaces a pinned list header, which unpinned whenever a filter shortened the
  page.
- 2026-10-10: A long list under a header (Friday's Who's coming): one scroller, the page; the list's box, stuck
  under its tabs and the height left, is a window the page's scroll drives through the rows. Replaces sticky tabs
  over rows passing under them.
- 2026-10-10: The phone bar hides on Friday's page too (it had been held there): the table's header follows it up,
  its box growing as the space under it shrinks, so the page's length doesn't change; the shell's empty top room
  lets taps through to the stuck tabs and search. A scroll that comes with a new page length (a tab or a search
  shortening the list) isn't you scrolling, so it leaves the bar hidden, and the table settles at the top.
- 2026-10-10: Unpaid fees scrolls like Friday's Who's coming (the totals go by, then the table's header sticks and
  the page drives its rows), not as a fitted page; Export CSV moves to the page's actions. The `.hybrid` styles
  moved from the Training page to app.css to be shared.
- 2026-10-10: Tables share Roles' look (`.table-head`, `.table-row`); Roles, Unpaid fees and Tournaments become stuck
  tables with Friday's search at the end of the header row; Quarterly rate and Venues get column names.
- 2026-10-10: Tables and lists try square corners (`--r-table: 0`). Friday's table now frosts like Roles': its
  fade-in (`.rise`) held on after it ended, which kept it a see-through layer the blur couldn't see past.
- 2026-10-10: Tables lose their outer edge and their lines go soft (`--rule`, edge to edge, so a hover meets them);
  Members' grid takes the tables' look; text inputs and selects become frosted glass to match.
- 2026-10-10: On a touch phone the glass carries a dark tint under its fill (`--glass-tint`), which mutes the page as
  frost would: Android reports the blur but often doesn't draw it.
- 2026-10-20: Make teams stays once the teams are out, as Remake teams with Clear teams beside it, and on a phone sits
  in a bar above the tabs rather than the page's bar (ADR 0076).
- 2026-10-20: On a phone a training's usual day, hours and place sit at the foot of its page, not behind an info
  button in the bar (a desktop keeps them under the title). Revised the same day: a page whose list has a sticky
  header can't have a foot (the rows scroll to the end under the header, over the team maker's bar), so on a phone
  the session card carries them instead: the place with its map link and how often it's on, under its title, beside
  this week's hours.
- 2026-10-20: Next Kumite sits in the series page's "No Kumite yet", not the header, when nothing's on (ADR 0074).
- 2026-10-20: Settings is reached by one gear, top right on a desktop (beside the badge) and on a phone's You page,
  instead of the dock's tile and the phone's sheet; it shows in your everyday role too and switches you up.
- 2026-10-20: The Calendar's New event puts on any kind of date (one-off, training, a series' next date, a
  tournament) from one sheet, in Settings' own editors, closing on the calendar once saved; it shows in your everyday
  role and switches you up on the way. It answered "I'm the admin, on my phone: where do I create an event?", which
  had been an unlabelled + for one-offs only.
- 2026-10-20: You + one gear, superseding the gear lines above. The gear, top right on a phone's You page and beside
  a desktop's avatar, opens one Settings page on both, listing every admin area grouped Club (Members, Unpaid fees,
  Announcements, Quips, Upload), Schedule, Money and Security, with the everyday-role switch at its top; a desktop
  keeps the list beside the dock on a settings page, its title back to Settings. The desktop rail is member pages
  only (Home, trainings, Calendar, tournament types, Teammates): Dues, Announcements and Upload leave it, and More is
  gone. A page every member can read but only some set up names what lists it in Settings (`manage`: Announcements,
  by `post:Announcement`). On a phone, Back from a settings page goes to Settings, and Back from Settings to where you
  came from. "We show the gear icon and also a bunch of links and a profile button".
- 2026-10-21: On a desktop the gear joins the rail, at its foot below the member pages, set apart by space, for
  whoever can set something up; the top-right corner keeps only your avatar (You isn't in the rail). Phones are
  unchanged. "On desktop, the admin button should be in the nav rail."
- 2026-10-21: Past announcements leave Settings: they're Home's page (`/announcements`), for everyone, so the rail
  lights Home there and no Settings list shows ([0107](0107-announcements.md)). The rail is Home, the trainings,
  Calendar, the tournament types and the club (`/club`, which was Teammates), then the gear.
- 2026-10-21: Money folds into Club: its one page (the quarterly rate) sits under Club after Unpaid fees, and the
  Money heading goes. Settings is grouped Club, Schedule and Security. "The money section can be combined with Club."
- 2026-10-21: Settings in the order an admin needs it, everyday jobs first, set-up-once last, each section's most used
  page first: **Club** (Members, Unpaid fees, Membership, Roles), **Schedule** (Training, Tournaments, Tournament
  Series, Venues), **Content** (Quips, Upload), **System** (View as a member, Audit log, Usage, Dev tools). Roles
  joins the club's people; Quips and Upload leave Club for Content; Security is System, as it holds the app's own
  pages. The order lives in one place (`SECTIONS` and the routes' order in `nav-routes.ts`), so the phone's Settings
  page and a desktop's settings list agree; `settings-list.test.ts` pins it. "Make sure the order of all the admin
  pages makes sense."
