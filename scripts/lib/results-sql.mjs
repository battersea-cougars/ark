// The website's tournament results (ADR 0100): what the build's snapshot (scripts/club-snapshot.mjs) reads from D1,
// as rows. The website works the results out from them (apps/web/src/lib/results.ts), by the shared rules
// (@cougars/shared/results). Every public tournament comes back; which are done is decided there. The rows hold full
// names: they stay in the gitignored snapshot, and only the name each player chose reaches a page.
const PUBLIC = "SELECT id FROM tournaments WHERE public = 1";

export const RESULTS_SQL = {
  tournaments: `SELECT t.id, t.name, t.held_on heldOn, t.status, t.season, t.awards, t.points_win pointsWin,
      t.points_draw pointsDraw, t.points_loss pointsLoss, y.slug seriesSlug, y.name seriesName
    FROM tournaments t LEFT JOIN tournament_types y ON y.id = t.type_id
    WHERE t.public = 1 ORDER BY t.held_on DESC, t.id DESC`,
  games: `SELECT id, tournament_id tournamentId, stage, name, position, home_team_id homeTeamId,
      away_team_id awayTeamId, home_goals homeGoals, away_goals awayGoals, status
    FROM tournament_games WHERE tournament_id IN (${PUBLIC}) ORDER BY position`,
  teams: `SELECT x.id, x.tournament_id tournamentId, x.name, x.logo, m.name captainName, m.web_name captainWebName,
      x.captain_name outsideCaptain
    FROM tournament_teams x LEFT JOIN members m ON m.id = x.captain_member_id
    WHERE x.tournament_id IN (${PUBLIC}) ORDER BY COALESCE(x.pick, 0), x.id`,
  players: `SELECT p.team_id teamId, m.name, m.web_name webName, p.name outsideName
    FROM tournament_team_players p JOIN tournament_teams x ON x.id = p.team_id
    LEFT JOIN members m ON m.id = p.member_id
    WHERE x.tournament_id IN (${PUBLIC}) ORDER BY p.position, p.id`,
  goals: `SELECT g.tournament_id tournamentId, o.team_id teamId,
      s.id scorerId, s.name scorerName, s.web_name scorerWebName,
      a.id assistId, a.name assistName, a.web_name assistWebName
    FROM tournament_goals o JOIN tournament_games g ON g.id = o.game_id
    LEFT JOIN members s ON s.id = o.scorer_member_id LEFT JOIN members a ON a.id = o.assist_member_id
    WHERE g.tournament_id IN (${PUBLIC}) AND g.status = 'done'`,
  // Penalties (ADR 0061): a game's minutes a side, a player's beside their goals. Only who and how long: what for
  // and when stay in the app
  penalties: `SELECT g.tournament_id tournamentId, o.game_id gameId, o.team_id teamId, m.id memberId,
      m.name memberName, m.web_name memberWebName, o.minutes
    FROM tournament_penalties o JOIN tournament_games g ON g.id = o.game_id
    LEFT JOIN members m ON m.id = o.member_id
    WHERE g.tournament_id IN (${PUBLIC}) AND g.status = 'done'`,
  winners: `SELECT w.tournament_id tournamentId, w.award, w.team_id teamId, m.name memberName,
      m.web_name memberWebName
    FROM tournament_award_winners w LEFT JOIN members m ON m.id = w.member_id
    WHERE w.tournament_id IN (${PUBLIC}) ORDER BY w.award, w.position`,
};

/** Every query's rows, by name, through `query` (sql → rows): the snapshot's D1, or a test's. */
export async function readResultRows(query) {
  const names = Object.keys(RESULTS_SQL);
  const rows = await Promise.all(names.map((n) => query(RESULTS_SQL[n])));
  return Object.fromEntries(names.map((n, i) => [n, rows[i]]));
}
