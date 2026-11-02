# Team app data model

The D1 tables the team app needs, by area. Conventions are in [db/README.md](../db/README.md): snake_case
plural tables, `INTEGER PRIMARY KEY AUTOINCREMENT`, ISO text dates (`*_on` a date, `*_at` an instant), `_pence`
integers, 0/1 booleans, free-text status with a comment. The demo in `apps/team/src/demo/model.ts` uses the same
shapes in memory.

## People and access

[ADR 0023](adr/0023-sign-in-and-sessions.md), [ADR 0024](adr/0024-action-based-authorization.md).

| Table                            | Columns                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `members`                        | name, email (unique), phone, position (F/D/G), rating, cougar (on the official team, [ADR 0007](adr/0007-dues-and-payments.md)), bio, photo and photo_at (a small data: URL and when it was set, [ADR 0133](adr/0133-member-photos.md)), status (pending/active/inactive), payment_reference (unique), joined_on |
| `login_challenges`               | member_id, code_hash, nonce_hash, attempts, expires_at, used_at                                                                                                                                                                                                                                                  |
| `auth_sessions`                  | member_id, token_hash, method (code, passkey, break_glass), user_agent, created_at, last_seen_at, expires_at, revoked_at; viewing as a member comes with [ADR 0024](adr/0024-action-based-authorization.md)                                                                                                      |
| `roles`                          | name, description, is_system                                                                                                                                                                                                                                                                                     |
| `role_actions`                   | role_id, action                                                                                                                                                                                                                                                                                                  |
| `member_roles`                   | member_id, role_id                                                                                                                                                                                                                                                                                               |
| `audit_log`                      | at, member_id, action (sign_in, sign_out, access.requested…), detail (JSON, never a secret)                                                                                                                                                                                                                      |
| `passkeys`, `passkey_challenges` | a member's passkeys (public key only, named for the device) and each sign-in's single-use challenge                                                                                                                                                                                                              |
| `email_changes`                  | a member changing their own sign-in email: a code to each address, as hashes                                                                                                                                                                                                                                     |

## Schedule

[ADR 0030](adr/0030-training-and-tournament-schedule.md).

