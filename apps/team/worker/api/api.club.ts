// The club as the team app reads it (ADR 0057): one statement, so opening the app is one round trip to D1, not one per
// table. Each part is a list of rows the database turns into JSON; the domain modules shape them (training.ts,
// members.ts, ...). Who's asking is a row of its own (`viewer`), so what they may not see never leaves the database
// (ADR 0036): someone else's email, an "out" or a no-show, a team's contact. A SQLite view can't take who's asking or
// the day, so this is the view, as a query.
import { doneSql } from "@cougars/shared/results";
import { quarterlyOn } from "../entries/entries";
import { REVEAL_PLACE } from "../tournaments/awards";
import { playedOf } from "../members/members.played";
import { CHARGE_COLUMNS, OWED_COLUMNS, OWING, chargeSelect, owedSelect } from "../dues/dues.ledger";

/** Who's asking, and what changes what they see. */
export interface Viewer {
  memberId: number;
  /** Who's really signed in, while they view the app as `memberId` (ADR 0024); null: themselves */
  viewedBy: number | null;
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
  /** Every award's winner as soon as it's confirmed: whoever runs tournaments (reveals them at the after-party) */
  seesAwards: boolean;
  /** The free limits getting close, for Home's For admins (ADR 0059): whoever sees Usage */
  seesUsage: boolean;
  /** Whether Google has cancelled the club's email (ADR 0027), for Home's For admins: whoever looks after it */
  keepsEmail: boolean;
  /** London's evening now, its date (till 06:00, the night before's): the after-party's (ADR 0074) */
  evening: string;
}

// The viewer's columns, in the order they're bound
const VIEWER = [
  "member_id",
  "viewed_by",
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
  "sees_awards",
  "sees_usage",
  "keeps_email",
  "evening",
] as const;

const bound = (v: Viewer) => [
  v.memberId,
  v.viewedBy,
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
  Number(v.seesAwards),
  Number(v.seesUsage),
  Number(v.keepsEmail),
  v.evening,
];

/** A query's rows as one JSON array of objects, keyed by the query's column names, in the query's order. */
export const rows = (columns: string, select: string) =>
  `(SELECT json_group_array(json_object(${columns
    .trim()
    .split(/\s+/)
    .map((c) => `'${c}', "${c}"`)
    .join(", ")})) FROM (${select}))`;

// Answers come unsorted, with when each was given: entries.ts entriesFrom puts them in queue order. Sorted here they'd
// be read twice, as D1 counts rows (a sort's rows count again), on every live update of a busy night.

/** Answers to a tournament or a club event (`events`: which), as anyone but whoever runs events sees them: their own "out". */
const entries = (table: string, key: string, events: string) =>
  rows(
    "eventId memberId signup walkIn attended ahead quarterly signedUpAt id",
    `SELECT e.${key} eventId, e.member_id memberId, e.signup, 0 walkIn, NULL attended, 0 ahead, 0 quarterly,
            e.signed_up_at signedUpAt, e.id
     FROM ${table} e, viewer v
     WHERE e.${key} IN (${events})
       AND (e.signup IN ('in', 'waitlist') OR v.sees_register OR e.member_id = v.member_id)`,
  );

/** A tournament's answers as everyone who sees the club alike sees them (#178): your own out comes beside them. */
const sharedEntries = (table: string, key: string, events: string) =>
  rows(
    "eventId memberId signup walkIn attended ahead quarterly signedUpAt id",
    `SELECT e.${key} eventId, e.member_id memberId, e.signup, 0 walkIn, NULL attended, 0 ahead, 0 quarterly,
            e.signed_up_at signedUpAt, e.id
     FROM ${table} e, viewer v
     WHERE e.${key} IN (${events}) AND (e.signup IN ('in', 'waitlist') OR v.sees_register)`,
  );

/** Your own answers to these tournaments, whatever they are. */
const ownEntries = (table: string, key: string, events: string) =>
  rows(
    "eventId memberId signup walkIn attended ahead quarterly signedUpAt id",
    `SELECT e.${key} eventId, e.member_id memberId, e.signup, 0 walkIn, NULL attended, 0 ahead, 0 quarterly,
            e.signed_up_at signedUpAt, e.id
     FROM ${table} e, viewer v WHERE e.${key} IN (${events}) AND e.member_id = v.member_id`,
  );

/**
 * A training's answers (`nights`: which), as everyone who sees the club alike sees them: who's in and who's waiting, and
 * for whoever runs events everyone's out, walk-ins and no-shows too; and whether each is a Quarterly skater's on the day
 * (ADR 0131). Only the weeks shown are read, by index, then their answers: with SQLite left to choose the order it read
 * every answer ever given, and with a correlated subquery for each column, a full night's sign-ups were about eight
 * rows an answer (docs/load-testing.md). Nothing in it is anyone's own, so it can be kept at the edge (#178); each
 * member's own answers come beside it (`ownSessionEntries`), in place of theirs here.
 */
