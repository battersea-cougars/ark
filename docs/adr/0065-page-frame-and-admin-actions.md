# 0065. One page frame; admin actions live on the thing's own page, in a drawer, sheet or panel chosen by what's in it

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-24
- **Merges:** 0078, 0103

## Context

An admin's jobs were reached through Settings: to add a Kumite date or its captains you went to Settings →
Tournaments, found the card and opened its editor, then went back to the tournament to run the draft. That's how the
data is organised, not how an admin works. They are on the tournament's page when they think "next date" or "who
captains", and the trip through Settings made the app feel harder than it is.

The team app's pages also came in two widths on a desktop: `.page`, a column centred at about 60% of the window, and
`.page.wide` (76rem), centred too. Going between them on the dock moved the title 176px sideways at 1440px, and titles
sat at three heights (pages with an eyebrow pushed theirs down; Home had its own taller header). Editor panels
(EditorPanel, MemberSheet) were 60rem, centred beside the dock: never the width of the cards they opened from.

Things open over the page in three ways: a side drawer (`lib/Drawer`), a sheet (`lib/Sheet`) and an editor panel
(`lib/EditorPanel`). A survey on 2026-10-09 found 16 drawers, 12 sheets and 4 editor panels, mostly well chosen but
not always: short fixed forms in drawers while the same kind elsewhere was a sheet, a one-to-four-row menu full
screen on a phone, one-row Manage menus in a mostly empty full-height drawer. A drawer is tall and narrow, so it suits
a list and wastes space on two fields, and it leaves the page in view, which is only worth it if you need the page.

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

**Which overlay: drawer, sheet or panel**

- **On a phone, one overlay: the bottom sheet.** Whatever opens over the page comes up from the bottom the same way,
  with the same handle, header, close button and footer, and goes back down the same way: the close button, a tap on
  the dimmed page, Escape, Android's back, or pulling the handle down. A short job is sized to what's in it; something
  that grows (a list, the register, an editor) is the same sheet but tall, near the top of the screen, a fixed height,
  scrolling inside under a header and footer that stay put. `lib/Drawer` and `lib/EditorPanel` are drawn as
  `lib/Sheet` (`tall`) on a phone, decided as they open, so callers choose by what's inside and never by the screen.
- **On a desktop, pick by what's inside:**