| Table                   | Columns                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `venues`                | name, address, map_url (pasted from Google Maps; empty: a map search), active (offered when picking)                                                                                                                                                                                                                                    |
| `training_series`       | slug (unique), name, short_name, icon, tone, repeat_every (weeks), weekdays (`mon,fri`), starts_on, ends_on (null: ongoing), start_time, end_time, venue_id, venue, map_url, capacity (skaters), goalie_capacity, signup_closes_mins, signup_opens_days (days before a night its sign-up opens; null: always), public, active           |
| `training_sessions`     | series_id, held_on, moved_from, start_time, end_time, venue_id, venue, map_url, capacity, goalie_capacity (each null: follows the series), note, cancelled_at (off, while anything keeps it off), called_off_at (called off by hand), register_closed_at, signup_told_at (members told its sign-up opened); unique (series_id, held_on) |
| `tournament_types`      | slug (unique), name, short_name, icon, tone, format (`round_robin`), points_win, points_draw, points_loss, game_minutes, draft, active, venue_id, location, map_url                                                                                                                                                                     |
| `tournaments`           | type_id, name, venue_id, location, map_url, held_on, start_time, end_time, capacity, status (planned/open/live/finished), public                                                                                                                                                                                                        |
| `training_session_offs` | session_id, tournament_id: a night off for a tournament on its day (#186, ADR 0122)                                                                                                                                                                                                                                                     |
| `club_events`           | title, starts_at, ends_at, venue_id, venue, map_url, public, signup_enabled, capacity                                                                                                                                                                                                                                                   |

The calendar is the `agenda` table ([ADR 0042](adr/0042-website-reads-the-club-agenda.md)): one row per thing on a day, which every part of the club writes when it changes (`packages/shared/agenda.ts`); the website's What's on and the app's calendar both read it.

Where each is held ([ADR 0030](adr/0030-training-and-tournament-schedule.md)): `venue_id` (a saved venue) wins; else its own name
(`venue`, or `location` on tournaments) and `map_url`; none of them, its series' place. One rule for both apps:
`placeOf` in `packages/shared/places.ts`.

## Sign-up, register and teams

| Table                  | Columns                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `attendance`           | session_id, member_id, signup (in/out/waitlist), signed_up_at, attended, walk_in, recorded_by, recorded_at; unique (session_id, member_id) |
| `session_teams`        | session_id, name, published_at                                                                                                             |
| `session_team_players` | team_id, member_id                                                                                                                         |
| `club_event_entries`   | event_id, member_id, signup, signed_up_at                                                                                                  |

## Tournaments

[ADR 0030](adr/0030-training-and-tournament-schedule.md), the draft [ADR 0060](adr/0060-the-draft.md), games
[ADR 0061](adr/0061-fixtures-games-and-scoring.md), awards [ADR 0044](adr/0044-champions-and-awards.md). The draft is columns, not
tables: `tournaments.draft_on` and `draft_state`, each team's `pick`, each player's `pick_number` and `picked_by`.

| Table                      | Columns                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `tournament_entries`       | tournament_id, member_id, signup, signed_up_at, attended                                                                                |
| `tournament_teams`         | tournament_id, name, logo, captain_member_id (else captain_name and contact: a team from outside), pick (the draft's order), created_at |
| `tournament_team_players`  | team_id, member_id (else a name: a player from outside), position, pick_number, picked_by                                               |
| `tournament_games`         | tournament_id, stage (group/playoff), round, position, home/away team or seed, goals, status (next/live/done), the clock, keeper        |
| `tournament_goals`         | game_id, team_id, scorer, assist, at_ms and period (game time), tap_id (one tap, one goal)                                              |
| `tournament_penalties`     | game_id, team_id, member_id (null: a bench penalty), minutes, infraction, at_ms and period, recorded_by, tap_id                         |
| `tournament_award_winners` | tournament_id, award, a team or a member, position, title (an admin's live call)                                                        |
| `tournament_award_votes`   | tournament_id, award, voter, candidate (never themselves), cast_at                                                                      |

## Dues

[ADR 0007](adr/0007-dues-and-payments.md): fees belong to
each session and tournament, payments are marked against charges, and Unpaid fees is the unpaid charges.

| Table                 | Columns                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `series_fees`         | series_id, amount_pence, effective_from (a training's fee, going forward)                                                                    |
| `subscription_fees`   | amount_pence, effective_from (the quarterly rate)                                                                                            |
| `subscriptions`       | member_id, starts_on, ends_on (a Quarterly Member while one covers the date; none: pay as you go, [ADR 0007](adr/0007-dues-and-payments.md)) |
| `charges`             | member_id, session_id or tournament_id or quarter (2026-Q4), amount_pence, due_on, created_at, created_by (made by hand)                     |
| `payments`            | member_id, amount_pence, received_on, via (transfer/cash), recorded_by, created_at                                                           |
| `payment_allocations` | payment_id, charge_id, amount_pence                                                                                                          |

Reminders: `dues_reminders` (what someone owes, at most one a member a week) and `plan_reminders` (next quarter's plan, one a member a quarter), each claimed before it's sent so two runs send once.

Also: `training_sessions.fee_pence` (its training's fee on its day, kept in line by dues.ts),
`tournament_types.default_fee_pence`, `tournaments.fee_pence` (copied from the type's default when scheduled).

## Club

| Table           | Columns                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data_version`  | version: one more on every change through the team app, the seed and the roster; the bootstrap's ETag ([ADR 0053](adr/0053-live-reads-are-cached.md))                                           |
| `announcements` | title, body, link (https only), ends_on, created_by: an admin's note at the top of Home until its last day (#85); `announcement_dismissals` (announcement_id, member_id) hides one for a member |
| `quips`         | kind (replies: ask/in/waitlist/out; greetings: morning/afternoon/evening/late/training/nag), text (each kind its own limit, lib/quips.ts); admins edit them, and each kind keeps at least one   |

## Notifications

[ADR 0108](adr/0108-store-apps.md): `push_devices` (a phone's Firebase token or a browser's Web Push subscription, and
its sign-in), `notification_prefs` (a row only for a topic a member switched off), `push_outbox` (one row per member
per notice, sent in batches, held through quiet hours) and `push_told` (what each member was last told about each
thing, for the debounce).

## Running the club's systems

One row or a few each, for Settings, the Usage page and the hourly run: `club_settings` (live refresh,
[ADR 0072](adr/0072-live-updates.md)), `enquiries` (the website's form), `sealed_tokens` (Gmail's token, sealed,
[ADR 0002](adr/0002-secrets-in-bitwarden.md)), `mail_health` ([ADR 0027](adr/0027-email-through-gmail-api.md)),
`dev_mail_recipients` (outside production only), `backups` ([ADR 0106](adr/0106-database-backups.md)), `hourly_run`,
`usage_levels`, `usage_warnings` and `sanity_requests`
([ADR 0059](adr/0059-usage-page-and-check.md)), `sentry_issues` and `error_report_days`
([ADR 0110](adr/0110-structured-logging.md)), `website_rebuild` and `website_times`
([ADR 0100](adr/0100-website-reads-tournament-results.md)).

`db/schema.sql` is the source of truth: each table's comment there says what it's for and which code owns it.