const sessionEntries = (nights: string) =>
  rows(
    "eventId memberId signup walkIn attended quarterly signedUpAt id",
    `SELECT e.session_id eventId, e.member_id memberId, e.signup,
            CASE WHEN v.sees_register THEN e.walk_in ELSE 0 END walkIn,
            CASE WHEN v.sees_register THEN e.attended END attended,
            m.position <> 'G' AND ${quarterlyOn("e.member_id", "s.held_on")} quarterly, e.signed_up_at signedUpAt, e.id
     -- In this order (a CROSS JOIN keeps it): the weeks shown, then their answers, then who answered
     FROM viewer v CROSS JOIN training_sessions s CROSS JOIN attendance e ON e.session_id = s.id
       CROSS JOIN members m ON m.id = e.member_id
     WHERE ${nights} AND (e.signup IN ('in', 'waitlist') OR v.sees_register)`,
  );

/** Your own answers to these nights, in full (your out, walk-in and no-show too): in place of yours in the shared rows. */
const ownSessionEntries = (nights: string) =>
  rows(
    "eventId memberId signup walkIn attended quarterly signedUpAt id",
    `SELECT e.session_id eventId, e.member_id memberId, e.signup, e.walk_in walkIn, e.attended,
            m.position <> 'G' AND ${quarterlyOn("e.member_id", "s.held_on")} quarterly, e.signed_up_at signedUpAt, e.id
     -- The nights by their day's index, then yours of each by the answers' (session, member) key
     FROM viewer v CROSS JOIN training_sessions s
       CROSS JOIN attendance e ON e.session_id = s.id AND e.member_id = v.member_id
       CROSS JOIN members m ON m.id = e.member_id
     WHERE ${nights}`,
  );

/** The nights Home and the app's next things show (#178): from London's evening on (till 06:00, last night's too). */
const NEXT_NIGHTS = "s.held_on >= v.evening";
/** The weeks just held (#178): a few weeks back, before London's evening. A page's, read when it's opened. */
const PAST_NIGHTS = "s.held_on >= v.sessions_from AND s.held_on < v.evening";

// The viewer first (a CROSS JOIN keeps the order), so the day picks the rows by index; left to choose, SQLite reads
// every training there has ever been and checks its day
const nightsShown = (nights: string) => `SELECT s.id FROM viewer v CROSS JOIN training_sessions s WHERE ${nights}`;
const EVENTS_SHOWN = "SELECT ce.id FROM viewer v CROSS JOIN club_events ce WHERE ce.ends_at >= v.now";

/**
 * Everyone whose dues are shown on Unpaid fees and the members' pages (ADR 0007): everyone, for who sees them; for
 * anyone else, nobody. As a list, so each member's charges and payments are found by index, not picked out of every
 * one there has ever been (ADR 0003). The viewer first: for anyone else the members aren't read at all.
 */
const CLUB_DUES = "SELECT m.id FROM viewer v CROSS JOIN members m WHERE v.sees_dues";

/** Which of a member's details a list sends, and whose rows: `mine`, private details; `seesRoles`, roles; `who`. */
interface MemberView {
  mine: string;
  seesRoles: string;
  who: string;
}

/** Members' rows as a view says (`m`: the member, `v`: the viewer). */
const memberRows = ({ mine, seesRoles, who }: MemberView) =>
  rows(
    "id name email position rating cougar status payment_reference roles bio web_name phone played quarterly quarterlyNext everyday_role_id",
    `SELECT m.id, m.name, CASE WHEN ${mine} THEN m.email END email, m.position,
            CASE WHEN v.sees_ratings THEN m.rating ELSE 0 END rating, m.cougar, m.status,
            CASE WHEN ${mine} THEN m.payment_reference END payment_reference,
            CASE WHEN ${seesRoles} THEN
              (SELECT group_concat(name) FROM (SELECT r.name FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                WHERE mr.member_id = m.id ORDER BY r.is_system DESC, r.id DESC)) END roles,
            m.bio, m.web_name, CASE WHEN ${mine} THEN m.phone END phone,
            ${playedOf("m", "v")} played,
            (${mine}) AND EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.member_id = m.id AND sub.starts_on <= v.today
              AND (sub.ends_on IS NULL OR sub.ends_on >= v.today)) quarterly,
            (${mine}) AND EXISTS (SELECT 1 FROM subscriptions sub, (SELECT date(v.today, 'start of month',
                printf('-%d months', (CAST(strftime('%m', v.today) AS INTEGER) - 1) % 3), '+3 months') day) nq
              WHERE sub.member_id = m.id AND sub.starts_on <= nq.day
                AND (sub.ends_on IS NULL OR sub.ends_on >= nq.day)) quarterlyNext,
            CASE WHEN ${seesRoles} THEN m.everyday_role_id END everyday_role_id
     FROM members m, viewer v
     WHERE ${who}
     ORDER BY m.name COLLATE NOCASE`,
  );

