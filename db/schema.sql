-- The database, as it is today: every table and index D1 has, in one place (ADR 0050).
-- Not live yet, so there are no migrations: change this file, then rebuild local and dev with
-- scripts/db-rebuild.mjs, which keeps their data. Migrations start from this file at launch.

CREATE TABLE enquiries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  experience  TEXT,          -- never | some | regular
  message     TEXT,
  source      TEXT,          -- page path the form was submitted from
  status      TEXT NOT NULL DEFAULT 'new',  -- new | contacted | joined | closed
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verified INTEGER NOT NULL DEFAULT 0,
  auto_replied_at TEXT
);

CREATE INDEX enquiries_created_at ON enquiries (created_at);

CREATE INDEX enquiries_auto_replied_at ON enquiries (auto_replied_at);

CREATE INDEX enquiries_email ON enquiries (email);

-- Tokens the website renews by itself (apps/web/src/lib/server/instagram-token.ts, ADR 0113): Instagram's, for the
-- club's posts. Sealed in the Worker (AES-GCM, with a key only it has, the row's name bound in), so this table never
-- holds one anyone can read or move.
CREATE TABLE sealed_tokens (
  name        TEXT PRIMARY KEY,   -- instagram
  sealed      TEXT NOT NULL,      -- base64: 12-byte IV, then the ciphertext
  expires_at  TEXT NOT NULL,
  renewed_at  TEXT NOT NULL
);

CREATE TABLE members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- Null until known; sign-in needs it. Unique where set.
  email TEXT UNIQUE,
  phone TEXT,
  -- F (forward), D (defence) or G (goalie)
  position TEXT NOT NULL DEFAULT 'F',
  -- 0–100, for balancing teams; only read:Rating sees it
  rating INTEGER NOT NULL DEFAULT 50,
  cougar INTEGER NOT NULL DEFAULT 0,
  photo TEXT,
  -- pending (asked to join), active, inactive, erased (deleted their account: a nameless Former member, #30)
  status TEXT NOT NULL DEFAULT 'active',
  -- The bank-transfer reference, the name as a bank shows it: COUGARS ADRIAN K (ADR 0007)
  payment_reference TEXT UNIQUE,
  joined_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  everyday_role_id INTEGER REFERENCES roles (id) ON DELETE SET NULL,
  web_name TEXT
);

CREATE INDEX members_status ON members (status);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  -- 1: can't be deleted or have its actions changed (Admin)
  is_system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE role_actions (
  role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  PRIMARY KEY (role_id, action)
);

CREATE TABLE member_roles (
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, role_id)
);

CREATE INDEX member_roles_role ON member_roles (role_id);

-- Places the club goes again and again (ADR 0030), picked by trainings, tournaments and events. Each of those also
-- has a name and map_url of its own, for a one-off that needn't be saved; empty map links mean a map search.
CREATE TABLE venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  -- Pasted from Google Maps (Share → Copy link)
  map_url TEXT NOT NULL DEFAULT '',
  -- 0: no longer offered when picking; what already has it keeps it
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE training_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- The phone tab label, e.g. Friday
  short_name TEXT NOT NULL,
  icon TEXT NOT NULL,
  tone TEXT NOT NULL,
  -- Every N weeks on these days (mon,fri), from starts_on to ends_on (null: ongoing)
  repeat_every INTEGER NOT NULL DEFAULT 1,
  weekdays TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  -- Where (ADR 0030): a saved venue, else its own name and map link
  venue_id INTEGER REFERENCES venues (id),
  venue TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  -- Places for skaters, and separately for goalies; null: no limit
  capacity INTEGER,
  goalie_capacity INTEGER,
  signup_closes_mins INTEGER,
  -- Listed on the website calendar
  public INTEGER NOT NULL DEFAULT 1,
  -- 0: paused, no new sessions
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE training_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES training_series (id),
  held_on TEXT NOT NULL,
  moved_from TEXT,
  start_time TEXT,
  end_time TEXT,
  -- Somewhere else this week: a venue, or a name and map link; none of them: the series'
  venue_id INTEGER REFERENCES venues (id),
  venue TEXT,
  map_url TEXT,
  capacity INTEGER,
  goalie_capacity INTEGER,
  note TEXT,
  cancelled_at TEXT,
  register_closed_at TEXT,
  -- What a session costs (ADR 0007): the series' fee on its day, written when it first charges someone, so a later
  -- change to the fee never alters it
  fee_pence INTEGER,
  UNIQUE (series_id, held_on)
);

CREATE INDEX training_sessions_held_on ON training_sessions (held_on);