| What it holds                                                                                       | Use                                       | Phone                                | Desktop                                  |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------ | ---------------------------------------- |
| A list that grows: ticking, searching or picking people or things (register, squad, awards, import) | **Side drawer**                           | tall bottom sheet                    | right, 26rem, the page visible beside it |
| Something read beside the page (the draft's rules, the pick log)                                    | **Side drawer**                           | tall bottom sheet                    | right                                    |
| A short form that never grows (about five fields at most) or a one-tap choice                       | **Sheet**                                 | bottom sheet                         | centred                                  |
| A menu of jobs (Manage, Scoring's tools)                                                            | **Sheet on a phone, drawer on a desktop** | bottom sheet                         | right drawer                             |
| A thing's whole editor: tabs, many fields, Save and Discard                                         | **Editor panel**                          | tall bottom sheet                    | the page's column                        |
| A value inside a form (a time, a role, a date)                                                      | **Pop-over** (Select, DateField)          | admin forms only; members get Choice | —                                        |

- **A menu of jobs:** each row is an icon, a label and one line saying what it does (that line is why a menu is a
  drawer on a desktop rather than a drop-down). A menu with only one job isn't a menu: in the gear's place goes that
  job's own button (a Session lead before the teams are made has only Add player), or the gear opens it directly when
  the job is the settings; the exception is a job you'd not want done by a stray tap (Hand over), whose sheet stays as
  the second step. A row closes the menu before its job opens, and the job opens in the same kind of layer as the
  menu, never a drawer and then a sheet: a job that belongs in a sheet is reached from the thing itself on the page
  (tap the clock to set the time), and a menu row either does its job there and then (Take back last goal) or opens a
  drawer or panel.
- **Stacking:** one overlay at a time, except a pop-over inside a form and a short sheet opened from an editor panel
  (a member's Charge, Adjust and Record a payment), which stacks on top as its own modal dialog. Pop-overs and a
  player's card are moved to `<body>` (`lib/portal.ts`), out of the page's stacking context. Escape closes the top
  layer only. Overlays don't touch the history: iOS's back swipe still goes back a page.
- **A sheet's or drawer's main action sits in its footer**, not at the end of the body, so it's always in reach.

**One drawer, one sheet, one close contract**

- **One side drawer for the app: `lib/Drawer`** (desktop and tablet, from the right; 26rem, or `wide` 36rem). An editor
  (`lib/EditorPanel`) is the same drawer in its `page` placement, in the page's column (below). On a phone each is
  the one bottom sheet, `lib/Sheet` (above), unless it's `side` (the draft room's players, worked beside the page:
  from the right on a phone too, leaving a strip of page to tap off on). Same header everywhere: the title, an
  optional line under it, the ×.
- **They keep one close contract (`lib/overlay.ts`)**: a native modal dialog, so focus stays in it and goes back to
  what opened it, the page under it is inert and doesn't scroll (a desktop's scrollbar keeps its room, so nothing
  moves), and Escape closes the top one only. A click on the dimmed page closes it only when it was pressed and let
  go there: a drag that starts inside (selecting a field's text) and ends outside doesn't. Every way out (×, Escape,
  the backdrop, a swipe, a phone's back) goes through one `requestClose`, which a form's unsaved changes can hold.
- Not drawers: a player's card (`MemberSheet`, `PlayerCardZoom`) turns over into its panel; it keeps its own layer,
  with the same unsaved-changes footer.

**Save forms say where they stand**

- **Every Save form shows unsaved and saved the same way** (`lib/SaveBar` in its footer, `lib/dirty.svelte.ts`): it
  compares what's on screen with what it loaded (typing back to the original is clean again). Unsaved: a small dot
  and "Unsaved changes" beside Save, and Save is the main button; clean, Save is quiet and off and the footer says
  "No changes", or "Saved ✓ · just now" (then the time) once saved, in place, the line's room always kept. A failed
  save stays unsaved and says what went wrong there. A new one can be saved from the start.
- **Leaving with unsaved changes asks first**, in the footer: "Discard your changes?", Keep editing or Discard (the
  one red fill). Closing the overlay any way, or going to another page in the app (a link, Back, a phone's swipe
  back), asks; closing the tab gets the browser's own question (`beforeunload`).
- **An overlay's save state has one owner at a time**: the form showing in it, which loads its values and their
  baseline together (`lib/dirty.svelte.ts`), on opening and on saving; which form that is stays out of reactive state
  (`lib/dirty.ts` `FormOwner`), so a form giving way to another in the same panel can't clear the new one's footer.
- A short sheet that closes once saved (the bank details, a venue, an event, a team's look) shows unsaved changes and
  asks the same way; its "Saved" is the shell's note as it closes. Taps that save at once (switches, sign-ups,
  notification topics) have nothing unsaved, so no footer.

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
- **Settings is one page**, on a phone and a desktop, listing every admin area in the order an admin needs it,
  everyday jobs first and each section's most used page first: **Club** (Members, Unpaid fees, Membership, Roles),
  **Schedule** (Training, Tournaments, Tournament Series, Venues), **Content** (Quips, Upload), **System** (View as a
  member, Audit log, Usage, Errors, Email, Dev tools), with the everyday-role switch at its top. The order lives in one place
  (`SECTIONS` and the routes' order in `nav-routes.ts`; `settings-list.test.ts` pins it). The gear shows in your
  everyday role too and switches you up. A page every member can read but only some set up names what lists it in
  Settings (`manage`). On a phone, Back from a settings page goes to Settings, and Back from Settings to where you
  came from.
- **The desktop rail is member pages only**: Home, the trainings, Calendar, the tournament types and the club
  (`/club`), then the gear for whoever can set something up. Past announcements are Home's page (`/announcements`,
  [0107](0107-announcements.md)).
- A page under its section's front page says its way back once: on a phone the app bar's ‹, so the header's eyebrow
  button shows on a desktop only.
- On a phone a training's usual day, hours and place are on its session card (a page whose list has a sticky header
  can't have a foot); a desktop keeps them under the title. A training's Manage has Cancel this night (a confirm
  sheet saying who hears it) and It's back on, the same words as a one-off's.
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
  (`TournamentQuickCreate`, [0128](0128-scheduling-a-tournament.md)).
- The Calendar is where an admin puts any date on: its **New event** button (in words on a phone too) opens one
  sheet asking what kind (a one-off, a training, a series' next date, a tournament), only the kinds their full role
  can create (`lib/new-event.ts`), each in the editor Settings uses (`TrainingEditorPanel`, `TournamentEditorPanel`),
  over the Calendar; with one kind there's no question. In their everyday role it still shows and switches them up as
  they pick, as the gear does.
- Admin flows still in Settings (training dates, fees) should move the same way as they're touched.
- Nothing moves sideways or up and down when you go between pages, and a panel reads as the card grown.
- On a very wide window a reading page sits left of centre with room on its right. That's the cost of one edge.
- A new page gets `class="page"`, or `page full` if it really needs the width.
- On a desktop a sheet hides the page and a drawer doesn't, so a phone/desktop switch changes more than the shape.
  That's fine for a menu, which you leave as soon as you choose, but not for anything you'd want the page beside.
- A page's column width (`.page:not(.full) > *`) leaves out a `<dialog>`: a sheet declared in the page sizes itself.

## History

- 2026-10-07: Admin actions moved from Settings onto the thing's own page, opening over it; Settings kept for setting
  up, with the same editors (was 0065).
- 2026-10-08: One page frame on a desktop (76rem, a 52rem reading width, `.page.full`), every title at one height,
  editors in the page's column (was 0078).
- 2026-10-09: A main button beside Manage when the page is waiting for it; Manage keeps only what has no page of its
  own (was 0087, now in 0127 and 0128).
- 2026-10-09: Which overlay for what, from a survey of every one: drawer, sheet or panel by what's inside; drawers
  moved to `<body>`; a pop-over's Escape leaves the drawer under it open (was 0103).
- 2026-10-10: On a phone the bar hides on scrolling down and comes back on scrolling up (#83); a page's search stays
  in the page.
- 2026-10-10: A one-list page fits the window and its list scrolls inside (`.page.fit`, `.scroll-fill`); lists are
  glass.
- 2026-10-10: A long list under a header has one scroller, the page, driving a window on its rows
  (`lib/list-scroll.ts`), Friday's and Unpaid fees'; the phone bar hides there too.
- 2026-10-10: Tables share Roles' look and Friday's search; square corners, no outer edge, soft lines; frosted
  fields; a dark tint under the glass on touch phones.
- 2026-10-20: Make teams stays as Remake teams, with Clear teams beside it (ADR 0076).
- 2026-10-20: On a phone a training's usual day, hours and place are on its session card.
- 2026-10-20: Next Kumite sits in the series page's "No Kumite yet" when nothing's on (ADR 0074).
- 2026-10-20: One overlay on a phone: every sheet, drawer and editor panel is a bottom sheet there, with a handle to
  pull down; the desktop split stays (#82, was 0103).
- 2026-10-20: The Calendar's New event puts on any kind of date from one sheet, in Settings' own editors.
- 2026-10-20: You + one gear: the gear opens one Settings page listing every admin area; the desktop rail is member
  pages only.
- 2026-10-21: On a desktop the gear sits at the foot of the rail; the top right keeps only your avatar.
- 2026-10-21: Past announcements leave Settings for Home's page ([0107](0107-announcements.md)); Teammates is the
  club (`/club`).
- 2026-10-21: Settings in the order an admin needs it: Club, Schedule, Content, System, kept in one place
  (`nav-routes.ts`, pinned by `settings-list.test.ts`).
- 2026-10-23: One side drawer and one bottom sheet with one close contract (`lib/overlay.ts`); the editor panel is
  the drawer's `page` placement.
- 2026-10-23: Save forms show unsaved and saved in one footer (`lib/SaveBar`), and leaving unsaved asks first.
- 2026-10-23: A training's Manage has Cancel this night and It's back on.
- 2026-10-23: A page under its section's front page says its way back once (the phone bar's ‹).
- 2026-10-23: An overlay's save state has one owner at a time, kept out of reactive state (`FormOwner`).
- 2026-10-24: ADR 0103 (drawers, sheets and panels) merged in; its stale lines dropped (drawers are native dialogs
  now, the account menu is gone, its to-do list is done).