/** Training nights (`which`: NEXT_NIGHTS or PAST_NIGHTS), by their day's index. */
const nights = (which: string) =>
  rows(
    "id seriesId heldOn movedFrom startTime endTime venueId venue mapUrl capacity note cancelledAt offByHand offFor registerClosedAt feePence",
    `SELECT s.id, s.series_id seriesId, s.held_on heldOn, s.moved_from movedFrom, s.start_time startTime,
            s.end_time endTime, s.venue_id venueId, s.venue, s.map_url mapUrl, s.capacity, s.note,
            s.cancelled_at cancelledAt, s.called_off_at IS NOT NULL offByHand,
            -- Why it's off (#186): the tournaments it's off for, by id ("3,5"); only a night that's off has any
            CASE WHEN s.cancelled_at IS NOT NULL THEN
              (SELECT group_concat(o.tournament_id) FROM training_session_offs o WHERE o.session_id = s.id) END offFor,
            s.register_closed_at registerClosedAt, s.fee_pence feePence
     FROM viewer v CROSS JOIN training_sessions s WHERE ${which} ORDER BY s.held_on, s.id`,
  );

/** Those nights' published teams, and who's on each. */
const nightTeams = (which: string) =>
  rows(
    "sessionId teamId name memberId",
    `SELECT t.session_id sessionId, t.id teamId, t.name, p.member_id memberId
     FROM session_teams t LEFT JOIN session_team_players p ON p.team_id = t.id
     WHERE t.session_id IN (${nightsShown(which)}) ORDER BY t.position, t.id, p.rowid`,
  );

/**
 * Home's people (#178): you, who you really are while viewing as someone, and whoever's named in your next things:
 * the nights from tonight (their answers and teams), the tournaments opening the app sends (their teams, captains,
 * players, answers, award winners) and the events still to come. As many as those things hold, however big the club.
 * A test for each (`m`: the member), not one UNION of them: D1 allows five terms in a compound SELECT.
 */
const PEOPLE = `m.id IN (v.member_id, v.viewed_by)
  OR m.id IN (SELECT e.member_id FROM viewer v CROSS JOIN training_sessions s
    CROSS JOIN attendance e ON e.session_id = s.id WHERE ${NEXT_NIGHTS})
  OR m.id IN (SELECT p.member_id FROM session_teams t JOIN session_team_players p ON p.team_id = t.id
    WHERE t.session_id IN (${nightsShown(NEXT_NIGHTS)}))
  OR m.id IN (SELECT captain_member_id FROM tournament_teams WHERE tournament_id IN (SELECT id FROM shown))
  OR m.id IN (SELECT p.member_id FROM tournament_teams t JOIN tournament_team_players p ON p.team_id = t.id
    WHERE t.tournament_id IN (SELECT id FROM shown))
  OR m.id IN (SELECT member_id FROM tournament_entries WHERE tournament_id IN (SELECT id FROM shown))
  OR m.id IN (SELECT member_id FROM tournament_award_winners WHERE tournament_id IN (SELECT id FROM shown))
  OR m.id IN (SELECT member_id FROM club_event_entries WHERE event_id IN (${EVENTS_SHOWN}))`;

/**
 * Played: every game over, or an admin marked it finished (lib/edition.ts editionState, @cougars/shared/results isDone).
 * `t`: the tournament's alias.
 */
export const DONE = doneSql;

/**
 * The tournaments opening the app sends (#175, #178): Home's and the calendar's. Every one not played yet (coming up,
 * on now, its day passed unplayed), and any played in the last fortnight, for its after-party and Home's results:
 * by its day, or by when a match kicked off, so one played weeks late still has its evening (ADR 0074, #182). One
 * played early is sent, done, and the app shows it as past. The rest are a page's or history: each series' last one
 * played ("last time", LAST_PLAYED), read when its front door is opened, and the ones before, read when they're opened
 * (tournaments/editions.ts). Opening the app stays the same size however many there have been.
 */
const SHOWN_TOURNAMENTS = `SELECT t.id FROM tournaments t WHERE NOT ${DONE("t")}
    UNION SELECT t.id FROM viewer v CROSS JOIN tournaments t WHERE t.held_on >= date(v.today, '-14 days')
      OR (SELECT max(g.started_at) FROM tournament_games g WHERE g.tournament_id = t.id) >= date(v.today, '-14 days')`;
/** Each series' last one played, unless opening the app sends it anyway: its front door's "last time" (#178). */
const LAST_PLAYED = `SELECT id FROM (
    SELECT (SELECT d.id FROM tournaments d WHERE d.type_id = tt.id AND ${DONE("d")}
            ORDER BY d.held_on DESC, d.id DESC LIMIT 1) id FROM tournament_types tt)
  WHERE id IS NOT NULL AND id NOT IN (SELECT id FROM shown)`;
const SHOWN = "SELECT id FROM shown";
const LAST_SHOWN = "SELECT id FROM last_shown";

