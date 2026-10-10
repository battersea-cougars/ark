// The club as the team app reads it (ADR 0057): one statement, so opening the app is one round trip to D1, not one per
// table. Each part is a list of rows the database turns into JSON; the domain modules shape them (training.ts,
// members.ts, ...). Who's asking is a row of its own (`viewer`), so what they may not see never leaves the database
// (ADR 0036): someone else's email, an "out" or a no-show, a team's contact. A SQLite view can't take who's asking or
// the day, so this is the view, as a query.
import { aheadIn } from "../entries/entries";

/** Who's asking, and what changes what they see. */
export interface Viewer {
  memberId: number;
  today: string;
  /** Sessions from this day: a few weeks back, for what's just been held */
  sessionsFrom: string;
  /** Events that haven't ended by now */
  now: string;
  /** Everyone's answers (out as well as in), no-shows and walk-ins: who runs events and their teams */
  seesRegister: boolean;
  /** Everyone's email, phone, payment reference and quarterly status, and who's left or asking to join */
  seesPrivate: boolean;
  /** Everyone's roles */
  seesRoles: boolean;
  seesRatings: boolean;
  /** How to reach a team that entered from outside the club */
  seesContacts: boolean;
  /** A draft night on the agenda, for whoever runs the draft (its captains see their own) */
  runsDraft: boolean;
  /** Everyone's charges and payments (ADR 0007): who sees Unpaid fees or records payments */
  seesDues: boolean;
}

// The viewer's columns, in the order they're bound
const VIEWER = [
  "member_id",
  "today",
  "sessions_from",
  "now",
  "sees_register",
  "sees_private",
  "sees_roles",
  "sees_ratings",
  "sees_contacts",
  "runs_draft",
  "sees_dues",
] as const;

const bound = (v: Viewer) => [
  v.memberId,
  v.today,
  v.sessionsFrom,
  v.now,
  Number(v.seesRegister),
  Number(v.seesPrivate),
  Number(v.seesRoles),
  Number(v.seesRatings),
  Number(v.seesContacts),
  Number(v.runsDraft),
  Number(v.seesDues),
];

/** A query's rows as one JSON array of objects, keyed by the query's column names, in the query's order. */
const rows = (columns: string, select: string) =>
  `(SELECT json_group_array(json_object(${columns
    .trim()
    .split(/\s+/)
    .map((c) => `'${c}', "${c}"`)
    .join(", ")})) FROM (${select}))`;

/** Answers to a kind of event, as anyone but whoever runs events sees them: their own "out", walk-in and no-show. */
const entries = (table: string, key: string, events: string, extra: string) =>
  rows(
    "eventId memberId signup walkIn attended ahead",
    `SELECT e.${key} eventId, e.member_id memberId, e.signup,
            ${extra === "session" ? "CASE WHEN v.sees_register OR e.member_id = v.member_id THEN e.walk_in ELSE 0 END" : "0"} walkIn,
            ${extra === "session" ? "CASE WHEN v.sees_register OR e.member_id = v.member_id THEN e.attended END" : "NULL"} attended,
            ${aheadIn(extra === "session" ? "session" : "event")} ahead
     FROM ${table} e, viewer v
     WHERE e.${key} IN (${events})
       AND (e.signup IN ('in', 'waitlist') OR v.sees_register OR e.member_id = v.member_id)
     ORDER BY ahead DESC, e.signed_up_at, e.id`,
  );

const SESSIONS_SHOWN = "SELECT s.id FROM training_sessions s, viewer v WHERE s.held_on >= v.sessions_from";
const EVENTS_SHOWN = "SELECT ce.id FROM club_events ce, viewer v WHERE ce.ends_at >= v.now";

/** Your own, or anyone's for who may see them. */
const mine = "(v.sees_private OR m.id = v.member_id)";

