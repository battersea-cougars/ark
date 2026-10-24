// When two captains' sides last met (the matchup page, #177): the past editions of the game's series where both
// captains were on a team, as captain or player, with their teams and played games, newest first. The app picks out
// the games with one on each side (lib/matchups.ts meetings); it no longer has every past edition to look through.
import { rows } from "../api/api.club";

/** How many past editions with both in: more than the page's five meetings could need. */
const EDITIONS = 20;

/** The editions where this game's two captains last both played, for its matchup; empty if it has no series. */
export async function pastMeetings(db: D1Database, gameId: number) {
  const on = (who: string) => `EXISTS (SELECT 1 FROM tournament_teams tt
      LEFT JOIN tournament_team_players p ON p.team_id = tt.id
    WHERE tt.tournament_id = t.id AND (tt.captain_member_id = g.${who} OR p.member_id = g.${who}))`;
  const sql = `WITH g AS MATERIALIZED (
      SELECT x.tournament_id tid, t.type_id typeId, h.captain_member_id a, w.captain_member_id b
      FROM tournament_games x JOIN tournaments t ON t.id = x.tournament_id
        JOIN tournament_teams h ON h.id = x.home_team_id JOIN tournament_teams w ON w.id = x.away_team_id
      WHERE x.id = ?),
    past (id) AS MATERIALIZED (
      SELECT t.id FROM g JOIN tournaments t ON t.type_id = g.typeId AND t.id <> g.tid
      WHERE g.a IS NOT NULL AND g.b IS NOT NULL AND ${on("a")} AND ${on("b")}
      ORDER BY t.held_on DESC, t.id DESC LIMIT ${EDITIONS})
    SELECT ${rows(
      "id heldOn season name startTime endTime",
      `SELECT t.id, t.held_on heldOn, t.season, t.name, t.start_time startTime, t.end_time endTime FROM tournaments t
       WHERE t.id IN past ORDER BY t.held_on DESC, t.id DESC`,
    )} editions,
    ${rows(
      "id tournamentId name captainMemberId",
      `SELECT id, tournament_id tournamentId, name, captain_member_id captainMemberId FROM tournament_teams
       WHERE tournament_id IN past ORDER BY tournament_id, coalesce(pick, 1000), id`,
    )} teams,
    ${rows(
      "teamId memberId",
      `SELECT team_id teamId, member_id memberId FROM tournament_team_players
       WHERE team_id IN (SELECT id FROM tournament_teams WHERE tournament_id IN past) AND member_id IS NOT NULL`,
    )} players,
    ${rows(
      "id tournamentId position homeTeamId awayTeamId homeGoals awayGoals status",
      `SELECT id, tournament_id tournamentId, position, home_team_id homeTeamId, away_team_id awayTeamId,
              home_goals homeGoals, away_goals awayGoals, status
       FROM tournament_games WHERE tournament_id IN past AND status = 'done' ORDER BY tournament_id, position`,
    )} games`;
  const row = await db.prepare(sql).bind(gameId).first<Record<"editions" | "teams" | "players" | "games", string>>();
  const [editions, teams, players, games] = (["editions", "teams", "players", "games"] as const).map((k) =>
    JSON.parse(row![k]),
  ) as [
    { id: number; heldOn: string; season: string | null; name: string; startTime: string; endTime: string }[],
    { id: number; tournamentId: number; name: string; captainMemberId: number | null }[],
    { teamId: number; memberId: number }[],
    { id: number; tournamentId: number; [k: string]: unknown }[],
  ];
  return editions.map((e) => ({
    ...e,
    teams: teams
      .filter((t) => t.tournamentId === e.id)
      .map(({ tournamentId: _, ...t }) => ({
        ...t,
        players: players.filter((p) => p.teamId === t.id).map((p) => ({ memberId: p.memberId })),
      })),
    games: games.filter((x) => x.tournamentId === e.id).map(({ tournamentId: _, ...x }) => x),
  }));
}
