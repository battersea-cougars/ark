// A series' editions, read when they're wanted (#175, ADR 0074). Opening the app sends only the ones its pages show
// at once (api.club.ts SHOWN_TOURNAMENTS); the rest are read here: one in full when its page opens, as the club read
// would have sent it, and History a page at a time, newest first, each a line of what it was. All-time leaders are
// counted in the database, not from every game sent.
import { champion } from "@cougars/shared/results";
import { DONE, LOGO_VERSION, readClub, rows } from "../api/api.club";
import { HttpError } from "../api/api.http";
import { type Ctx } from "../api/api.route";
import { SLICES, viewerOf } from "../api/api.slices";
import { first } from "@cougars/shared/d1";
import { logoAddress } from "./tournaments";

/** One tournament, as this member may see it (the club read's rules, view-as and all), or null if there's none. */
export async function editionOf(c: Ctx, id: number) {
  const parts = await readClub(c.env.DB, viewerOf(c), SLICES.tournaments.parts, id);
  return SLICES.tournaments.shape(c, parts)[0] ?? null;
}

/** The tournament one of its games or teams is in: a link to a past one's matchup or team. */
export async function tournamentWith(db: D1Database, of: "game" | "team", id: number) {
  const table = of === "game" ? "tournament_games" : "tournament_teams";
  const row = await first<{ id: number }>(db, `SELECT tournament_id id FROM ${table} WHERE id = ?`, [id]);
  return row?.id ?? null;
}

/** Where a page of History starts: before this one (its day, then its id: several can share a day). */
export interface Cursor {
  heldOn: string;
  id: number;
}
const cursorText = (c: Cursor) => `${c.heldOn}_${c.id}`;

/** A page's `before` and `limit`, checked: 20 a page unless it says, 50 at most. */
export function pageOf(url: URL): { before: Cursor | null; limit: number } {
  const limit = Number(url.searchParams.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, "limit is 1 to 50.");
  const before = url.searchParams.get("before");
  if (!before) return { before: null, limit };
  const hit = /^(\d{4}-\d{2}-\d{2})_(\d+)$/.exec(before);
  if (!hit) throw new HttpError(400, "before is a day and an id, as the last page said.");
  return { before: { heldOn: hit[1], id: Number(hit[2]) }, limit };
}

interface EditionRow {
  id: number;
  typeId: number | null;
  name: string;
  heldOn: string;
  season: string | null;
  startTime: string;
  endTime: string;
  venueId: number | null;
  location: string;
  feePence: number;
  kind: string;
  capacity: number | null;
  status: string;
  going: number;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
}
interface TeamRow {
  id: number;
  tournamentId: number;
  name: string;
  logo: string | null;
  captainMemberId: number | null;
}
interface GameRow {
  tournamentId: number;
  stage: "group" | "playoff";
  position: number;
  status: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
}

/**
 * The played ones, newest first, `limit` of them before `before` (all series', or one's): each with its day and place,
 * its teams (a crest each), its champions and its final; `next`, where the page after starts, or null for none. One
 * statement: the page (one more than asked, to know if there's another), then its teams and games.
 */
export async function pastEditions(
  db: D1Database,
  { typeId, before, limit }: { typeId: number | null; before: Cursor | null; limit: number },
) {
  const page = `SELECT t.id FROM tournaments t
    WHERE ${DONE("t")} AND (? IS NULL OR t.type_id = ?) AND (? IS NULL OR (t.held_on, t.id) < (?, ?))
    ORDER BY t.held_on DESC, t.id DESC LIMIT ?`;
  const sql = `WITH page (id) AS MATERIALIZED (${page})
    SELECT ${rows(
      "id typeId name heldOn season startTime endTime venueId location feePence kind capacity status going pointsWin pointsDraw pointsLoss",
      `SELECT t.id, t.type_id typeId, t.name, t.held_on heldOn, t.season, t.start_time startTime, t.end_time endTime,
              t.venue_id venueId, t.location, t.fee_pence feePence, t.kind, t.capacity, t.status,
              (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id AND e.signup = 'in') going,
              t.points_win pointsWin, t.points_draw pointsDraw, t.points_loss pointsLoss
       FROM page p JOIN tournaments t ON t.id = p.id`,
    )} editions,
    ${rows(
      "id tournamentId name logo captainMemberId",
      `SELECT t.id, t.tournament_id tournamentId, t.name, ${LOGO_VERSION("t")} logo, t.captain_member_id captainMemberId
       FROM tournament_teams t WHERE t.tournament_id IN (SELECT id FROM page)
       ORDER BY t.tournament_id, coalesce(t.pick, 1000), t.id`,
    )} teams,
    ${rows(
      "tournamentId stage position status homeTeamId awayTeamId homeGoals awayGoals",
      `SELECT tournament_id tournamentId, stage, position, status, home_team_id homeTeamId, away_team_id awayTeamId,
              home_goals homeGoals, away_goals awayGoals
       FROM tournament_games WHERE tournament_id IN (SELECT id FROM page) ORDER BY tournament_id, position`,
    )} games`;
  const row = await db
    .prepare(sql)
    .bind(typeId, typeId, before?.heldOn ?? null, before?.heldOn ?? null, before?.id ?? null, limit + 1)
    .first<Record<"editions" | "teams" | "games", string>>();
  const found = (JSON.parse(row!.editions) as EditionRow[]).sort(
    (a, b) => b.heldOn.localeCompare(a.heldOn) || b.id - a.id,
  );
  const shown = found.slice(0, limit);
  const teams = JSON.parse(row!.teams) as TeamRow[];
  const games = JSON.parse(row!.games) as GameRow[];
  return {
    editions: shown.map((e) => summaryOf(e, teams, games)),
    next: found.length > limit ? cursorText(shown.at(-1)!) : null,
  };
}

