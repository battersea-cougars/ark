# 0030. The schedule lives in D1: training repeats as a series, tournaments are scheduled one by one and own their rules

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-20
- **Merges:** 0025, 0046, 0048, 0049, 0051, 0052

## Context

The team app needs a calendar members sign up to, and sign-ups, the register, teams and charges all live in D1.
Keeping dates in Sanity would mean two sources kept in step and a rebuild before a change shows on the website.

What's on doesn't fit one generic "event":

- **Training repeats.** Friday is a session every week, and the club may add others (a Sunday skills session).
  Sign-ups, the register, teams and charges belong to one session, but most of what describes it (time, place,
  places) is the same every week.
- **Tournaments don't repeat on a rule.** The Cougars Kumite happens a few times a year on dates chosen each time,
  often planned months ahead ("next summer") before anyone knows the day. Editions share a format and rules but each
  has its own name, place and date, and one edition may play differently. The club also runs one-offs that belong
  to nothing.
- **Tournaments make teams two ways.** In a normal tournament teams enter, some from outside the club, with a captain
  we may only know by name. In the Kumite members sign up and captains draft them. Either way the club wants to know
  the teams.
- **Places repeat.** The sports centre was typed on every series, and its map link was a search for the name, which
  could find the wrong place. A social at a pub the club goes to once shouldn't need a saved place to have a map.

Gwenda ops solves the first with series and nights: the series holds a rule and the defaults, each night is its own
row that inherits what it doesn't override, and a night is moved or dropped on its own.

## Decision

The schedule lives in D1, edited only in the team app. Tables are in the
[team-app data model](../team-app-data-model.md) and `db/schema.sql`.

### Three sources, one calendar

- **`training_series` → `training_sessions`.** A series has a rule (every N weeks on chosen weekdays, from a first
  date to an optional last one) and the session defaults (start, end, place, places). Sessions are rows, made 12
  weeks ahead by a daily Cron Trigger (`apps/team/worker/training/training.ts`). A session's own columns are null unless it
  differs ("this week we're at the other rink"). Cancelling keeps the row, so whoever signed up can be told; moving
  keeps the rule's original date (`moved_from`) so it isn't made again. Changing the rule removes future sessions it
  no longer makes, unless someone has signed up or an admin changed them.
- **`tournament_types` → `tournaments`.** A type is a **tournament series** (The Cougars Kumite): its name, look,
  menu section and the defaults its tournaments start with. A tournament is one edition. Its series is optional
  (`tournaments.type_id` may be null).
- **`club_events`** for anything else: a social, a kit day.
- Each series and type has an **icon and a colour** (`icon`, `tone`), chosen by an admin, so calendar entries are
  told apart and can be filtered. A tournament on its own shows as a trophy in the club's red.
- Sign-ups (`attendance`, `tournament_entries`, `club_event_entries`), teams and charges point at a session, a
  tournament or an event, never a generic event.
- What's on and when is pushed from all three into one agenda, which the website and the app's calendar read live
  (ADR [0042](0042-website-reads-the-club-agenda.md)).

### The app is built from this data

Each active training series gets its own page and menu link; each active tournament series gets a folding menu
section (Games, Standings, and Draft if it drafts). Admins manage them under Settings → Schedule: Training,
Tournaments (the schedule, a card per tournament), Tournament Series (the series and their defaults) and Venues
(`manage:Training`, `manage:Tournament`, `manage:Venue`). A new one appears straight away.

### A training's sign-ups: Quarterly Members first

- **A training's list is one order**: Quarterly Members (a subscription covering the session's day,
  ADR [0007](0007-dues-and-payments.md)) above everyone paying as they go, first come first served within each. The
  first places in that order are in; the rest wait (`aheadIn` in `worker/entries/entries.ts`).
- So a Quarterly Member signing up for a full session **takes the place of the last one in who pays as they go**, who
  waits at the top of their queue (their sign-up time is kept, so their place in the order holds). Only when every
  place is a Quarterly Member's does one wait, still above those paying as they go. When a place comes free the
  first waiting in that order moves up. A limit raised (or taken away) is places coming free: as many of the first
  waiting move up as it makes room for, in the batch that saves it, before anyone else can sign up into it
  (`fillingUp`). A walk-in isn't moved.