const PARTS = {
  everydayRole: "json_array((SELECT m.everyday_role_id FROM members m, viewer v WHERE m.id = v.member_id))",
  members: rows(
    "id name email position rating cougar status payment_reference roles bio web_name phone played quarterly quarterlyNext everyday_role_id",
    `SELECT m.id, m.name, CASE WHEN ${mine} THEN m.email END email, m.position,
            CASE WHEN v.sees_ratings THEN m.rating ELSE 0 END rating, m.cougar, m.status,
            CASE WHEN ${mine} THEN m.payment_reference END payment_reference,
            CASE WHEN v.sees_roles OR m.id = v.member_id THEN
              (SELECT group_concat(name) FROM (SELECT r.name FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                WHERE mr.member_id = m.id ORDER BY r.is_system DESC, r.id DESC)) END roles,
            m.bio, m.web_name, CASE WHEN ${mine} THEN m.phone END phone,
            (SELECT COUNT(*) FROM attendance a JOIN training_sessions s ON s.id = a.session_id
              WHERE a.member_id = m.id AND a.signup = 'in' AND COALESCE(a.attended, 1) = 1
                AND s.held_on < v.today AND s.cancelled_at IS NULL) played,
            ${mine} AND EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.member_id = m.id AND sub.starts_on <= v.today
              AND (sub.ends_on IS NULL OR sub.ends_on >= v.today)) quarterly,
            ${mine} AND EXISTS (SELECT 1 FROM subscriptions sub, (SELECT date(v.today, 'start of month',
                printf('-%d months', (CAST(strftime('%m', v.today) AS INTEGER) - 1) % 3), '+3 months') day) nq
              WHERE sub.member_id = m.id AND sub.starts_on <= nq.day
                AND (sub.ends_on IS NULL OR sub.ends_on >= nq.day)) quarterlyNext,
            CASE WHEN v.sees_roles OR m.id = v.member_id THEN m.everyday_role_id END everyday_role_id
     FROM members m, viewer v
     WHERE v.sees_private OR m.status = 'active' OR m.id = v.member_id
     ORDER BY m.name COLLATE NOCASE`,
  ),
  roles: rows("id name description is_system", "SELECT id, name, description, is_system FROM roles ORDER BY id"),
  roleActions: rows("role_id action", "SELECT role_id, action FROM role_actions"),
  venues: rows(
    "id name address mapUrl active",
    "SELECT id, name, address, map_url mapUrl, active FROM venues ORDER BY name",
  ),
  series: rows(
    `id slug name short_name icon tone repeat_every weekdays starts_on ends_on start_time end_time venue_id venue
     map_url capacity goalie_capacity signup_closes_mins public active`,
    "SELECT * FROM training_series ORDER BY id",
  ),
  sessions: rows(
    "id seriesId heldOn movedFrom startTime endTime venueId venue mapUrl capacity note cancelledAt registerClosedAt feePence",
    `SELECT s.id, s.series_id seriesId, s.held_on heldOn, s.moved_from movedFrom, s.start_time startTime,
            s.end_time endTime, s.venue_id venueId, s.venue, s.map_url mapUrl, s.capacity, s.note,
            s.cancelled_at cancelledAt, s.register_closed_at registerClosedAt, s.fee_pence feePence
     FROM training_sessions s, viewer v WHERE s.held_on >= v.sessions_from ORDER BY s.held_on, s.id`,
  ),
  // A training's fee, from each date (ADR 0007)
  seriesFees: rows(
    "seriesId pence from",
    `SELECT series_id seriesId, amount_pence pence, effective_from "from" FROM series_fees
     ORDER BY series_id, effective_from`,
  ),
  sessionEntries: entries("attendance", "session_id", SESSIONS_SHOWN, "session"),
  sessionTeams: rows(
    "sessionId teamId name memberId",
    `SELECT t.session_id sessionId, t.id teamId, t.name, p.member_id memberId
     FROM session_teams t LEFT JOIN session_team_players p ON p.team_id = t.id
     WHERE t.session_id IN (${SESSIONS_SHOWN}) ORDER BY t.position, t.id, p.rowid`,
  ),
  tournamentTypes: rows(
    `id slug name short_name icon tone format points_win points_draw points_loss game_minutes kind active
     default_fee_pence default_start_time default_end_time awards playoffs venue_id location map_url`,
    "SELECT * FROM tournament_types ORDER BY id",
  ),
  tournaments: rows(
    `id typeId name venueId location mapUrl heldOn startTime endTime capacity status champions feePence season
     public signupOpensOn signupClosesOn draftOn pointsWin pointsDraw pointsLoss gameMinutes kind awards
     playoffs draftState`,
    `SELECT t.id, t.type_id typeId, t.name, t.venue_id venueId, t.location, t.map_url mapUrl, t.held_on heldOn,
            t.start_time startTime, t.end_time endTime, t.capacity, t.status, t.champions, t.fee_pence feePence,
            t.season, t.public, t.signup_opens_on signupOpensOn,
            t.signup_closes_on signupClosesOn, t.draft_on draftOn, t.points_win pointsWin, t.points_draw pointsDraw,
            t.points_loss pointsLoss, t.game_minutes gameMinutes, t.kind, t.awards, t.playoffs, t.draft_state draftState
     FROM tournaments t ORDER BY t.held_on`,
  ),
  // In pick order (a draft) or the order they entered: the tournament's teams, and who keeps score (fixtures.ts)
  tournamentTeams: rows(
    "id tournamentId name logo captainMemberId captainName contact pick",
    `SELECT t.id, t.tournament_id tournamentId, t.name, t.logo, t.captain_member_id captainMemberId,
            t.captain_name captainName, CASE WHEN v.sees_contacts THEN t.contact ELSE '' END contact, t.pick
     FROM tournament_teams t, viewer v ORDER BY t.tournament_id, coalesce(t.pick, 1000), t.id`,
  ),
  tournamentPlayers: rows(
    "teamId memberId name pick",
    `SELECT team_id teamId, member_id memberId, name, pick_number pick FROM tournament_team_players
     ORDER BY team_id, coalesce(pick_number, position), id`,
  ),
  games: rows(
    `id tournamentId stage round position name homeTeamId awayTeamId homeSeed awaySeed homeGoals awayGoals status
     clockLeftMs clockStartedAt keeperId`,
    `SELECT id, tournament_id tournamentId, stage, round, position, name, home_team_id homeTeamId,
            away_team_id awayTeamId, home_seed homeSeed, away_seed awaySeed, home_goals homeGoals,
            away_goals awayGoals, status, clock_left_ms clockLeftMs, clock_started_at clockStartedAt,
            keeper_member_id keeperId
     FROM tournament_games ORDER BY tournament_id, position`,
  ),
  goals: rows(
    "id gameId teamId scorerId assistId atMs",
    `SELECT id, game_id gameId, team_id teamId, scorer_member_id scorerId, assist_member_id assistId, at_ms atMs
     FROM tournament_goals ORDER BY at_ms IS NULL, at_ms, id`,
  ),
  winners: rows(
    "tournamentId award teamId memberId",
    `SELECT tournament_id tournamentId, award, team_id teamId, member_id memberId FROM tournament_award_winners
     ORDER BY tournament_id, position`,
  ),
  tournamentEntries: entries("tournament_entries", "tournament_id", "SELECT id FROM tournaments", "tournament"),
  clubEvents: rows(
    "id title startsAt endsAt venueId venue mapUrl description public signup capacity cancelledAt",
    `SELECT ce.id, ce.title, ce.starts_at startsAt, ce.ends_at endsAt, ce.venue_id venueId, ce.venue,
            ce.map_url mapUrl, ce.description, ce.public, ce.signup_enabled signup, ce.capacity,
            ce.cancelled_at cancelledAt
     FROM club_events ce, viewer v WHERE ce.ends_at >= v.now ORDER BY ce.starts_at`,
  ),
  eventEntries: entries("club_event_entries", "event_id", EVENTS_SHOWN, "event"),
  // Dues (ADR 0007): your own charges, or everyone's for who sees Unpaid fees. Paid: in full, the last payment's day.
  charges: rows(
    "id memberId kind refId quarter title seriesId typeId startTime pence dueOn paidOn paidVia paidPence byHand",
    `SELECT c.id, c.member_id memberId,
            CASE WHEN c.session_id IS NOT NULL THEN 'session' WHEN c.tournament_id IS NOT NULL THEN 'tournament'
              WHEN c.reason IS NOT NULL THEN 'adjustment' ELSE 'quarter' END kind,
            COALESCE(c.session_id, c.tournament_id) refId, c.quarter, COALESCE(ts.name, t.name, c.reason) title,
            s.series_id seriesId, t.type_id typeId, COALESCE(s.start_time, ts.start_time, t.start_time) startTime,
            c.amount_pence pence, c.due_on dueOn,
            CASE WHEN paid.total >= c.amount_pence THEN paid.last_on END paidOn,
            CASE WHEN paid.total >= c.amount_pence THEN paid.via END paidVia, COALESCE(paid.total, 0) paidPence,
            c.created_by IS NOT NULL byHand
     FROM charges c, viewer v
       LEFT JOIN training_sessions s ON s.id = c.session_id LEFT JOIN training_series ts ON ts.id = s.series_id
       LEFT JOIN tournaments t ON t.id = c.tournament_id
       LEFT JOIN (SELECT pa.charge_id, SUM(pa.amount_pence) total, MAX(p.received_on) last_on,
                         (SELECT p2.via FROM payment_allocations pa2 JOIN payments p2 ON p2.id = pa2.payment_id
                           WHERE pa2.charge_id = pa.charge_id ORDER BY p2.id DESC LIMIT 1) via
                  FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id GROUP BY pa.charge_id) paid
         ON paid.charge_id = c.id
     WHERE v.sees_dues OR c.member_id = v.member_id
     ORDER BY c.due_on DESC, c.id DESC`,
  ),
  // Each payment, for the dues ledger: your own, or everyone's for who sees Unpaid fees
  payments: rows(
    "id memberId pence receivedOn via reason",
    `SELECT p.id, p.member_id memberId, p.amount_pence pence, p.received_on receivedOn, p.via, p.reason
     FROM payments p, viewer v WHERE v.sees_dues OR p.member_id = v.member_id
     ORDER BY p.member_id, p.received_on DESC, p.id DESC`,
  ),
  // Money paid in and not yet spent on a charge: it pays the next one (dues.ts settle)
  credits: rows(
    "memberId pence",
    `SELECT p.member_id memberId, SUM(p.amount_pence) - COALESCE((SELECT SUM(pa.amount_pence)
              FROM payment_allocations pa JOIN payments p2 ON p2.id = pa.payment_id WHERE p2.member_id = p.member_id), 0) pence
     FROM payments p, viewer v WHERE v.sees_dues OR p.member_id = v.member_id
     GROUP BY p.member_id HAVING pence > 0 ORDER BY p.member_id`,
  ),
  subscriptionFees: rows(
    "pence from",
    `SELECT amount_pence pence, effective_from "from" FROM subscription_fees ORDER BY effective_from`,
  ),
  quips: rows("id kind text", "SELECT id, kind, text FROM quips ORDER BY id"),
  settings: rows("live_refresh_seconds", "SELECT live_refresh_seconds FROM club_settings WHERE id = 1"),
  // What's on from today (ADR 0042). A draft night is for whoever runs the draft and that tournament's captains.
  agenda: rows(
    `source source_id kind group_key title starts_at ends_at day all_day date_tbc season venue map_url description
     public cancelled audience`,
    `SELECT a.* FROM agenda a, viewer v
     WHERE a.day >= v.today
       AND (a.audience <> 'captains' OR v.runs_draft OR (a.source = 'tournament' AND a.source_id IN
             (SELECT tournament_id FROM tournament_teams WHERE captain_member_id = v.member_id)))
     ORDER BY a.starts_at, a.id`,
  ),
} as const;

export type Part = keyof typeof PARTS;
/** Each part's rows. Loosely typed: each domain module's shaping says what its rows are. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Parts = Record<Part, any[]>;

/** The parts asked for, as this viewer may see them, in one statement. */
export async function readClub(db: D1Database, viewer: Viewer, parts: readonly Part[]): Promise<Parts> {
  const sql = `WITH viewer (${VIEWER.join(", ")}) AS (VALUES (${VIEWER.map(() => "?").join(", ")}))
    SELECT ${parts.map((p) => `${PARTS[p]} AS "${p}"`).join(",\n")}`;
  const row = await db
    .prepare(sql)
    .bind(...bound(viewer))
    .first<Record<Part, string>>();
  return Object.fromEntries(parts.map((p) => [p, JSON.parse(row![p])])) as Parts;
}