// A tournament's games, goals and penalties: nothing in them is anyone's own, so they're the same for every member,
// in the club's read and in a live match's (`readMatch`). `where`: which.
const games = (where = "") =>
  rows(
    `id tournamentId stage round position name homeTeamId awayTeamId homeSeed awaySeed homeGoals awayGoals status
     clockLeftMs clockStartedAt keeperId period periodEndedAt startedAt`,
    `SELECT id, tournament_id tournamentId, stage, round, position, name, home_team_id homeTeamId,
            away_team_id awayTeamId, home_seed homeSeed, away_seed awaySeed, home_goals homeGoals,
            away_goals awayGoals, status, clock_left_ms clockLeftMs, clock_started_at clockStartedAt,
            keeper_member_id keeperId, period, period_ended_at periodEndedAt, started_at startedAt
     FROM tournament_games ${where} ORDER BY tournament_id, position`,
  );
const goals = (where = "") =>
  rows(
    "id gameId teamId scorerId assistId atMs period",
    `SELECT id, game_id gameId, team_id teamId, scorer_member_id scorerId, assist_member_id assistId, at_ms atMs,
            period
     FROM tournament_goals ${where} ORDER BY at_ms IS NULL, period, at_ms, id`,
  );
const penalties = (where = "") =>
  rows(
    "id gameId teamId memberId minutes infraction atMs period recordedBy",
    `SELECT id, game_id gameId, team_id teamId, member_id memberId, minutes, infraction, at_ms atMs, period,
            recorded_by recordedBy
     FROM tournament_penalties ${where} ORDER BY at_ms IS NULL, period, at_ms, id`,
  );
/**
 * A team logo's version, or null for none: its length and a few characters from its middle, as a new image is all but
 * certain to change one of them. It names the logo's address (tournaments.ts logoAddress), which the browser keeps for
 * good (tournaments/editions.routes.ts): a new logo is a new address. `t`: the team's alias.
 */
export const LOGO_VERSION = (t: string) =>
  `CASE WHEN ${t}.logo IS NOT NULL THEN length(${t}.logo) || hex(substr(${t}.logo, 1 + length(${t}.logo) / 3, 6))
     || hex(substr(${t}.logo, 1 + 2 * length(${t}.logo) / 3, 6)) END`;

/** A logo this small (a generated crest, about 0.3 KB) is sent as itself: one request for each would queue (#177). */
export const SMALL_LOGO = 2048;
/**
 * A team's logo as a reply sends it: a small one as the image itself (a data URL), else its version, which names its
 * address (tournaments.ts logoAddress). `t`: the team's alias.
 */
export const LOGO_SENT = (t: string) =>
  `CASE WHEN length(${t}.logo) <= ${SMALL_LOGO} THEN ${t}.logo ELSE ${LOGO_VERSION(t)} END`;

/**
 * A set of tournaments' parts (`shown`: which, a query of their ids): Home's and the calendar's (SHOWN_TOURNAMENTS), or
 * each series' last one played, a page's (#178). Nothing in them is anyone's own but `own...`, so the rest can be kept
 * at the edge for everyone who sees the club alike.
 */