- **A training's nights can open for sign-up on a day** (`training_series.signup_opens_days`, set in the training's
  editor beside its times): that many days before the night, at midnight London time (Friday Training: 4, the
  Monday). Days before rather than a weekday and time, so it reads the same for a training on two weekdays and needs
  no time zone of its own; empty is always open, as before. Until then a member's In is refused (409, "Sign-up opens
  Monday.", with the date when it's more than a week off) and the app shows "Sign-up opens Mon" in In's place; Out
  is always fine, and the register and admins put people in whenever. On the day members are told, once a night
  (topic `places`, [0108](0108-store-apps.md)): the cron takes the night in the statement that marks it told
  (`training_sessions.signup_told_at`, [0121](0121-load-and-concurrency.md)); a night already open when its training
  was given an opening day isn't news, and isn't sent (`worker/training/training.signup.ts`, `lib/signup.ts`). Nor
  is it to anyone who's answered already (said Out, or put in by an admin): they aren't told.
- **An Out can be taken back**: tapping a pressed Out ("Take back your Out") is not answered again
  (`answer: "clear"`), so a member who said Out before sign-up opened hears when it does. One statement deletes only
  their own Out (`… AND signup = 'out'`), so a double tap finds nothing more to do and an In or a place waiting is
  never touched (that's left by saying Out, as ever). It keeps the rules of answering: not once the night's over, nor
  once a tournament's started (`worker/entries/entries.ts` takeBack). The Kumite's invitation keeps Decline and
  Accept.
- **The limit is what members see and what sign-up keeps to, not a wall**: the team maker can let someone waiting in
  over it ([0076](0076-training-teams.md)). They keep their sign-up time, so they take their place in the order; while
  more are in than the limit, nobody moves up when someone drops out, and the page says how many over it is.
- **Adding someone keeps to the places too**: the register's Add player (before the night or on it, as a walk-in)
  and an admin putting someone in (`update:Event`) put them in if there's room, else on the waiting list, as if they'd
  signed up (a Quarterly Member taking the last pay-as-you-go place; someone already waiting keeps their place in the
  queue). Only the team maker's Let in puts anyone over the limit. The reply says where they went (`signup`), and the
  register says so ("Full: Walt's on the waiting list", Waiting on their row) with Let in beside them for whoever
  can. A night that's over is a record: someone ticked as there is in, whatever the places. Once it has ended (London
  time) a member's own In or Out is refused (409): who came, and what it charged, is the register's to change.
- **The places are the skaters'; keepers have their own**: a keeper is never on the waiting list because the skaters
  are full, and never takes a skater's place. A series' `goalie_capacity` is the keepers' limit (null: none), kept to
  the same way: over it a keeper waits. Places are counted a side at a time, so a place a keeper leaves goes to the
  first keeper waiting, never a skater ahead of them, and a skater's to the first skater (`worker/entries`,
  `lib/places.ts`). The Friday page says the skaters' places left, and the keepers' too where the series sets them.
- **Keepers aren't in the Quarterly order**: they keep their sign-up place, and a skater never takes a keeper's.
  Whether keepers pay at all, or need a plan of their own, is open.
- The app gets the lists in that order, with who is Quarterly (`quarterly`), shown as a Quarterly badge (the word,
  at every width) on their row in the sign-up lists and a tag on their card, so the order reads. That tells every member who signed up on the Quarterly plan, which is the
  point of the badge. Whoever sees who said they're out (who runs events) gets the same flag for them, so Out groups
  by plan too; nobody else's plan is sent.
- **Before anyone's answered**, Friday's Who's coming is a line on the page, not tabs over an empty table: "Nobody's
  in yet." and a quip about slackers (Settings → Quips, "Nobody in"), or, before its sign-up opens, when it does
  ("Sign-up opens Monday. Then we'll see who the slackers are."). The first answer brings the tabs in below the
  heading, which keeps its place.
