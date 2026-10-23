-- What the club's database starts with that isn't about anyone: roles and what they can do, Friday Training,
-- its fee and its 2026 nights, the Kumite series (no Kumite scheduled), the quarterly rate, and the quips. INSERT OR
-- IGNORE by id, so it's safe to run on a database that already has them (scripts/db-rebuild.mjs runs it after every
-- rebuild): what admins changed in the app stays. People come from the roster (db/seed/README.md), never from here.

-- roles
INSERT OR IGNORE INTO roles (id, name, description, is_system) VALUES
  (1, 'Member', 'Everyone approved', 0),
  (2, 'Contributor', 'Uploads photos and videos', 0),
  (3, 'Session lead', 'Runs Friday night: the register and the teams', 0),
  (4, 'Admin', 'Runs the club', 1);

-- role_actions
INSERT OR IGNORE INTO role_actions (role_id, action) VALUES
  (2, 'read:Event'),
  (2, 'signup:Event'),
  (3, 'read:Event'),
  (3, 'signup:Event'),
  (1, 'read:Event'),
  (1, 'signup:Event'),
  (2, 'upload:Photo'),
  (2, 'upload:Video'),
  (3, 'record:Attendance'),
  (3, 'read:Rating'),
  (3, 'generate:Teams'),
  (3, 'publish:Teams'),
  (4, 'manage:all');

-- venues
INSERT OR IGNORE INTO venues (id, name, address, map_url, active) VALUES
  (1, 'Battersea Sports Centre', 'London SW11 3AB', 'https://maps.app.goo.gl/w5GZTqQF9Qekgeaa6', 1),
  -- Where the Kumite goes afterwards (ADR 0074); its street address isn't known yet
  (2, 'The Anchor', '', 'https://maps.app.goo.gl/GhKGiPB1vKnpV6HB7', 1);

-- training_series
INSERT OR IGNORE INTO training_series (id, slug, name, short_name, icon, tone, repeat_every, weekdays, starts_on, ends_on, start_time, end_time, venue_id, venue, capacity, goalie_capacity, signup_closes_mins, signup_opens_days, public, active) VALUES
  (1, 'friday', 'Friday Training', 'Friday', 'stick', 'blue', 1, 'fri', '2026-01-02', NULL, '19:30', '21:30', 1, '', 21, 3, NULL, 4, 1, 1);

