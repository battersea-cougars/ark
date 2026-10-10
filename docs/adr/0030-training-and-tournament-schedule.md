# 0030. The schedule lives in D1: training repeats as a series, tournaments are scheduled one by one and own their rules

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-10
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

### A training's waitlist: Quarterly Members first

- A full session puts whoever says "I'm in" on the waitlist. **Quarterly Members** (a subscription covering the
  session's day, ADR [0007](0007-dues-and-payments.md)) **queue ahead of everyone paying as they go**; within each, first come first
  served. When a place comes free the first in that queue moves up (`aheadIn` in `worker/entries/entries.ts`). Someone
  already in stays in: a Quarterly Member signing up late doesn't take their place.
- The app gets the waitlist in that order, with who on it is Quarterly (`quarterly`), shown as a Quarterly badge on
  their row and tag on their card so the order reads. That says who on a waitlist is Quarterly to every member, which
  is the point of the badge; nobody else's plan is sent.
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
- The website's Kumite page lists the series' awards (ADR [0044](0044-champions-and-awards.md)), not a tournament's
  own.

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
- 2026-10-10: Quarterly Members go ahead of those paying as they go on a training's waitlist, and are badged there
  (a club rule change).