- Friday's Who's coming shows each list (In, Waiting, Out) **grouped by plan**, under small headings with their
  counts: Quarterly, Pay as you go, Keepers (the three plans, ADR 0007). Skaters keep their number in the one queue,
  on across Quarterly and Pay as you go; keepers are numbered on their own, their places counted apart. The Quarterly
  badge is left off inside the Quarterly group, where the heading says it. Out groups the same way, from the
  `quarterly` flag sent for those who are out (`lib/roster-groups.ts`).
- Tournaments and club events keep plain sign-up order.

### A tournament owns its rules

- A tournament keeps its own copy of the rules and settings: points for a win, draw and loss (`points_win`,
  `points_draw`, `points_loss`), `game_minutes`, `kind`, `awards` and `playoffs`
  (ADR [0061](0061-fixtures-games-and-scoring.md)), plus its place, fee and hours. Picking a series copies its
  defaults in; the server takes the series' for any left out. They can then change for that tournament alone.
- The series' look, name and menu section stay the series'; they aren't per tournament.
- Standings, Games and the game clock read the tournament's own rules.

### A tournament's date

- `held_on`, `start_time`, `end_time`, `capacity`, `fee_pence` (fixed once charged), `public` (on the website) and
  `status` (planned, open, live, finished).
- **A date is a day, or just a season, never both**: spring, summer, autumn or winter and a year (the UK's, by month;
  winter is December to February), in `tournaments.season`. `held_on` stays required and holds the season's last day,
  which is never shown: it decides where the date sorts and keeps it coming up until the season is over. A season is
  the only "to be confirmed" there is (`dateTbc` on the agenda) and shows as "Summer 2027"; setting a day clears it.
  There's no separate "TBC" tick on a day: one that's set is the day. The forms pick the season and year as one choice,
  this season and the next three. The rules are in `packages/shared/seasons.ts`, used by the app, its API and the
  website.
- **Sign-up closes** (`signup_closes_on`) at the end of that day (London). After it the server refuses "I'm in"
  (409); saying out is still fine, and an admin can still add someone. Empty: open up to the day. When it opens is
  ADR [0074](0074-tournament-home-and-scheduling.md).

### Teams entering or captains drafting

- A tournament (and a series, as the default it copies) has a `kind`: `teams` (teams enter) or `draft` (captains
  draft members).
- Every tournament has teams (`tournament_teams`): a name, a logo, and a captain who is a member
  (`captain_member_id`), or for a team from outside the club a `captain_name` and `contact`. Their players
  (`tournament_team_players`) are members, or players from outside by name, in order (`position`).
- In a draft each team's captain must be a member and the teams are in pick order (`pick`). A team that entered must
  have a name. How a draft is opened, picked and closed is ADR [0060](0060-the-draft.md).
- Nobody plays for two teams in one tournament. At most 16 teams of 30 players.
- A logo is shrunk in the browser (256px on its longest side, WebP) and stored in D1 as a `data:` URL, up to about
  150 KB. No image storage service is needed.
- The tournament editor has a Teams tab ("Draft & teams" for a draft). The series editor sets the kind its
  tournaments start with.

### Places

- A **`venues` table**: `name`, `address`, `map_url` (pasted from Google Maps, Share → Copy link) and `active`. One no
  longer used is hidden from the pickers, never deleted, so what has it keeps it.
- Everything with a place (training series and sessions, tournament series and tournaments, club events) has
  `venue_id`, its own name (`venue`, or `location` on tournaments and series) and its own `map_url`.
- **One rule**, `placeOf` in `packages/shared/places.ts`, used by the app, the agenda and the website: the saved venue wins;
  else the name and link it has; else its series' place (a session's training, a tournament's series). A place with
  no link gets a map search for its name and address. Picking a venue clears the thing's own name and link.
- Every editor's _Where_ is one picker: the saved venues, then _Somewhere else…_ (a name and a map link). A
  tournament can also leave it on _Usual_, its series' place.
- A pasted link must be an `http(s)` web link (`cleanMapUrl`; the server refuses anything else), so it can never run
  script. The calendar file the app hands out has the venue's name and address as its location.

## Consequences

- Friday's defaults change in one place; this week's differences stay on this week's row.
- Moving the sports centre's link or address is one edit; every training, Kumite and event there follows, on the
  website too. The seed links Friday Training and the Kumite to it.