-- training_sessions
INSERT OR IGNORE INTO training_sessions (id, series_id, held_on, moved_from, start_time, end_time, venue, capacity, goalie_capacity, note, cancelled_at, register_closed_at) VALUES
  (1, 1, '2026-01-02', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (2, 1, '2026-01-09', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (3, 1, '2026-01-16', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (4, 1, '2026-01-23', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (5, 1, '2026-01-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (6, 1, '2026-02-06', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 1, '2026-02-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 1, '2026-02-20', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (9, 1, '2026-02-27', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (10, 1, '2026-03-06', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (11, 1, '2026-03-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (12, 1, '2026-03-20', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (13, 1, '2026-03-27', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (14, 1, '2026-04-03', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (15, 1, '2026-04-10', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (16, 1, '2026-04-17', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (17, 1, '2026-04-24', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (18, 1, '2026-05-01', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (19, 1, '2026-05-08', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (20, 1, '2026-05-15', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (21, 1, '2026-05-22', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (22, 1, '2026-05-29', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (23, 1, '2026-06-05', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (24, 1, '2026-06-12', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (25, 1, '2026-06-19', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (26, 1, '2026-06-26', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (27, 1, '2026-07-03', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (28, 1, '2026-07-10', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (29, 1, '2026-07-17', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (30, 1, '2026-07-24', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (31, 1, '2026-07-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (32, 1, '2026-08-07', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (33, 1, '2026-08-14', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (34, 1, '2026-08-21', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (35, 1, '2026-08-28', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (36, 1, '2026-09-04', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (37, 1, '2026-09-11', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (38, 1, '2026-09-18', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (39, 1, '2026-09-25', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (40, 1, '2026-10-02', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

-- tournament_types
INSERT OR IGNORE INTO tournament_types (id, slug, name, short_name, icon, tone, format, points_win, points_draw, points_loss, game_minutes, penalty_rule, default_penalty_minutes, periods, break_minutes, kind, active, default_fee_pence, awards, venue_id, location, default_start_time, default_end_time, after_venue_id, after_note) VALUES
  (1, 'kumite', 'The Cougars Kumite', 'Kumite', 'swords', 'red', 'round_robin', 3, 1, 0, 12, 'sit_out', 2, 1, 0, 'draft', 1, 0, '[{"name":"The Judges'' Call","about":"Bribes were accepted.","decidedBy":{"kind":"live","options":["Fastest Looking Skates","Most Shoulder Fakes","Most Crossbars","Smoothest Crossovers","Best Celly","Most Dramatic Fall","Loudest Stick Tap","Most Calls Missed (the ref)","Blindest Whistle (the ref)"]}},{"name":"Top scorer","about":"Most goals… some on purpose.","decidedBy":{"kind":"stat","stat":"goals"}},{"name":"Best keeper","about":"Big glove… bigger excuses.","decidedBy":{"kind":"vote","voters":"skaters","tieBreak":"goalsAgainst"}},{"name":"Champions","about":"Last team standing… barely.","decidedBy":{"kind":"stat","stat":"table"}}]', 1, '', '19:00', '21:30', 2, 'Celebration and awards');

-- quips
INSERT OR IGNORE INTO quips (id, kind, text) VALUES
  (1, 'ask', 'If you ain''t first, you last.'),
  (8, 'ask', 'Still deciding? The puck won''t wait.'),
  (9, 'in', 'Shake and bake.'),
  (10, 'in', 'Good. Bring your legs.'),
  (11, 'in', 'Bold. Stretch first.'),
  (14, 'in', 'Brave. Pads on, ego off.'),
  (15, 'in', 'Noted. Pass it occasionally.'),
  (19, 'waitlist', 'Bench for now. Keep it warm.'),
  (21, 'waitlist', 'Queued. Stretch anyway, optimist.'),
  (25, 'out', 'Fine. More puck for us.'),
  (31, 'morning', 'Up and at ''em, {name}'),
  (32, 'morning', 'Rise and grind, {name}'),
  (33, 'morning', 'Early doors, {name}'),
  (34, 'morning', 'Morning, {name}. Stretch.'),
  (35, 'afternoon', 'Well, well. {name}.'),
  (36, 'afternoon', 'Skiving, {name}?'),
  (37, 'afternoon', 'Look who it is. {name}.'),
  (38, 'afternoon', 'Shouldn''t you be working, {name}?'),
  (39, 'evening', 'Evening, {name}. Behave.'),
  (40, 'evening', 'Still standing, {name}?'),
  (41, 'evening', 'Legs fresh, {name}?'),
  (42, 'evening', 'Night shift, {name}?'),
  (43, 'late', 'Can''t sleep, {name}?'),
  (44, 'late', 'Go to bed, {name}'),
  (45, 'late', 'Bit late, {name}'),
  (46, 'training', 'Lace up, {name}'),
  (47, 'training', 'Skates on tonight, {name}'),
  (48, 'training', 'Tonight''s the night, {name}'),
  (49, 'training', 'Game face, {name}'),
  (50, 'nag', '{nth} look today, {name}. Save some for the rink.'),
  (51, 'nag', '{nth} visit. It''s not changing, {name}.'),
  (52, 'nag', 'Refreshing won''t make it {day}, {name}'),
  (53, 'nag', '{nth} time today. Go outside, {name}.'),
  (54, 'nag', 'Again, {name}? {nth} today.'),
  (55, 'ask', 'Well? The puck''s waiting.'),
  (56, 'ask', 'Skates on or feet up?'),
  (57, 'ask', 'In or out. Easy one.'),
  (58, 'ask', 'One tap. In or out?'),
  (59, 'ask', 'The bench is judging you.'),
  (60, 'ask', 'Spaces are going. You in?'),
  (61, 'in', 'Lovely. Someone has to be the slowest.'),
  (62, 'in', 'Good call. Tape your stick.'),
  (63, 'in', 'In. Hydrate like you mean it.'),
  (64, 'in', 'Locked in. Try to keep up.'),
  (65, 'waitlist', 'Full house. Start hoping someone pulls a hamstring.'),
  (66, 'waitlist', 'Waitlist. Someone''s hamstring will go.'),
  (67, 'waitlist', 'Waitlist. Keep your skates by the door.'),
  (68, 'out', 'Gutted. Right, who wants their spot?'),
  (69, 'out', 'Rest up. You need it.'),
  (70, 'out', 'We''ll miss you. Briefly.'),
  (71, 'out', 'Out. Your stick will forgive you.'),
  (72, 'out', 'Tragic. Anyway, more shifts for us.'),
  (73, 'out', 'Shame. Guess I''ll take your spot then.'),
  -- The club's own excuse for missing training
  (83, 'out', 'These blankets won''t crochet themselves.'),
  (74, 'empty', 'No slackers allowed. Be the first one in.'),
  (75, 'empty', 'Empty. The slackers are still deciding.'),
  (76, 'empty', 'Not one. Slackers, the lot of them.'),
  (77, 'empty', 'Even Van Damme had to go first.'),
  (78, 'empty', 'Zero in. Slackers, this is your call.'),
  -- A drafted tournament's Draft open, for a member who isn't a captain (ADR 0060): Chong Li's powder, Dux fighting
  -- blind. The first is the line shown; the rest are alternates an admin can swap in (Settings → Quips)
  (79, 'blind', 'Can''t see the draft? Neither could Dux. He did all right.'),
  (80, 'blind', 'Chong Li threw the powder. You''ll see the teams when the draft''s done.'),
  (81, 'blind', 'Blindfolded, like Tanaka taught you. Teams out soon.'),
  (82, 'blind', 'Use your other senses. Teams out when the captains are done.');

-- series_fees: Friday Training's pay-as-you-go fee per session (ADR 0007), for every night from a year before the
-- app went live
INSERT OR IGNORE INTO series_fees (series_id, effective_from, amount_pence) VALUES
  (1, '2025-10-01', 1200);

-- subscription_fees: the quarterly rate (ADR 0007), for every quarter from a year before the app went live
INSERT OR IGNORE INTO subscription_fees (effective_from, amount_pence) VALUES
  ('2025-10-01', 9000);

-- The seed may have changed the club's data: the team app reloads it (data_version, ADR 0053)
INSERT INTO data_version (id, version) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER))
  ON CONFLICT (id) DO UPDATE SET version = version + 1;