CREATE TABLE tournament_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  icon TEXT NOT NULL,
  tone TEXT NOT NULL,
  -- round_robin
  format TEXT NOT NULL DEFAULT 'round_robin',
  points_win INTEGER NOT NULL DEFAULT 3,
  points_draw INTEGER NOT NULL DEFAULT 1,
  points_loss INTEGER NOT NULL DEFAULT 0,
  game_minutes INTEGER NOT NULL DEFAULT 12,
  -- How its tournaments make teams (ADR 0030): teams (teams enter) or draft (captains draft members)
  kind TEXT NOT NULL DEFAULT 'teams',
  active INTEGER NOT NULL DEFAULT 1,
  -- Copied onto each new edition, where it can be changed (ADR 0007)
  default_fee_pence INTEGER NOT NULL DEFAULT 0,
  -- Its usual hours, copied onto each new edition (ADR 0074): the Kumite is instead of Friday training, at its time
  default_start_time TEXT NOT NULL DEFAULT '11:00',
  default_end_time TEXT NOT NULL DEFAULT '16:00',
  awards TEXT NOT NULL DEFAULT '[]',
  -- The playoff games after the round robin, by table position: [{name, home, away}] (ADR 0061)
  playoffs TEXT NOT NULL DEFAULT '[]',
  -- Its usual place (ADR 0030): a saved venue, else a name and map link
  venue_id INTEGER REFERENCES venues (id),
  location TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT ''
);

CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Its series, if it has one: a tournament can stand on its own
  type_id INTEGER REFERENCES tournament_types (id),
  name TEXT NOT NULL,
  -- Its place (ADR 0030): a saved venue, else a name and map link; none of them: its series'
  venue_id INTEGER REFERENCES venues (id),
  location TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  held_on TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER,
  -- planned, open, live, finished
  status TEXT NOT NULL DEFAULT 'planned',
  champions TEXT,
  fee_pence INTEGER NOT NULL DEFAULT 0,
  public INTEGER NOT NULL DEFAULT 1,
  -- Sign-up opens by itself on this day (ADR 0074), unless an admin opened it by hand (status 'open')
  signup_opens_on TEXT,
  signup_closes_on TEXT,
  draft_on TEXT,
  -- The captains' draft (ADR 0060): none until an admin opens it, then open, then closed (teams locked)
  draft_state TEXT NOT NULL DEFAULT 'none',
  season TEXT,
  points_win INTEGER NOT NULL DEFAULT 3,
  points_draw INTEGER NOT NULL DEFAULT 1,
  points_loss INTEGER NOT NULL DEFAULT 0,
  game_minutes INTEGER NOT NULL DEFAULT 12,
  -- teams (teams enter) or draft (captains draft members), copied from its series (ADR 0030)
  kind TEXT NOT NULL DEFAULT 'teams',
  awards TEXT NOT NULL DEFAULT '[]',
  -- The playoff games after the round robin, by table position: [{name, home, away}] (ADR 0061)
  playoffs TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX tournaments_held_on ON tournaments (held_on);

CREATE TABLE club_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  -- A saved venue, else a name and the map link pasted for it (ADR 0030)
  venue_id INTEGER REFERENCES venues (id),
  venue TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  public INTEGER NOT NULL DEFAULT 0,
  signup_enabled INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER,
  description TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT
);

CREATE INDEX club_events_starts_at ON club_events (starts_at);

CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES training_sessions (id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  -- in / waitlist / out
  signup TEXT NOT NULL,
  signed_up_at TEXT NOT NULL,
  -- From the register: NULL not recorded (a sign-up is expected), 1 came, 0 no-show
  attended INTEGER,
  -- Came without signing up; the register added them
  walk_in INTEGER NOT NULL DEFAULT 0,
  recorded_by INTEGER REFERENCES members (id),
  recorded_at TEXT,
  UNIQUE (session_id, member_id)
);

CREATE INDEX attendance_member ON attendance (member_id);

CREATE TABLE tournament_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  -- in / waitlist / out
  signup TEXT NOT NULL,
  signed_up_at TEXT NOT NULL,
  attended INTEGER,
  UNIQUE (tournament_id, member_id)
);

CREATE INDEX tournament_entries_member ON tournament_entries (member_id);

CREATE TABLE club_event_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES club_events (id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  -- in / waitlist / out
  signup TEXT NOT NULL,
  signed_up_at TEXT NOT NULL,
  UNIQUE (event_id, member_id)
);

CREATE INDEX club_event_entries_member ON club_event_entries (member_id);