- Changing a series' defaults changes new tournaments, not ones already scheduled.
- Routes depend on data, so the route tree is built at runtime (`nav-routes.ts` `buildRoutes`), and paths carry
  slugs (`/training/friday`, `/tournaments/kumite`). Renaming keeps the slug.
- A tournament on its own has no menu section, Games, Standings or Draft pages of its own.
- Code that shows a tournament's date checks `season` first; anything that filters on `held_on` keeps working.
- An existing place typed as text keeps working (name and search link) until it's re-picked as a venue. The website's
  own Fridays venue (Sanity settings) is separate content and isn't linked to this table.
- Logos in D1 make a tournament's rows heavier; fine at 16 teams, and they can move to storage later.
- The website's Kumite page lists a Kumite's own awards (the next public one's, else the last held's), not the
  series' (ADR [0044](0044-champions-and-awards.md)); the series' are the defaults a new Kumite copies.

## History

- 2026-10-06: Every date in one D1 `events` table with a weekly `event_series` (8 weeks ahead); the website reads
  public events live and the Sanity `event` type goes (was 0025).
- 2026-10-06: `events` split into training series and sessions, tournament types and tournaments, and club events;
  sessions made 12 weeks ahead; the app's menu built from the data (was 0030).
- 2026-10-07: A tournament date gets its own sheet, a type a default location, a sign-up deadline, a draft night
  and `tournament_captains` (was 0046).
- 2026-10-07: A date can be just a season, stored in `season` with `held_on` its last day (was 0048).
- 2026-10-07: A tournament owns a copy of its rules and awards; its series becomes optional; Settings splits into
  Tournaments and Tournament Series (was 0049).
- 2026-10-07: Places become a `venues` table with pasted map links and one `placeOf` rule; the API stops sending a
  worked-out `venue` (was 0051).
- 2026-10-07: A tournament's `kind` (teams or draft) replaces the draft switch; every tournament has
  `tournament_teams` and players, replacing `tournament_captains` (was 0052). Its draft parts (picking from midnight
  on the day, the editor replacing teams on save) were superseded the same day by ADR 0060.
- 2026-10-07: The calendar and the website read one agenda pushed from all three sources (ADR 0042).
- 2026-10-09: The draft has a day, not a time; sign-up opens on a day; a series has usual hours (ADR 0074).
- 2026-10-09: `date_confirmed` dropped: a TBC tick beside a set day left it showing TBC. A date is a day or a season;
  the quick form asks the season first, the day optional; season and year are one pick.
- 2026-10-10: A training's sign-ups are one order, Quarterly Members first, then those paying as they go: a
  Quarterly Member signing up for a full session takes the last pay-as-you-go place; keepers aren't in it; badged
  (a club rule change).
- 2026-10-20: The team maker can let someone waiting in over the limit; the limit still holds for sign-up.
- 2026-10-20: The Quarterly badge says "Quarterly" on a phone too (it had been a small calendar icon there, which
  nobody read); it's off the team rows, where the queue is behind them.
- 2026-10-20: Adding a player (the register's Add player, an admin putting someone in) keeps to the places: full
  means the waiting list, and only the team maker lets anyone in over the limit. Adding had put them in whatever the
  places, so a Friday could fill past its limit with nobody waiting.
- 2026-10-21: Friday's Who's coming is grouped by plan (Quarterly, Pay as you go, Keepers), each with its count;
  skaters keep their queue number across the first two, keepers are numbered on their own. Out too: the
  `quarterly` flag is sent for those who said they're out, to whoever sees them.
- 2026-10-21: Keepers don't count towards the places, which are the skaters'; a series' `goalie_capacity` is now
  enforced as the keepers' own limit (it had been stored but not enforced, and keepers had taken skaters' places).
- 2026-10-22: A single night the rule gives can be made ahead of the weeks (`POST /api/series/:id/sessions`), so a
  clash far off can be cancelled before the rest are made; made, it stays as it is ([0122](0122-asked-about-clashes.md)).
