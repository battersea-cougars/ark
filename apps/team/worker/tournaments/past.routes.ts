// A past one recorded (ADR 0126): an admin puts in a Kumite the club played before the app, done and in history.
import { rowOf, type Route } from "../api/api.route";
import { body, json } from "../api/api.http";
import { recordPast } from "./past";

export const PAST_ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/tournaments\/past$/,
    // What went in: its name and day, its teams, matches, goals and awards given (nothing before: it's new)
    audit: {
      event: "tournament.recorded",
      subject: rowOf(
        `SELECT t.id, t.name, t.held_on heldOn,
                (SELECT COUNT(*) FROM tournament_teams WHERE tournament_id = t.id) teams,
                (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = t.id) games,
                (SELECT COUNT(*) FROM tournament_goals WHERE game_id IN
                  (SELECT id FROM tournament_games WHERE tournament_id = t.id)) goals,
                (SELECT COUNT(*) FROM tournament_award_winners WHERE tournament_id = t.id) winners
         FROM tournaments t WHERE t.id = ?`,
      ),
    },
    action: "manage:Tournament",
    changes: ["tournaments"],
    // { typeId, name, heldOn, teams: [{ name, captainMemberId, players }], games: [{ home, away, homeGoals,
    // awayGoals, final?, scorers? }], winners: [{ award, team | memberId, title? }] }
    handle: async (c) => json(await recordPast(c.env.DB, await body(c.request), c.today, c.now), 201),
  },
];