CREATE TABLE session_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES training_sessions (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Display order
  position INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  published_by INTEGER REFERENCES members (id)
);

CREATE INDEX session_teams_session ON session_teams (session_id);

CREATE TABLE session_team_players (
  team_id INTEGER NOT NULL REFERENCES session_teams (id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, member_id)
);

CREATE INDEX session_team_players_member ON session_team_players (member_id);

-- Announcements (#85): an admin's note at the top of Home, until its last day; each member can dismiss it for themselves
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  ends_on TEXT NOT NULL,
  created_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE announcement_dismissals (
  announcement_id INTEGER NOT NULL REFERENCES announcements (id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  PRIMARY KEY (announcement_id, member_id)
);

CREATE TABLE quips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX quips_kind ON quips (kind);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX subscriptions_member ON subscriptions (member_id);

-- Dues (ADR 0007): a training's fee, and the quarterly rate, each from a date going forward
CREATE TABLE series_fees (
  series_id INTEGER NOT NULL REFERENCES training_series (id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  PRIMARY KEY (series_id, effective_from)
);

CREATE TABLE subscription_fees (
  effective_from TEXT PRIMARY KEY,
  amount_pence INTEGER NOT NULL
);

-- One person for one session, tournament or quarter (2026-Q4). Session and tournament charges follow who came
-- (dues.ts); a quarter is charged by the hourly check, or by an admin by hand (created_by).
CREATE TABLE charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES training_sessions (id) ON DELETE CASCADE,
  tournament_id INTEGER REFERENCES tournaments (id) ON DELETE CASCADE,
  quarter TEXT,
  -- An adjustment an admin adds, and why (ADR 0007)
  reason TEXT,
  amount_pence INTEGER NOT NULL,
  due_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES members (id),
  CHECK ((session_id IS NOT NULL) + (tournament_id IS NOT NULL) + (quarter IS NOT NULL) + (reason IS NOT NULL) = 1)
);

CREATE INDEX charges_member ON charges (member_id);
CREATE UNIQUE INDEX charges_session ON charges (session_id, member_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX charges_tournament ON charges (tournament_id, member_id) WHERE tournament_id IS NOT NULL;
CREATE UNIQUE INDEX charges_quarter ON charges (quarter, member_id) WHERE quarter IS NOT NULL;

-- Money in, by transfer or cash, or an adjustment taking some off what they owe (with why); and the charges it paid for
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  amount_pence INTEGER NOT NULL,
  received_on TEXT NOT NULL,
  -- transfer, cash or adjustment
  via TEXT NOT NULL,
  reason TEXT,
  recorded_by INTEGER REFERENCES members (id),
  created_at TEXT NOT NULL
);

CREATE INDEX payments_member ON payments (member_id);

CREATE TABLE payment_allocations (
  payment_id INTEGER NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  charge_id INTEGER NOT NULL REFERENCES charges (id) ON DELETE CASCADE,
  amount_pence INTEGER NOT NULL,
  PRIMARY KEY (payment_id, charge_id)
);

CREATE INDEX payment_allocations_charge ON payment_allocations (charge_id);

CREATE TABLE login_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  -- Wrong codes so far; at 5 the challenge is spent
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX login_challenges_nonce ON login_challenges (nonce_hash);

CREATE INDEX login_challenges_member ON login_challenges (member_id, created_at);

CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  -- "code" (later "google"), and the browser, so a member can tell their devices apart
  method TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX auth_sessions_member ON auth_sessions (member_id);

-- A phone with the store app (ADR 0108): its Firebase token, and the sign-in it belongs to. Signing out (or the
-- session running out) stops its notifications; a session deleted takes its phones with it.
CREATE TABLE push_devices (
  token TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES auth_sessions (id) ON DELETE CASCADE,
  -- "ios" or "android" (web push, #24, can join later)
  platform TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX push_devices_session ON push_devices (session_id);

-- What each member chooses to hear (ADR 0108, #24): a row only for a topic they've switched, so no row means on.
-- The topics are one list in the app (src/lib/notification-topics.ts); push.ts skips a member with that topic off.
CREATE TABLE notification_prefs (
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  -- 1 on, 0 off ("on" itself is an SQL keyword)
  enabled INTEGER NOT NULL,
  PRIMARY KEY (member_id, topic)
) WITHOUT ROWID;

-- Notifications on their way (ADR 0108): one row per notice per phone, so a club-wide send can go out a batch at a
-- time within the free plan's 50 fetches an invocation (worker/push/push.ts). A row is claimed before it's sent, so
-- two drains at once never send it twice; a claim older than ten minutes was a drain that died, and is taken again.
-- A failed send is tried again later (due_at), a few times; a phone that's forgotten takes its rows with it. Sent
-- rows are kept a week, then pruned.
CREATE TABLE push_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL REFERENCES push_devices (token) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- When it may be sent: at once, then later after each failed try
  due_at TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  claim TEXT,
  claimed_at TEXT,
  sent_at TEXT
);

CREATE INDEX push_outbox_waiting ON push_outbox (sent_at, due_at);

CREATE INDEX push_outbox_token ON push_outbox (token);

CREATE INDEX push_outbox_created ON push_outbox (created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  member_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_log_at ON audit_log (at);

-- A tournament's teams (ADR 0030). Teams enter: each signs up with a name, a captain and its players, who may be
-- from outside the club. Captains draft: each captain is a member, given a pick order, and drafts members.
CREATE TABLE tournament_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  -- A small image, resized in the browser (a data: URL); null: its initials
  logo TEXT,
  -- The captain: a member, else (a team from outside) a name and how to reach them
  captain_member_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
  captain_name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  -- Captains draft: the captain's pick order, from 1, drawn at random as the draft opens (ADR 0060); null until
  -- then, and for a team that entered
  pick INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX tournament_teams_tournament ON tournament_teams (tournament_id);

CREATE TABLE tournament_team_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES tournament_teams (id) ON DELETE CASCADE,
  -- A member, else a player from outside the club: just a name
  member_id INTEGER REFERENCES members (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  -- Their order on the team (a draft's picks come in this order)
  position INTEGER NOT NULL DEFAULT 0,
  -- A draft pick: its number in the whole draft (1, 2, …), which decides whose turn it is and what Undo takes back
  pick_number INTEGER
);

CREATE INDEX tournament_team_players_team ON tournament_team_players (team_id);

-- One number for "the club's data has changed": one more on every change through the team app, the seed and the
-- roster, so the app's bootstrap can answer "nothing's changed" (ETag, ADR 0053). It starts from the time it was
-- made, so a remade database never repeats an old version. Beside it, the London day the coming training sessions
-- were last made (apps/team/worker/schedule.ts ensureSessions): the day's first open of the app makes them, the rest
-- skip it, read in the same row (ADR 0057).
CREATE TABLE data_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  sessions_made_on TEXT
);

-- The website wants rebuilding (apps/team/worker/website.ts, ADR 0100): a finished tournament changed. One row while
-- one is wanted; the team Worker's five-minute cron sends it to GitHub after five quiet minutes and deletes the row.
CREATE TABLE website_rebuild (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  wanted_at TEXT NOT NULL
);

-- Who won a tournament's awards (apps/team/worker/awards.ts, ADR 0044): a team (Champions) or a player on one of its
-- teams (Top scorer). The award is one of the tournament's own, by name (tournaments.awards).
CREATE TABLE tournament_award_winners (
  tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  award TEXT NOT NULL,
  team_id INTEGER REFERENCES tournament_teams (id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tournament_id, award, position)
);

-- The club's settings for the team app (apps/team/worker/settings.ts, ADR 0072): one row, made on the first save.
-- How often live pages (a game being scored, a tournament's home, the draft room) check for updates, in seconds.
CREATE TABLE club_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  live_refresh_seconds INTEGER NOT NULL DEFAULT 10 CHECK (live_refresh_seconds BETWEEN 5 AND 120),
  -- Where members pay (ADR 0007): the account's name, sort code (6 digits) and number (8 digits), set by whoever sets
  -- fees. Shown on every member's Dues page and in reminders; none yet means no reminder goes out.
  bank_name TEXT,
  bank_sort_code TEXT,
  bank_account TEXT
);

-- Reminders of what someone owes (apps/team/worker/dues/reminders.ts, ADR 0007): sent by an admin (sent_by) or the
-- hourly cron (stage), at most one per member a week. A row is claimed (queued) before it's sent, so two runs send one
-- email; a send that fails is deleted, so it's tried again. Admins see when someone was last reminded.
CREATE TABLE dues_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  -- minor, major or misconduct (the cron, by the age of their oldest charge), or by_hand
  stage TEXT NOT NULL CHECK (stage IN ('minor', 'major', 'misconduct', 'by_hand')),
  sent_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
  claimed_at TEXT NOT NULL,
  -- queued until it's gone, then sent, with what they owed when it went
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent')),
  sent_at TEXT,
  pence INTEGER
);

CREATE INDEX dues_reminders_member ON dues_reminders (member_id, claimed_at);
CREATE INDEX dues_reminders_queued ON dues_reminders (status) WHERE status = 'queued';

-- Dev tools (apps/team/worker/devtools.ts, ADR 0027): outside production, who gets their own email instead of the
-- safe inbox. Never read in production.
CREATE TABLE dev_mail_recipients (
  email TEXT PRIMARY KEY,
  added_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
  added_at TEXT NOT NULL
);

-- The usage check's warnings (apps/team/worker/settings/usage.ts, ADR 0059): one email per metric per day (UTC); for
-- Sanity's monthly quotas (ADR 0116), per month (`day` is then 2026-10)
CREATE TABLE usage_warnings (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  PRIMARY KEY (day, metric)
);

-- Our own count of requests to Sanity (packages/shared/sanity-requests.ts, ADR 0116): Sanity has no usage API. One row
-- per UTC day, project (production's or dev's) and quota (`api` or its `cdn`), added to after each request that read
-- Sanity, and by each build. The team app's Usage page and hourly check read this month's.
CREATE TABLE sanity_requests (
  day TEXT NOT NULL,
  project TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('api', 'cdn')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, project, kind)
);

-- Backups of this database (scripts/db-backup.mjs, ADR 0106): when, why (nightly, before a deploy changes the schema)
-- and how big, sealed. The file itself is a CI artifact; this is so the Usage page can say when the last one was.
CREATE TABLE backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at TEXT NOT NULL,
  why TEXT NOT NULL,
  bytes INTEGER NOT NULL
);

-- A tournament's games (ADR 0061): its round robin, then its playoffs, which know their seeds (1st v 2nd) until the
-- table fills them in. Scores are the final ones; goal by goal comes with live scoring (T5).
CREATE TABLE tournament_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  -- group / playoff
  stage TEXT NOT NULL,
  round INTEGER NOT NULL,
  -- Its place in the day's order
  position INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  home_team_id INTEGER REFERENCES tournament_teams (id) ON DELETE CASCADE,
  away_team_id INTEGER REFERENCES tournament_teams (id) ON DELETE CASCADE,
  home_seed INTEGER,
  away_seed INTEGER,
  home_goals INTEGER,
  away_goals INTEGER,
  -- next / live / done
  status TEXT NOT NULL DEFAULT 'next',
  -- The game clock (ADR 0061): time left when it last stopped, and when it was started again (null: stopped). Time
  -- left now is clock_left_ms minus the time since clock_started_at
  clock_left_ms INTEGER,
  clock_started_at TEXT,
  -- Who holds the scoresheet: whoever pressed Start scoring; nobody else scores it until they (or an admin) let go
  keeper_member_id INTEGER REFERENCES members (id) ON DELETE SET NULL
);

CREATE INDEX tournament_games_tournament ON tournament_games (tournament_id, position);

-- Each goal as it went in (ADR 0061): its team, who scored and who assisted (null: not said), and when, in game time
CREATE TABLE tournament_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES tournament_games (id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES tournament_teams (id) ON DELETE CASCADE,
  scorer_member_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
  assist_member_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
  -- When, in game time; NULL when nobody said (a result typed in, a goal an admin added without a time)
  at_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX tournament_goals_game ON tournament_goals (game_id, id);


-- The club's agenda (ADR 0042): what's on and when, one row per thing on a day. Every part of the club pushes its own
-- rows when it changes (packages/shared/agenda.ts): each training session, a tournament's day, its draft night and its sign-up
-- deadline, each one-off event. The website's What's on and the app's calendar both read it.
CREATE TABLE agenda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- What pushed it: session / tournament / club_event, and which one
  source TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  -- training / tournament / draft / signup_closes / event
  kind TEXT NOT NULL,
  -- The calendar's filter it belongs to: series:1 / type:1 / tournament / social
  group_key TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  -- Its London date, for "from today"
  day TEXT NOT NULL,
  -- A day without a time (a deadline, a draft night with no time yet)
  all_day INTEGER NOT NULL DEFAULT 0,
  -- A tournament whose date isn't fixed, or that's only a season ("Summer 2027")
  date_tbc INTEGER NOT NULL DEFAULT 0,
  season TEXT,
  venue TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  -- On the website
  public INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  -- Who sees it: everyone, or only its tournament's captains (and those running the draft)
  audience TEXT NOT NULL DEFAULT 'everyone',
  UNIQUE (source, source_id, kind)
);

CREATE INDEX agenda_day ON agenda (day, starts_at);