- 2026-10-22: A training's limit raised moves the first waiting up into the room it makes, in the same batch as the
  save, rather than leaving it to the next to sign up (#127); a training is saved with its fees all or nothing (#131),
  its dates real days and its times real times, ending after they start (#129).
- 2026-10-22: A member can't say In or Out of a night that has ended (it had taken an Out after the night, and its
  charge with it, #128); the register and admins still can.
- 2026-10-22: Deleting an account (ADR 0029) frees its places for what's to come as saying out does: the first
  waiting move up, in the batch that erases it (#137).
- 2026-10-22: A training's nights open for sign-up a number of days before (Friday Training: 4, the Monday), and
  members are told on the day, once; empty is always open. The seed sets Friday's (dev and production need the same).
- 2026-10-22: Who's coming with nobody answered is a line and a quip about slackers (a new quip kind, "Nobody in"),
  or when sign-up opens, instead of an empty table.
- 2026-10-23: A night is cancelled, and put back on, from its training's own page (Manage → Cancel this night / It's
  back on), not only from the editor's list of nights: a confirm first says how many signed up hear it's off (the clash
  sheet's words), then the night's own cancel (`manage:Training`). A training's page is still its next night that's on,
  and any night off from today to it shows above it, struck through and Cancelled, so a Friday off for the Kumite
  doesn't just vanish from the page (`lib/night-off.ts`).
- 2026-10-23: An Out can be taken back, to not answered ("i should be able to unclick out here - otherwise i wont get
  the push on monday right?", the user): a pressed Out taps off (`answer: "clear"`, one guarded delete of your own
  Out), for training nights, tournaments and club events, refused once a night's over or a tournament's started; and
  "sign-up's open" goes only to those who haven't answered (a night's or a tournament's).
- 2026-10-23: The tournament editor's teams and awards are rows that read as text and open a sheet, not walls of
  inline inputs ("I don't like how you made these fields editable. We have an edit UI for the teams"; "This form is a
  mess", the user). A team's row: its crest, its captain, what it's called (or will be: the team the captain brings,
  else "Team Dan"), its pick once drawn and who's picked; its sheet (lib/TeamSheet) has the captain and the team page's
  own name-and-logo fields (lib/TeamLookFields, shared with lib/TeamLookSheet), and a team that entered its players.
  An award's row: its name, its line and how it's decided as a quiet tag ("Vote · skaters for a keeper · ties: fewest
  goals against", `decidedByTag`); its sheet (lib/AwardSheet) has the fields and what that means on the night. Both
  sheets change the editor's form and are saved with its Save; Done closes, Remove asks once. Which sheet is open is
  one value the editor holds (`sheet`), for a page address to open later. A team that entered with no name opens its
  sheet on Save. The team page's Edit the team still saves on its own, for its captain.
- 2026-10-23: The editor's open questions answered (docs/kumite-editor-review.md, the user). **A team's name and logo
  are edited only on its own page** (Edit the team): the editor's team sheet shows its captain and its name and crest
  as text, with Edit the team, which closes the editor (asking first if anything's unsaved) and goes to the team's
  page, never a sheet over the editor; the editor only adds, removes and changes captains (and a team that entered,
  its players). A team that enters, new in the editor, is still named there (it can't be registered without a name).
  The app sends a saved team without its name or logo (`lib/tournament-body.ts`), and the Worker keeps a team's look
  when a save leaves it out, so an editor left open while a captain renames their team never puts the old name back.
  **No Status on Sign-up**: a tournament's stage moves on only from its own page (Manage: Close sign-up, Move to…,
  ADR 0074); the app's save leaves `status` out and the Worker keeps it (a save that names one still sets it). **Tabs
  in the order they're set**: Details, Sign-up, Draft & teams (Teams), Rules & awards, shorter on a phone (Details,
  Sign-up, Teams, Rules) so all four fit at 390px; the full name is the tab's label. **Awards per Kumite, and the
  website follows**: the website shows a Kumite's own awards, not the series' (ADR 0044).
- 2026-10-23: A tournament's type (captains draft, or teams enter) stays once it has any team: captains named or a
  team entered. Before, only an opened draft fixed it, so a draft with captains could become one teams enter and
  leave them as nameless entered teams. The editor greys the other type out and says why; the server refuses (409).