const tournamentParts = (shown: string) => ({
  tournaments: rows(
    `id typeId name venueId location mapUrl heldOn startTime endTime capacity status champions feePence season
     public signupOpensOn signupClosesOn signupClosedAt draftOn pointsWin pointsDraw pointsLoss gameMinutes penaltyRule defaultPenaltyMinutes periods breakMinutes kind awards
     playoffs draftState afterMode afterVenueId afterTime afterNote awardsRevealed awardsNext awardsConfirmedAt`,
    `SELECT t.id, t.type_id typeId, t.name, t.venue_id venueId, t.location, t.map_url mapUrl, t.held_on heldOn,
            t.start_time startTime, t.end_time endTime, t.capacity, t.status, t.champions, t.fee_pence feePence,
            t.season, t.public, t.signup_opens_on signupOpensOn,
            t.signup_closes_on signupClosesOn, t.signup_closed_at signupClosedAt, t.draft_on draftOn, t.points_win pointsWin, t.points_draw pointsDraw,
            t.points_loss pointsLoss, t.game_minutes gameMinutes, t.penalty_rule penaltyRule,
            t.default_penalty_minutes defaultPenaltyMinutes, t.periods, t.break_minutes breakMinutes, t.kind, t.awards, t.playoffs, t.draft_state draftState,
            t.after_mode afterMode, t.after_venue_id afterVenueId, t.after_time afterTime, t.after_note afterNote,
            t.awards_revealed awardsRevealed, t.awards_next awardsNext, t.awards_confirmed_at awardsConfirmedAt
     FROM tournaments t WHERE t.id IN (${shown}) ORDER BY t.held_on`,
  ),
  // In pick order (a draft) or the order they entered: the tournament's teams, and who keeps score (fixtures.ts). Each
  // logo is its version (LOGO_VERSION), not the image: the image is at an address of its own (#175); a small one is
  // sent as itself (LOGO_SENT, #177)
  tournamentTeams: rows(
    "id tournamentId name logo captainMemberId captainName contact pick",
    `SELECT t.id, t.tournament_id tournamentId, t.name, ${LOGO_SENT("t")} logo, t.captain_member_id captainMemberId,
            t.captain_name captainName, CASE WHEN v.sees_contacts THEN t.contact ELSE '' END contact, t.pick
     FROM viewer v CROSS JOIN tournament_teams t WHERE t.tournament_id IN (${shown})
     ORDER BY t.tournament_id, coalesce(t.pick, 1000), t.id`,
  ),
  tournamentPlayers: rows(
    "teamId memberId name pick pickedBy",
    `SELECT team_id teamId, member_id memberId, name, pick_number pick, picked_by pickedBy FROM tournament_team_players
     WHERE team_id IN (SELECT id FROM tournament_teams WHERE tournament_id IN (${shown}))
     ORDER BY team_id, coalesce(pick_number, position), id`,
  ),
  games: games(`WHERE tournament_id IN (${shown})`),
  goals: goals(`WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id IN (${shown}))`),
  penalties: penalties(`WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id IN (${shown}))`),
  // Who won each award (ADR 0044). On its evening an award's winner is a surprise until it's revealed at the
  // after-party (ADR 0074): only whoever runs tournaments is sent it before then
  winners: rows(
    "tournamentId award teamId memberId title",
    `SELECT w.tournament_id tournamentId, w.award, w.team_id teamId, w.member_id memberId, w.title
     FROM viewer v CROSS JOIN tournament_award_winners w JOIN tournaments t ON t.id = w.tournament_id
     WHERE w.tournament_id IN (${shown})
       AND (v.sees_awards OR t.season IS NOT NULL OR t.held_on <> v.evening OR ${REVEAL_PLACE} < t.awards_revealed)
     ORDER BY w.tournament_id, w.position`,
  ),
  // Which awards were given, and the judges' call's name tonight (ADR 0044): everyone's once the awards are confirmed,
  // before they're revealed (the sealed card says the name; a judges' call left out isn't revealed at all, lib/awards
  // awardsToReveal); who won each waits for the reveal
  awardTitles: rows(
    "tournamentId award title",
    `SELECT tournament_id tournamentId, award, MAX(title) title FROM tournament_award_winners
     WHERE tournament_id IN (${shown}) GROUP BY tournament_id, award`,
  ),
  // A voted award's votes (ADR 0044): how many are in; the one this member cast comes beside it (ownVotes). Who voted
  // for whom is never sent
  votes: rows(
    "tournamentId award cast mine",
    `SELECT x.tournament_id tournamentId, x.award, COUNT(*) "cast",
            NULL mine
     FROM tournament_award_votes x WHERE x.tournament_id IN (${shown})
     GROUP BY x.tournament_id, x.award`,
  ),
  tournamentEntries: sharedEntries("tournament_entries", "tournament_id", shown),
  // Your own answers and votes, beside the shared ones (#178)
  ownTournamentEntries: ownEntries("tournament_entries", "tournament_id", shown),
  ownVotes: rows(
    "tournamentId award mine",
    `SELECT x.tournament_id tournamentId, x.award, x.candidate_member_id mine
     FROM viewer v CROSS JOIN tournament_award_votes x
     WHERE x.tournament_id IN (${shown}) AND x.voter_member_id = v.member_id`,
  ),
});

type TournamentPart = keyof ReturnType<typeof tournamentParts>;
/** Each series' last one played's parts, named `last...` (lastTournaments, lastGames, ...). */
const LAST = (part: TournamentPart) =>
  `last${part[0].toUpperCase()}${part.slice(1)}` as `last${Capitalize<TournamentPart>}`;
const lastPlayedParts = () =>
  Object.fromEntries(
    Object.entries(tournamentParts(LAST_SHOWN)).map(([part, sql]) => [LAST(part as TournamentPart), sql]),
  ) as Record<`last${Capitalize<TournamentPart>}`, string>;
export { LAST as lastPart };