/** One played edition in a line: its own fields, its teams, who won it and the final (lib/PastEditions.svelte). */
function summaryOf(e: EditionRow, allTeams: TeamRow[], allGames: GameRow[]) {
  const { pointsWin, pointsDraw, pointsLoss, ...fields } = e;
  const teams = allTeams.filter((t) => t.tournamentId === e.id);
  const games = allGames.filter((g) => g.tournamentId === e.id);
  const playoffs = games.filter((g) => g.stage === "playoff");
  const final = playoffs.length ? playoffs.reduce((a, b) => (b.position > a.position ? b : a)) : null;
  return {
    ...fields,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      logo: t.logo ? logoAddress(t.id, t.logo) : null,
      captainMemberId: t.captainMemberId,
    })),
    champion: champion(
      teams.map((t) => t.id),
      games,
      { win: pointsWin, draw: pointsDraw, loss: pointsLoss },
    ),
    final: final && {
      homeTeamId: final.homeTeamId,
      awayTeamId: final.awayTeamId,
      homeGoals: final.homeGoals,
      awayGoals: final.awayGoals,
    },
    games: games.length,
  };
}

/**
 * Every played edition's leaders in a series (#47, lib/leaders.ts): each player's goals, assists and penalty minutes
 * over the games under way or played, counted in the database, so History's all-time board never needs every game.
 */
export async function allTimeLeaders(db: D1Database, typeId: number) {
  const played = `SELECT g.id FROM tournaments t JOIN tournament_games g ON g.tournament_id = t.id
    WHERE t.type_id = ? AND ${DONE("t")} AND g.status <> 'next'`;
  const { results } = await db
    .prepare(
      `WITH played (id) AS MATERIALIZED (${played})
       SELECT memberId, SUM(goals) goals, SUM(assists) assists, SUM(pim) pim FROM (
         SELECT scorer_member_id memberId, 1 goals, 0 assists, 0 pim FROM tournament_goals
           WHERE game_id IN played AND scorer_member_id IS NOT NULL
         UNION ALL SELECT assist_member_id, 0, 1, 0 FROM tournament_goals
           WHERE game_id IN played AND assist_member_id IS NOT NULL
         UNION ALL SELECT member_id, 0, 0, minutes FROM tournament_penalties
           WHERE game_id IN played AND member_id IS NOT NULL)
       GROUP BY memberId ORDER BY memberId`,
    )
    .bind(typeId)
    .all<{ memberId: number; goals: number; assists: number; pim: number }>();
  return results.map((r) => ({ ...r, points: r.goals + r.assists }));
}

/** A team's logo, as an image, and its version; null for a team with none. */
export async function logoOf(db: D1Database, teamId: number) {
  const row = await first<{ logo: string | null; version: string | null }>(
    db,
    `SELECT t.logo, ${LOGO_VERSION("t")} version FROM tournament_teams t WHERE t.id = ?`,
    [teamId],
  );
  if (!row?.logo || !row.version) return null;
  const comma = row.logo.indexOf(",");
  const type = /^data:([^;]+);base64$/.exec(row.logo.slice(0, comma))?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(row.logo.slice(comma + 1)), (ch) => ch.charCodeAt(0));
  return { type, bytes, version: row.version };
}
