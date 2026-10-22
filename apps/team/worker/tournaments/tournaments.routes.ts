// Tournaments (ADR 0030, ADR 0060, ADR 0074): types and editions, their teams, fixtures and winners.
import { movedUp } from "../push/push.notices";
import { can } from "../../src/access/actions";
import { id, memberIdIn, ok, rowOf, rowsOf, type Route } from "../api/api.route";
import { revealAward, setWinners } from "./awards";
import { putOnTeam, takeOffTeam } from "./draft";
import { FIXTURES_TALLY, clearFixtures, makeFixtures } from "./fixtures";
import { backFromIn, stepBack, whereItIs } from "./step-back";
import { awardsOut, draftPaused } from "../push/push.notices";
import { londonToday } from "../../src/lib/dates";
import { body, json } from "../api/api.http";
import {
  createTournament,
  createTournamentType,
  deleteTournament,
  setTeamLook,
  tournamentSummary,
  updateTournament,
  updateTournamentType,
} from "./tournaments";

export const TOURNAMENTS_ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/tournament-types$/,
    audit: {
      event: "tournament_series.created",
      subject: rowOf(
        "SELECT id, name, short_name shortName, kind, active, default_fee_pence defaultFeePence, format, awards, playoffs FROM tournament_types WHERE id = ?",
      ),
    },
    action: "manage:Tournament",
    changes: ["tournamentTypes"],
    handle: async (c) => json(await createTournamentType(c.env.DB, await body(c.request)), 201),
  },
  {
    method: "PUT",
    path: /^\/api\/tournament-types\/(\d+)$/,
    audit: {
      event: "tournament_series.updated",
      subject: rowOf(
        "SELECT id, name, short_name shortName, kind, active, default_fee_pence defaultFeePence, format, awards, playoffs FROM tournament_types WHERE id = ?",
      ),
    },
    action: "manage:Tournament",
    changes: ["tournamentTypes"],
    handle: async (c) => (await updateTournamentType(c.env.DB, id(c), await body(c.request)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments$/,
    audit: {
      event: "tournament.created",
      subject: rowOf(
        "SELECT id, name, held_on heldOn, season, status, fee_pence feePence, capacity, public, kind, signup_opens_on signupOpensOn, signup_closes_on signupClosesOn, draft_on draftOn, venue_id venueId, location FROM tournaments WHERE id = ?",
      ),
    },
    action: "manage:Tournament",
    // A Kumite team renamed here is its captain's default name for the next one (team-name.ts): members too
    changes: ["tournaments", "charges", "credits", "payments", "members"],
    // Up to 16 teams, each with a logo (200 KB at most)
    maxBody: 4 * 1024 * 1024,
    handle: async (c) => json(await createTournament(c.env.DB, await body(c.request)), 201),
  },
  {
    method: "PUT",
    path: /^\/api\/tournaments\/(\d+)$/,
    audit: {
      event: "tournament.updated",
      subject: rowOf(
        "SELECT id, name, held_on heldOn, season, status, fee_pence feePence, capacity, public, kind, signup_opens_on signupOpensOn, signup_closes_on signupClosesOn, draft_on draftOn, venue_id venueId, location FROM tournaments WHERE id = ?",
      ),
    },
    action: "manage:Tournament",
    // A Kumite team renamed here is its captain's default name for the next one (team-name.ts): members too
    changes: ["tournaments", "charges", "credits", "payments", "members"],
    // Up to 16 teams, each with a logo (200 KB at most)
    maxBody: 4 * 1024 * 1024,
    // A limit raised lets the first waiting in, and they hear it
    notify: movedUp,
    handle: async (c) => (await updateTournament(c.env.DB, id(c), await body(c.request), c.today, c.now), ok()),
  },
  {
    method: "DELETE",
    path: /^\/api\/tournaments\/(\d+)$/,
    audit: { event: "tournament.deleted", subject: (c) => tournamentSummary(c.env.DB, id(c)) },
    action: "manage:Tournament",
    changes: ["tournaments", "charges", "credits", "payments"],
    // Gone, with its teams, sign-ups, games, awards and charges (Settings → Tournaments)
    handle: async (c) => (await deleteTournament(c.env.DB, id(c)), ok()),
  },
  {
    method: "PUT",
    path: /^\/api\/tournaments\/(\d+)\/winners$/,
    audit: {
      event: "tournament.winners",
      subject: rowsOf(
        "SELECT award, team_id teamId, member_id memberId, position FROM tournament_award_winners WHERE tournament_id = ? ORDER BY award, position",
      ),
    },
    action: "manage:Tournament",
    changes: ["tournaments"],
    // { winners: [{ award, teamId | memberId }] }: who won the tournament's awards (ADR 0044)
    handle: async (c) => (await setWinners(c.env.DB, id(c), await body(c.request)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/awards\/reveal$/,
    // How many are out, and the one just revealed
    audit: {
      event: "tournament.award_revealed",
      subject: rowOf(
        `SELECT id, name, awards_revealed revealed,
                CASE WHEN awards_revealed > 0 THEN json_extract(awards, '$[' || (awards_revealed - 1) || '].name') END award
         FROM tournaments WHERE id = ?`,
      ),
    },
    action: "manage:Tournament",
    // Everyone watching the after-party sees it turn over (ADR 0072)
    changes: ["tournaments"],
    calendar: false,
    // The first one out: everyone hears the awards are on
    notify: awardsOut,
    // { next }: the award it reveals, by its place in the list, the one the tap saw face down (ADR 0074)
    handle: async (c) => (await revealAward(c.env.DB, id(c), await body(c.request)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/fixtures$/,
    audit: {
      event: "fixtures.made",
      subject: rowOf(
        "SELECT COUNT(*) games, COALESCE(SUM(status = 'done'), 0) played FROM tournament_games WHERE tournament_id = ?",
      ),
    },
    action: "manage:Tournament",
    changes: ["tournaments"],
    // The round robin and its playoffs, once the teams are set (ADR 0061)
    handle: async (c) => (await makeFixtures(c.env.DB, id(c)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/step-back$/,
    // Where it was and where it is: the step, and the picks, order, matches, results and goals each side
    audit: {
      event: "tournament.stepped_back",
      subject: (c) => whereItIs(c.env.DB, id(c), londonToday(new Date(c.now))),
    },
    // An admin, or whoever runs the draft for the draft's own steps: step-back.ts decides
    action: "authenticated",
    changes: ["tournaments"],
    // A draft that was open and isn't: its captains hear it's paused
    notify: draftPaused,
    // { from }: the step it's leaving (lib/step-back.ts), refused if it's moved on (ADR 0074)
    handle: async (c) => {
      await stepBack(c.env.DB, id(c), backFromIn(await body(c.request)), c, c.now);
      return ok();
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/tournaments\/(\d+)\/fixtures$/,
    // What went: the matches, results and goals before (and none after)
    audit: {
      event: "fixtures.cleared",
      subject: rowOf(`SELECT t.id, t.name, ${FIXTURES_TALLY} FROM tournaments t WHERE t.id = ?`),
    },
    action: "manage:Tournament",
    changes: ["tournaments"],
    // The fixtures, results and all, cleared to be made again (ADR 0061); the draft stays as it is
    handle: async (c) => (await clearFixtures(c.env.DB, id(c)), ok()),
  },
  {
    method: "PUT",
    path: /^\/api\/tournaments\/(\d+)\/teams\/(\d+)\/look$/,
    audit: { none: "a team's look (its name, colour and crest), its captain's to change; an admin may too" },
    // Its captain or an admin: setTeamLook decides
    action: "authenticated",
    // A Kumite team's name is its captain's default for the next one too (team-name.ts)
    changes: ["tournaments", "members"],
    handle: async (c) => {
      const admin = can(c.actions, "manage:Tournament");
      await setTeamLook(c.env.DB, id(c), Number(c.params[1]), { memberId: c.memberId, admin }, await body(c.request));
      return ok();
    },
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/teams\/(\d+)\/players$/,
    audit: {
      event: "team.players",
      subject: rowsOf(
        "SELECT member_id memberId, name, position FROM tournament_team_players WHERE team_id = ? ORDER BY position, id",
        (c) => Number(c.params[1]),
      ),
    },
    action: "manage:Tournament",
    changes: ["tournaments"],
    // A replacement, outside the draft: onto this team (from another, or from outside the tournament)
    handle: async (c) => {
      const { memberId } = await memberIdIn(c);
      await putOnTeam(c.env.DB, id(c), Number(c.params[1]), memberId, c.now);
      return ok();
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/tournaments\/(\d+)\/teams\/(\d+)\/players\/(\d+)$/,
    audit: {
      event: "team.players",
      subject: rowsOf(
        "SELECT member_id memberId, name, position FROM tournament_team_players WHERE team_id = ? ORDER BY position, id",
        (c) => Number(c.params[1]),
      ),
    },
    action: "manage:Tournament",
    changes: ["tournaments"],
    // Off the team, still signed up
    handle: async (c) => (await takeOffTeam(c.env.DB, id(c), Number(c.params[1]), Number(c.params[2])), ok()),
  },
];