const PARTS = {
  everydayRole: "json_array((SELECT m.everyday_role_id FROM members m, viewer v WHERE m.id = v.member_id))",
  // Everyone, as everyone who sees the club alike sees them (#178): the same for all of a role, so it's kept at the
  // edge. Your own private details aren't in it, unless you see everyone's: they're in Home's `people`
  members: memberRows({
    mine: "v.sees_private",
    seesRoles: "v.sees_roles",
    who: "v.sees_private OR m.status = 'active'",
  }),
  // Home's people (#178): you, in full; who you really are, while viewing as someone; and whoever is in your next
  // things (the nights from tonight, the tournaments and events opening the app sends), their names and cards
  people: memberRows({
    mine: "m.id = v.member_id",
    seesRoles: "m.id = v.member_id",
    who: `(${PEOPLE}) AND (m.id IN (v.member_id, v.viewed_by) OR v.sees_private OR m.status = 'active')`,
  }),
  roles: rows("id name description is_system", "SELECT id, name, description, is_system FROM roles ORDER BY id"),
  roleActions: rows("role_id action", "SELECT role_id, action FROM role_actions"),
  venues: rows(
    "id name address mapUrl active",
    "SELECT id, name, address, map_url mapUrl, active FROM venues ORDER BY name",
  ),
  series: rows(
    `id slug name short_name icon tone repeat_every weekdays starts_on ends_on start_time end_time venue_id venue
     map_url capacity goalie_capacity signup_closes_mins signup_opens_days public active`,
    "SELECT * FROM training_series ORDER BY id",
  ),
  // The nights from tonight, Home's and the next night's (#178); the weeks just held are a page's (pastSessions)
  sessions: nights(NEXT_NIGHTS),
  pastSessions: nights(PAST_NIGHTS),
  // A training's fee, from each date (ADR 0007)
  seriesFees: rows(
    "seriesId pence from",
    `SELECT series_id seriesId, amount_pence pence, effective_from "from" FROM series_fees
     ORDER BY series_id, effective_from`,
  ),
  sessionEntries: sessionEntries(NEXT_NIGHTS),
  ownSessionEntries: ownSessionEntries(NEXT_NIGHTS),
  sessionTeams: nightTeams(NEXT_NIGHTS),
  pastSessionEntries: sessionEntries(PAST_NIGHTS),
  pastOwnSessionEntries: ownSessionEntries(PAST_NIGHTS),
  pastSessionTeams: nightTeams(PAST_NIGHTS),
  tournamentTypes: rows(
    `id slug name short_name icon tone format points_win points_draw points_loss game_minutes penalty_rule default_penalty_minutes periods break_minutes kind active
     default_fee_pence default_start_time default_end_time awards playoffs venue_id location map_url after_venue_id after_time
     after_note house_rules`,
    "SELECT * FROM tournament_types ORDER BY id",
  ),
  ...tournamentParts(SHOWN),
  ...lastPlayedParts(),
  clubEvents: rows(
    "id title startsAt endsAt venueId venue mapUrl description public signup capacity cancelledAt",
    `SELECT ce.id, ce.title, ce.starts_at startsAt, ce.ends_at endsAt, ce.venue_id venueId, ce.venue,
            ce.map_url mapUrl, ce.description, ce.public, ce.signup_enabled signup, ce.capacity,
            ce.cancelled_at cancelledAt
     FROM viewer v CROSS JOIN club_events ce WHERE ce.ends_at >= v.now ORDER BY ce.starts_at`,
  ),
  eventEntries: entries("club_event_entries", "event_id", EVENTS_SHOWN),
  // Dues (ADR 0007, #177): your own charges with something left to pay (Home, your tab's header), found by index; the
  // rest of your ledger is read a page at a time (dues.ledger.ts)
  charges: rows(CHARGE_COLUMNS, chargeSelect(`c.member_id = (SELECT member_id FROM viewer) AND ${OWING("c")}`)),
  // What each owes, by age, and their credit: your own, or everyone's for who sees Unpaid fees, worked out here from
  // the charges not paid and the payments not spent, so it's the same size however long the club's been charging
  dues: rows(OWED_COLUMNS, owedSelect("SELECT member_id FROM viewer", "(SELECT today FROM viewer)")),
  // Everyone's, for who sees Unpaid fees (a page's, #178); anyone else, none (their own is `dues`)
  clubDues: rows(OWED_COLUMNS, owedSelect(CLUB_DUES, "(SELECT today FROM viewer)")),
  // What the club is owed in all, for an admin's Home: the total, by how many, and how much is over 90 days
  owedInAll: rows(
    "total people worst",
    `SELECT SUM(owed) total, COUNT(*) people, SUM(a3) worst
     FROM (${owedSelect(CLUB_DUES, "(SELECT today FROM viewer)")}) WHERE owed > 0`,
  ),
  // Who's asking to join, for Home's For admins: whoever manages members
  asking: rows(
    "name",
    `SELECT m.name FROM viewer v CROSS JOIN members m WHERE v.sees_private AND m.status = 'pending'
     ORDER BY m.name COLLATE NOCASE`,
  ),
  subscriptionFees: rows(
    "pence from",
    `SELECT amount_pence pence, effective_from "from" FROM subscription_fees ORDER BY effective_from`,
  ),
  quips: rows("id kind text", "SELECT id, kind, text FROM quips ORDER BY id"),
  // Home's announcements (#85): the two newest still on, less any this member dismissed
  announcements: rows(
    "id title body link endsOn createdAt",
    `SELECT a.id, a.title, a.body, a.link, a.ends_on endsOn, a.created_at createdAt FROM announcements a, viewer v
     WHERE a.ends_on >= v.today
       AND NOT EXISTS (SELECT 1 FROM announcement_dismissals d WHERE d.announcement_id = a.id AND d.member_id = v.member_id)
     ORDER BY a.created_at DESC, a.id DESC LIMIT 2`,
  ),
  settings: rows(
    "live_refresh_seconds bank_name bank_sort_code bank_account plan_reminder_days",
    "SELECT live_refresh_seconds, bank_name, bank_sort_code, bank_account, plan_reminder_days FROM club_settings WHERE id = 1",
  ),
  // What this member chooses to hear on their phone (ADR 0108): the topics they've switched
  notifications: rows(
    "topic enabled",
    "SELECT p.topic, p.enabled FROM notification_prefs p, viewer v WHERE p.member_id = v.member_id",
  ),
  // When each member was last reminded of what they owe (ADR 0007), for who sees everyone's dues
  reminders: rows(
    "memberId at",
    `SELECT r.member_id memberId, MAX(COALESCE(r.sent_at, r.claimed_at)) at FROM dues_reminders r, viewer v
     WHERE v.sees_dues GROUP BY r.member_id`,
  ),
  // The free limits at 70% or more as the hourly check found them (usage.levels.ts), for whoever sees Usage
  usageLevels: rows(
    "id period label percent",
    `SELECT u.metric id, u.period, u.label, u.percent FROM usage_levels u, viewer v WHERE v.sees_usage
     ORDER BY u.percent DESC, u.metric`,
  ),
  // Why the club's email is failing, if it is (mail_health, ADR 0027), for whoever looks after it
  mailFailure: rows("failure", "SELECT h.failure FROM mail_health h, viewer v WHERE h.id = 1 AND v.keeps_email"),
  // What's on (ADR 0042): from London's evening (last night's, till 06:00: its register's still open), and the day of
  // a tournament not played yet whose day has gone by, which is still next (ADR 0074, #182). The app decides by each
  // thing's status what's past (lib/phase.ts). A draft night is for whoever runs the draft and that tournament's
  // captains.
  agenda: rows(
    `source source_id kind group_key title starts_at ends_at day all_day date_tbc season venue map_url description
     public cancelled audience`,
    `SELECT a.* FROM viewer v CROSS JOIN agenda a
     WHERE a.day >= v.evening
       AND (a.audience <> 'captains' OR v.runs_draft OR (a.source = 'tournament' AND a.source_id IN
             (SELECT tournament_id FROM tournament_teams WHERE captain_member_id = v.member_id)))
     UNION ALL
     SELECT a.* FROM viewer v CROSS JOIN tournaments t
       CROSS JOIN agenda a ON a.day = t.held_on AND a.source = 'tournament' AND a.source_id = t.id
     WHERE t.held_on < v.evening AND a.kind = 'tournament' AND NOT ${DONE("t")}
     ORDER BY starts_at, id`,
  ),
} as const;

