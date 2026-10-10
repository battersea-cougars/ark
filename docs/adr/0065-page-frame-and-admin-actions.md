# 0065. One page frame; admin actions live on the thing's own page, not under Settings

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-10
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
  when nothing's coming up ([0074](0074-tournament-home-and-scheduling.md)), Make teams on a training for whoever makes
  the teams ([0076](0076-training-teams.md)). Once that job is done it goes, and the rest stays in Manage.
- **Settings is for setting up, not for running.** It keeps the full list (every tournament, every series, the members
  table) and configuration nothing else owns (roles, fees, venues), and its editors are the same components the pages
  open, so there's one editor per thing.
- Members see the same pages without the admin actions; nothing about the page changes shape for them.
- New features are designed from the page out: where is the admin when they need this? Put it there first.

**One page frame**

- On a desktop every page is the same frame (`--page-max`, 76rem) and its content keeps a reading width (52rem) from
  the frame's left edge. A page that needs the room (the Draft, Teammates, Settings → Tournaments) is `.page.full` and
  uses the whole frame. A page that is one big table (Settings → Members) is `.page.fill`
  ([0069](0069-members.md)). Nothing is centred on its own.
- Every title is at the same height: PageHeader keeps the eyebrow's line on a desktop even when there's none, and
  Home's own header matches it.
- An editor panel opens in the page's column: the same left edge and width as the content under it
  (`lib/page-column.ts`), the reading width or the whole frame for a `.full` page. Phones are unchanged: full screen.
- Settings keeps its list beside the dock, so its pages share their own left edge, all of them.
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
