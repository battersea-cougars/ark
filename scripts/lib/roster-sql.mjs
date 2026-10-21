// The website roster's query (scripts/club-snapshot.mjs, ADR 0043): active Cougars and their record.
// Stats count what's been played (signed up in, not marked a no-show, not cancelled), as the team app does.
const PLAYED = `a.signup = 'in' AND COALESCE(a.attended, 1) = 1`;
// A tournament on the website (ADR 0100, packages/shared/results.ts isDone): public, and marked finished or every game played.
// Goals and penalty minutes count from played games only, as on its result.
const PUBLISHED = `t.public = 1 AND (t.status = 'finished' OR (
    EXISTS (SELECT 1 FROM tournament_games x WHERE x.tournament_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM tournament_games x WHERE x.tournament_id = t.id AND x.status <> 'done')))`;
const GOALS = `FROM tournament_goals o JOIN tournament_games g ON g.id = o.game_id AND g.status = 'done'
      JOIN tournaments t ON t.id = g.tournament_id AND ${PUBLISHED}`;
// Penalty minutes (PIM, ADR 0061) the same way: played games of tournaments on the website
const PENALTIES = `FROM tournament_penalties o JOIN tournament_games g ON g.id = o.game_id AND g.status = 'done'
      JOIN tournaments t ON t.id = g.tournament_id AND ${PUBLISHED}`;
export const ROSTER_SQL = `SELECT m.id, m.name, m.web_name, m.position, m.bio,
    (SELECT COUNT(*) FROM attendance a JOIN training_sessions s ON s.id = a.session_id
      WHERE a.member_id = m.id AND ${PLAYED} AND s.cancelled_at IS NULL AND s.held_on < date('now')) sessions,
    (SELECT COUNT(*) FROM attendance a JOIN training_sessions s ON s.id = a.session_id
      WHERE a.member_id = m.id AND ${PLAYED} AND s.cancelled_at IS NULL AND s.held_on < date('now')
        AND s.held_on >= strftime('%Y-01-01', 'now')) season,
    (SELECT COUNT(*) FROM tournament_entries a JOIN tournaments t ON t.id = a.tournament_id
      WHERE a.member_id = m.id AND ${PLAYED} AND t.held_on < date('now')) tournaments,
    (SELECT COUNT(*) ${GOALS} WHERE o.scorer_member_id = m.id) goals,
    (SELECT COUNT(*) ${GOALS} WHERE o.assist_member_id = m.id) assists,
    (SELECT COALESCE(SUM(o.minutes), 0) ${PENALTIES} WHERE o.member_id = m.id) pim,
    -- Titles: on the team an admin confirmed as Champions (ADR 0044), as captain or player
    (SELECT COUNT(DISTINCT w.tournament_id) FROM tournament_award_winners w
      JOIN tournaments t ON t.id = w.tournament_id AND ${PUBLISHED}
      JOIN tournament_teams x ON x.id = w.team_id
      WHERE w.award = 'Champions' AND (x.captain_member_id = m.id
        OR EXISTS (SELECT 1 FROM tournament_team_players p WHERE p.team_id = x.id AND p.member_id = m.id))) titles
  FROM members m WHERE m.status = 'active' AND m.cougar = 1
  ORDER BY m.name COLLATE NOCASE`;