export type Part = keyof typeof PARTS;

/** Each part's rows. Loosely typed: each domain module's shaping says what its rows are. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Parts = Record<Part, any[]>;

/**
 * What's someone's own, or depends on the moment (`now`), so never kept at the edge for others (#178): everything
 * else is the same for everyone who sees the club alike (the viewer's flags and the day). A part that reads who's
 * asking (`v.member_id`, `v.viewed_by`, `v.now`, the viewer's member) must be here: a test holds it to that.
 */
export const OWN: ReadonlySet<Part> = new Set<Part>([
  "everydayRole",
  "people",
  "ownSessionEntries",
  "pastOwnSessionEntries",
  "ownTournamentEntries",
  "ownVotes",
  "lastOwnTournamentEntries",
  "lastOwnVotes",
  "clubEvents",
  "eventEntries",
  "charges",
  "dues",
  "announcements",
  "notifications",
  "agenda",
]);

/** A shared part's rows with someone's own beside them: which part they're in, and how each goes in. */
interface Overlay {
  own: Part;
  /** What a row is: an own row takes the place of the shared one with the same key. */
  key: (row: Record<string, unknown>) => string;
  /** How an own row goes into the shared one it matches (default: in its place). */
  merge?: (shared: Record<string, unknown>, own: Record<string, unknown>) => Record<string, unknown>;
}
const byId = (row: Record<string, unknown>) => String(row.id);
const byAward = (row: Record<string, unknown>) => `${row.tournamentId}:${row.award}`;
const yourVote = (shared: Record<string, unknown>, own: Record<string, unknown>) => ({ ...shared, mine: own.mine });

/** Each shared part that has someone's own rows beside it (#178): their answers in full, the vote they cast. */
const OVERLAYS: Partial<Record<Part, Overlay>> = {
  sessionEntries: { own: "ownSessionEntries", key: byId },
  pastSessionEntries: { own: "pastOwnSessionEntries", key: byId },
  tournamentEntries: { own: "ownTournamentEntries", key: byId },
  votes: { own: "ownVotes", key: byAward, merge: yourVote },
  lastTournamentEntries: { own: "lastOwnTournamentEntries", key: byId },
  lastVotes: { own: "lastOwnVotes", key: byAward, merge: yourVote },
};

/** The shared rows with the member's own in place. */
function overlaid(shared: Record<string, unknown>[], own: Record<string, unknown>[], overlay: Overlay) {
  const mine = new Map(own.map((row) => [overlay.key(row), row]));
  const out = shared.map((row) => {
    const theirs = mine.get(overlay.key(row));
    if (!theirs) return row;
    mine.delete(overlay.key(row));
    return overlay.merge ? overlay.merge(row, theirs) : theirs;
  });
  return overlay.merge ? out : [...out, ...mine.values()];
}

/** Where the shared parts of a read are kept (api.edge.ts): asked first, and given what D1 read when they weren't. */
export interface EdgeRead {
  get(parts: readonly Part[]): Promise<Partial<Parts> | null>;
  put(parts: readonly Part[], rows: Partial<Parts>): void;
}

/**
 * The parts asked for, as this viewer may see them, in one statement, with the viewer's own rows in place in the
 * shared ones (OVERLAYS). `tournament`: that one's parts alone, whatever it is (a past one opened,
 * tournaments/editions.ts), in place of the ones the club read sends (SHOWN_TOURNAMENTS). `edge`: where the shared
 * parts are kept, so only what's this member's own is read from D1 when they're there (#178).
 */
export async function readClub(
  db: D1Database,
  viewer: Viewer,
  parts: readonly Part[],
  tournament?: number,
  edge?: EdgeRead,
): Promise<Parts> {
  const wanted = [...new Set([...parts, ...parts.flatMap((p) => OVERLAYS[p]?.own ?? [])])];
  const shared = wanted.filter((p) => !OWN.has(p));
  const kept = edge && shared.length ? await edge.get(shared) : null;
  const read = await statement(db, viewer, kept ? wanted.filter((p) => OWN.has(p)) : wanted, tournament);
  if (edge && shared.length && !kept) edge.put(shared, Object.fromEntries(shared.map((p) => [p, read[p]])));
  const all = { ...kept, ...read } as Parts;
  for (const p of parts) {
    const overlay = OVERLAYS[p];
    if (overlay) all[p] = overlaid(all[p], all[overlay.own], overlay);
  }
  return all;
}

/** The parts, read in one statement; none, no round trip. */
async function statement(db: D1Database, viewer: Viewer, parts: readonly Part[], tournament?: number) {
  if (!parts.length) return {} as Partial<Parts>;
  const shown = tournament === undefined ? SHOWN_TOURNAMENTS : "VALUES (?)";
  const sql = `WITH viewer (${VIEWER.join(", ")}) AS (VALUES (${VIEWER.map(() => "?").join(", ")})),
      shown (id) AS MATERIALIZED (${shown}),
      last_shown (id) AS MATERIALIZED (${LAST_PLAYED})
    SELECT ${parts.map((p) => `${PARTS[p]} AS "${p}"`).join(",\n")}`;
  const row = await db
    .prepare(sql)
    .bind(...bound(viewer), ...(tournament === undefined ? [] : [tournament]))
    .first<Record<Part, string>>();
  return Object.fromEntries(parts.map((p) => [p, JSON.parse(row![p])])) as Partial<Parts>;
}

/** Every part and its SQL, for the test that what reads who's asking is never shared. */
export const partsSql = () => Object.entries(PARTS) as [Part, string][];

/** One tournament's games, goals and penalties, and its teams in pick order (who keeps score, fixtures.ts). */
export interface MatchRows {
  games: Parts["games"];
  goals: Parts["goals"];
  penalties: Parts["penalties"];
  teams: { id: number; tournamentId: number }[];
}

/**
 * A live match (ADR 0072, #161): one tournament's games as every member sees them, read with no viewer since nothing
 * in them is anyone's own, in one statement; null when the tournament isn't on (under way: lib/phase.ts), whatever its
 * date: one played early is live, a result put right once it's all played isn't (ADR 0074, #182).
 */
export async function readMatch(db: D1Database, tournamentId: number): Promise<MatchRows | null> {
  const ofGames = "WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id = ?)";
  const teams = rows(
    "id tournamentId",
    `SELECT id, tournament_id tournamentId FROM tournament_teams WHERE tournament_id = ?
     ORDER BY coalesce(pick, 1000), id`,
  );
  // Each ? in turn: whether it's on, then the games, goals, penalties and teams of this tournament
  const row = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM tournaments t WHERE t.id = ? AND NOT ${DONE("t")}
                AND (t.status = 'live' OR EXISTS (SELECT 1 FROM tournament_games g
                  WHERE g.tournament_id = t.id AND g.status <> 'next'))) "on",
              ${games("WHERE tournament_id = ?")} games, ${goals(ofGames)} goals, ${penalties(ofGames)} penalties,
              ${teams} teams`,
    )
    .bind(tournamentId, tournamentId, tournamentId, tournamentId, tournamentId)
    .first<Record<"on" | "games" | "goals" | "penalties" | "teams", string | number>>();
  if (!row?.on) return null;
  const parsed = (k: "games" | "goals" | "penalties" | "teams") => JSON.parse(String(row[k]));
  return { games: parsed("games"), goals: parsed("goals"), penalties: parsed("penalties"), teams: parsed("teams") };
}
