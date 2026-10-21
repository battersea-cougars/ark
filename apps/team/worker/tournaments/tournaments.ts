// Tournaments (ADR 0030, ADR 0060, ADR 0074): types (series) and editions, their teams, rules and playoffs.
import { PENALTY_RULES, type PenaltyRule } from "../../src/lib/penalties";
import { syncTournament, syncTournamentsOf } from "@cougars/shared/agenda";
import { batch, first, run, statement, type Param } from "@cougars/shared/d1";
import { isSeason, seasonEnd, seasonYear, type Season } from "@cougars/shared/seasons";
import { SCHEDULE_ICONS, TONES } from "../../src/demo/model";
import type { Winner } from "./awards";
import type { Game } from "./fixtures";
import { HttpError, bool, date, int, oneOf, text, time } from "../api/api.http";
import { freeSlug, slugify } from "../api/api.slugs";
import { placeFields } from "../settings/venues";

interface TypeRow {
  id: number;
  slug: string;
  name: string;
  short_name: string;
  icon: string;
  tone: string;
  format: string;
  points_win: number;
  points_draw: number;
  points_loss: number;
  game_minutes: number;
  penalty_rule: PenaltyRule;
  periods: number;
  kind: Kind;
  active: number;
  default_fee_pence: number;
  default_start_time: string;
  default_end_time: string;
  awards: string;
  playoffs: string;
  venue_id: number | null;
  location: string;
  map_url: string;
}

/** How a tournament makes its teams (ADR 0030): teams enter, or captains draft members. */
export const KINDS = ["teams", "draft"] as const;
type Kind = (typeof KINDS)[number];

/** A tournament type's award (ADR 0044): what it's called and a line on what it's for. */
export interface Award {
  name: string;
  about: string;
}

const parseAwards = (json: string): Award[] => {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

/** Up to 8 awards, each with a name; empty rows are dropped. */
function awardsOf(o: Record<string, unknown>): string {
  const list = o.awards ?? [];
  if (!Array.isArray(list)) throw new HttpError(400, "awards should be a list.");
  const awards = list
    .map((a: Record<string, unknown>) => ({
      name: text(a, "name", { optional: true, max: 40 }).trim(),
      about: text(a, "about", { optional: true, max: 120 }).trim(),
    }))
    .filter((a) => a.name);
  if (awards.length > 8) throw new HttpError(400, "Up to 8 awards.");
  return JSON.stringify(awards);
}

/** A playoff game by table position (ADR 0061): "Final", 1st v 2nd. */
export interface Playoff {
  name: string;
  home: number;
  away: number;
}

const parsePlayoffs = (json: string): Playoff[] => {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

/** Up to 8 playoff games, each a name and two different table positions (1–16). */
function playoffsOf(o: Record<string, unknown>): string {
  const list = o.playoffs ?? [];
  if (!Array.isArray(list)) throw new HttpError(400, "playoffs should be a list.");
  if (list.length > 8) throw new HttpError(400, "Up to 8 playoff games.");
  const games = list.map((g: Record<string, unknown>) => {
    const game = {
      name: text(g, "name", { max: 40 }).trim(),
      home: int(g, "home", { min: 1, max: 16 }),
      away: int(g, "away", { min: 1, max: 16 }),
    };
    if (!game.name) throw new HttpError(400, "Every playoff game needs a name.");
    if (game.home === game.away) throw new HttpError(400, "A playoff game is between two different places.");
    return game;
  });
  return JSON.stringify(games);
}

/** Tournament series as read (api.club.ts). */
export function tournamentTypesFrom(rows: TypeRow[]) {
  return rows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    shortName: t.short_name,
    icon: t.icon,
    tone: t.tone,
    format: t.format,
    pointsWin: t.points_win,
    pointsDraw: t.points_draw,
    pointsLoss: t.points_loss,
    gameMinutes: t.game_minutes,
    penaltyRule: t.penalty_rule,
    periods: t.periods,
    kind: t.kind,
    active: Boolean(t.active),
    defaultFeePence: t.default_fee_pence,
    defaultStartTime: t.default_start_time,
    defaultEndTime: t.default_end_time,
    awards: parseAwards(t.awards),
    playoffs: parsePlayoffs(t.playoffs),
    venueId: t.venue_id,
    location: t.location,
    mapUrl: t.map_url,
  }));
}

async function typeFields(db: D1Database, o: Record<string, unknown>) {
  return [
    text(o, "name", { max: 60 }),
    text(o, "shortName", { max: 12 }),
    oneOf(o, "icon", SCHEDULE_ICONS),
    oneOf(o, "tone", TONES),
    int(o, "pointsWin", { max: 10 }),
    int(o, "pointsDraw", { max: 10 }),
    int(o, "pointsLoss", { max: 10 }),
    int(o, "gameMinutes", { min: 1, max: 90 }),
    oneOf(o, "kind", KINDS),
    bool(o, "active") ? 1 : 0,
    int(o, "defaultFeePence", { max: 100_000 }),
    o.defaultStartTime == null ? "11:00" : time(o, "defaultStartTime"),
    o.defaultEndTime == null ? "16:00" : time(o, "defaultEndTime"),
    awardsOf(o),
    ...(await placeFields(db, o, "location")),
    playoffsOf(o),
    o.penaltyRule == null ? "power_play" : penaltyRuleOf(o),
    o.periods == null ? 1 : periodsOf(o),
  ] as Param[];
}

/** A game's periods (ADR 0061): 1 to 3. */
const periodsOf = (o: Record<string, unknown>) => int(o, "periods", { min: 1, max: 3 });

/** How a penalty's served (ADR 0061, lib/penalties.ts). */
const penaltyRuleOf = (o: Record<string, unknown>) =>
  oneOf(
    o,
    "penaltyRule",
    PENALTY_RULES.map((r) => r.value),
  );

export async function createTournamentType(db: D1Database, o: Record<string, unknown>) {
  const f = await typeFields(db, o);
  const slug = await freeSlug(db, "tournament_types", slugify(String(f[1] || f[0])));
  const res = await run(
    db,
    `INSERT INTO tournament_types (name, short_name, icon, tone, points_win, points_draw, points_loss, game_minutes,
       kind, active, default_fee_pence, default_start_time, default_end_time, awards, venue_id, location, map_url,
       playoffs, penalty_rule, periods, slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...f, slug],
  );
  return { id: Number(res.meta.last_row_id), slug };
}

export async function updateTournamentType(db: D1Database, id: number, o: Record<string, unknown>) {
  const res = await run(
    db,
    `UPDATE tournament_types SET name = ?, short_name = ?, icon = ?, tone = ?, points_win = ?, points_draw = ?,
       points_loss = ?, game_minutes = ?, kind = ?, active = ?, default_fee_pence = ?, default_start_time = ?,
       default_end_time = ?, awards = ?, venue_id = ?,
       location = ?, map_url = ?, playoffs = ?, penalty_rule = ?, periods = ?
     WHERE id = ?`,
    [...(await typeFields(db, o)), id],
  );
  if (!res.meta.changes) throw new HttpError(404, "No such tournament series.");
  // Its place is its tournaments' fallback
  await syncTournamentsOf(db, id);
}

/**
 * Every tournament date. Its place (`venueId`, `location`, `mapUrl`) is its own; none of them set, its series' is
 * where it really is (ADR 0030), which the app works out. Its teams come in pick order (a draft) or the order they
 * entered, each with its players in order (ADR 0030).
 */
export type TournamentListRow = {
  id: number;
  typeId: number;
  name: string;
  venueId: number | null;
  location: string;
  mapUrl: string;
  heldOn: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  status: string;
  champions: string | null;
  feePence: number;
  season: Season | null;
  public: number;
  signupOpensOn: string | null;
  signupClosesOn: string | null;
  draftOn: string | null;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  gameMinutes: number;
  penaltyRule: PenaltyRule;
  periods: number;
  kind: Kind;
  awards: string;
  playoffs: string;
  draftState: string;
};
export type TournamentTeamRow = {
  id: number;
  tournamentId: number;
  name: string;
  logo: string | null;
  captainMemberId: number | null;
  captainName: string;
  contact: string;
  pick: number | null;
};
export type TournamentPlayerRow = {
  teamId: number;
  memberId: number | null;
  name: string;
  pick: number | null;
  /** Who made the pick: its captain, or whoever ran the draft picking for them (ADR 0060). */
  pickedBy: number | null;
};

/** Tournaments as read (api.club.ts), each with its games, award winners, and teams with their players. */
export function tournamentsFrom(
  rows: TournamentListRow[],
  teams: TournamentTeamRow[],
  players: TournamentPlayerRow[],
  games: Game[],
  winners: (Winner & { tournamentId: number })[],
) {
  return rows.map((t) => ({
    ...t,
    draftState: draftStateOf(
      t,
      teams.some((team) => team.tournamentId === t.id),
    ),
    public: Boolean(t.public),
    awards: parseAwards(t.awards),
    playoffs: parsePlayoffs(t.playoffs),
    games: games.filter((g) => g.tournamentId === t.id).map(({ tournamentId: _, ...g }) => g),
    winners: winners.filter((x) => x.tournamentId === t.id).map(({ tournamentId: _, ...x }) => x),
    teams: teams
      .filter((team) => team.tournamentId === t.id)
      .map(({ tournamentId: _, ...team }) => ({
        ...team,
        players: players.filter((p) => p.teamId === team.id).map(({ teamId: _, ...p }) => p),
      })),
  }));
}

/**
 * Where a captains' draft is (ADR 0060): "none" (not a draft, or no day or captains yet), "scheduled" (a day and
 * captains, not opened), "open" (an admin opened it: captains pick) or "closed" (an admin closed it: teams locked).
 */
export function draftStateOf(t: { kind: string; draftOn: string | null; draftState: string }, hasTeams: boolean) {
  if (t.kind !== "draft") return "none";
  if (t.draftState === "open" || t.draftState === "closed") return t.draftState;
  return t.draftOn && hasTeams ? "scheduled" : "none";
}

async function tournamentFields(db: D1Database, o: Record<string, unknown>) {
  const heldOn = date(o, "heldOn")!;
  // Just a season so far (ADR 0030): its day is the season's last; otherwise the day is the day
  const season = o.season == null || o.season === "" ? null : o.season;
  if (season !== null && !isSeason(season))
    throw new HttpError(400, "season should be spring, summer, autumn or winter.");
  if (season && heldOn !== seasonEnd(season, seasonYear(season, heldOn)))
    throw new HttpError(400, "A season's date is its last day.");
  const signupOpensOn = date(o, "signupOpensOn", { nullable: true });
  if (signupOpensOn && signupOpensOn > heldOn) throw new HttpError(400, "Sign-up has to open before the day.");
  const signupClosesOn = date(o, "signupClosesOn", { nullable: true });
  if (signupOpensOn && signupClosesOn && signupClosesOn < signupOpensOn)
    throw new HttpError(400, "Sign-up can't close before it opens.");
  if (signupClosesOn && signupClosesOn > heldOn) throw new HttpError(400, "Sign-up can't close after the day.");
  const draftOn = date(o, "draftOn", { nullable: true });
  if (draftOn && draftOn > heldOn) throw new HttpError(400, "The draft has to be before the day.");
  return [
    text(o, "name", { max: 80 }),
    // None set: its series' place
    ...(await placeFields(db, o, "location")),
    heldOn,
    time(o, "startTime"),
    time(o, "endTime"),
    int(o, "capacity", { min: 1, max: 500, nullable: true }),
    oneOf(o, "status", ["planned", "open", "live", "finished"] as const),
    int(o, "feePence", { max: 100_000 }),
    season,
    // Shown on the website unless said otherwise
    o.public === false ? 0 : 1,
    signupOpensOn,
    signupClosesOn,
    draftOn,
  ] as Param[];
}

/** A team as the app sends it (ADR 0030). */
interface TeamIn {
  /** The team it is, if it's been saved before: teams are changed in place, never remade (ADR 0060). */
  id: number | null;
  name: string;
  logo: string | null;
  captainMemberId: number | null;
  captainName: string;
  contact: string;
  players: { memberId: number | null; name: string }[];
}

const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** A team's logo: a small image the browser shrank (TeamCard, TeamLookSheet), or none (its initials show). */
function logoOf(t: Record<string, unknown>): string | null {
  const logo = t.logo == null || t.logo === "" ? null : t.logo;
  if (logo !== null && (typeof logo !== "string" || logo.length > 200_000 || !LOGO.test(logo)))
    throw new HttpError(400, "A logo should be a small PNG, JPEG or WebP image.");
  return logo;
}

/**
 * A team's look, set by its captain or an admin (ADR 0065: from the team, not Settings): its name (empty: "Team"
 * and the captain's name) and its logo (none: its initials).
 */
export async function setTeamLook(
  db: D1Database,
  tournamentId: number,
  teamId: number,
  by: { memberId: number; admin: boolean },
  o: Record<string, unknown>,
) {
  const team = await first<{ captain: number | null }>(
    db,
    "SELECT captain_member_id captain FROM tournament_teams WHERE id = ? AND tournament_id = ?",
    [teamId, tournamentId],
  );
  if (!team) throw new HttpError(404, "No such team.");
  if (!by.admin && team.captain !== by.memberId) throw new HttpError(403, "Only its captain or an admin.");
  const name = text(o, "name", { optional: true, max: 40 }).trim();
  await run(db, "UPDATE tournament_teams SET name = ?, logo = ? WHERE id = ?", [name, logoOf(o), teamId]);
}

/**
 * A tournament's teams, in order (a draft's as named: its pick order is drawn when it opens), at most 16 of up to 30 players. A draft's teams each have a
 * member as captain; a team that entered has a name. Nobody plays for two teams. Absent: left as they are.
 */
function teamsOf(o: Record<string, unknown>, kind: Kind): TeamIn[] | null {
  if (o.teams == null) return null;
  if (!Array.isArray(o.teams)) throw new HttpError(400, "teams should be a list.");
  if (o.teams.length > 16) throw new HttpError(400, "Up to 16 teams.");
  const teams = o.teams.map((t: Record<string, unknown>): TeamIn => {
    const logo = logoOf(t);
    const list = t.players ?? [];
    if (!Array.isArray(list) || list.length > 30) throw new HttpError(400, "Up to 30 players a team.");
    const team = {
      id: int(t, "id", { min: 1, nullable: true }),
      name: text(t, "name", { optional: true, max: 40 }).trim(),
      logo,
      captainMemberId: int(t, "captainMemberId", { min: 1, nullable: true }),
      captainName: text(t, "captainName", { optional: true, max: 60 }).trim(),
      contact: text(t, "contact", { optional: true, max: 120 }).trim(),
      players: list
        .map((p: Record<string, unknown>) => ({
          memberId: int(p, "memberId", { min: 1, nullable: true }),
          name: text(p, "name", { optional: true, max: 60 }).trim(),
        }))
        .filter((p) => p.memberId !== null || p.name),
    };
    if (kind === "draft" && team.captainMemberId === null)
      throw new HttpError(400, "In a draft, every team's captain is a member.");
    if (kind === "teams" && !team.name) throw new HttpError(400, "Every team needs a name.");
    return team;
  });
  // A draft's players come from its picks (draft.ts), never from the editor
  if (kind === "draft") for (const t of teams) t.players = [];
  const members = teams.flatMap((t) => [t.captainMemberId, ...t.players.map((p) => p.memberId)]).filter((m) => m);
  if (new Set(members).size !== members.length) throw new HttpError(400, "Someone is on two teams.");
  return teams;
}

/**
 * Save a tournament's teams as the editor sends them (ADR 0060): each one changed in place (by its id, or in a draft
 * by its captain), new ones added, missing ones removed. A draft's picks and pick order are never touched here (the
 * order is drawn when it opens), and once its draft is open its captains and their drawn order are fixed. A draft's captains are in the tournament automatically.
 */
async function setTeams(db: D1Database, id: number, kind: Kind, teams: TeamIn[] | null, now = new Date()) {
  if (!teams) return;
  // What it's checked against, in one round trip
  const named = [...new Set(teams.flatMap((t) => [t.captainMemberId, ...t.players.map((p) => p.memberId)]))].filter(
    (m) => m !== null,
  );
  const [known, teamRows, draft] = await batch(db, [
    statement(db, "SELECT count(*) n FROM members WHERE id IN (SELECT value FROM json_each(?))", [
      JSON.stringify(named),
    ]),
    statement(
      db,
      "SELECT id, captain_member_id captain FROM tournament_teams WHERE tournament_id = ? ORDER BY coalesce(pick, 1000), id",
      [id],
    ),
    statement(db, "SELECT draft_state s FROM tournaments WHERE id = ?", [id]),
  ]);
  if ((known.results[0] as { n: number }).n !== named.length) throw new HttpError(400, "No such member.");
  const existing = teamRows.results as { id: number; captain: number | null }[];
  const state = (draft.results[0] as { s: string } | undefined)?.s;
  if (kind === "draft" && (state === "open" || state === "closed")) {
    const same = teams.length === existing.length && teams.every((t, i) => t.captainMemberId === existing[i].captain);
    if (!same) throw new HttpError(409, "The draft has started: the captains and their order are set.");
  }
  const match = (t: TeamIn) =>
    existing.find((e) => e.id === t.id) ??
    (kind === "draft" ? existing.find((e) => e.captain !== null && e.captain === t.captainMemberId) : undefined);
  const kept = new Set<number>();
  // Every change goes in one batch. A team just added is the newest: ids only go up (AUTOINCREMENT), and a batch
  // runs in order, alone
  const statements: D1PreparedStatement[] = [];
  for (const t of teams) {
    // A draft's pick order is drawn when it opens (draft.ts), never the editor's: the order they're named in means
    // nothing, so a save leaves it as it is (none yet, or the draw)
    const drawn = kind === "draft" ? 1 : 0;
    const found = match(t);
    let teamId: Param;
    let team: string;
    if (found && !kept.has(found.id)) {
      kept.add(found.id);
      teamId = found.id;
      team = "?";
      statements.push(
        statement(
          db,
          `UPDATE tournament_teams SET name = ?, logo = ?, captain_member_id = ?, captain_name = ?, contact = ?,
             pick = CASE WHEN ? THEN pick END
           WHERE id = ?`,
          [t.name, t.logo, t.captainMemberId, t.captainName, t.contact, drawn, teamId],
        ),
      );
    } else {
      teamId = id;
      team = "(SELECT max(id) FROM tournament_teams WHERE tournament_id = ?)";
      statements.push(
        statement(
          db,
          `INSERT INTO tournament_teams (tournament_id, name, logo, captain_member_id, captain_name, contact, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, t.name, t.logo, t.captainMemberId, t.captainName, t.contact, now.toISOString()],
        ),
      );
    }
    // A team that entered: its players are the editor's. A draft's come from its picks.
    if (kind === "teams") {
      statements.push(statement(db, `DELETE FROM tournament_team_players WHERE team_id = ${team}`, [teamId]));
      for (const [position, p] of t.players.entries())
        statements.push(
          statement(
            db,
            `INSERT INTO tournament_team_players (team_id, member_id, name, position) VALUES (${team}, ?, ?, ?)`,
            [teamId, p.memberId, p.name, position],
          ),
        );
    }
  }
  for (const e of existing)
    if (!kept.has(e.id)) statements.push(statement(db, "DELETE FROM tournament_teams WHERE id = ?", [e.id]));
  // A draft's captains changed before it opened: the order drawn was for the old ones, so it goes, to be drawn again.
  // Once it's open they can't change (above)
  if (kind === "draft" && state !== "open" && state !== "closed") {
    const same =
      teams.length === existing.length && teams.every((t) => existing.some((e) => e.captain === t.captainMemberId));
    if (!same) statements.push(statement(db, "UPDATE tournament_teams SET pick = NULL WHERE tournament_id = ?", [id]));
  }
  // A draft's captains play: they're in, and so never in the pool to pick from
  if (kind === "draft")
    for (const t of teams)
      statements.push(
        statement(
          db,
          `INSERT INTO tournament_entries (tournament_id, member_id, signup, signed_up_at) VALUES (?, ?, 'in', ?)
           ON CONFLICT (tournament_id, member_id) DO UPDATE SET signup = 'in'`,
          [id, t.captainMemberId, now.toISOString()],
        ),
      );
  await batch(db, statements);
}

/** Its series, if it has one: a tournament can stand on its own. */
async function seriesOf(db: D1Database, o: Record<string, unknown>) {
  const typeId = int(o, "typeId", { min: 1, nullable: true });
  if (typeId === null) return { typeId, series: null };
  const series = await first<TypeRow>(db, "SELECT * FROM tournament_types WHERE id = ?", [typeId]);
  if (!series) throw new HttpError(400, "No such tournament series.");
  return { typeId, series };
}

/**
 * A tournament's own rules and awards, copied from its series and changed for it if need be (ADR 0030). One left
 * out keeps what it was (on a change), or takes the series' (or, with no series, the usual round robin's).
 */
type Rules = Pick<
  TypeRow,
  | "points_win"
  | "points_draw"
  | "points_loss"
  | "game_minutes"
  | "kind"
  | "awards"
  | "playoffs"
  | "penalty_rule"
  | "periods"
>;

function rulesOf(o: Record<string, unknown>, series: Rules | null) {
  const given = (key: string) => o[key] != null;
  return [
    given("pointsWin") ? int(o, "pointsWin", { max: 10 }) : (series?.points_win ?? 3),
    given("pointsDraw") ? int(o, "pointsDraw", { max: 10 }) : (series?.points_draw ?? 1),
    given("pointsLoss") ? int(o, "pointsLoss", { max: 10 }) : (series?.points_loss ?? 0),
    given("gameMinutes") ? int(o, "gameMinutes", { min: 1, max: 90 }) : (series?.game_minutes ?? 12),
    given("kind") ? oneOf(o, "kind", KINDS) : (series?.kind ?? "teams"),
    given("awards") ? awardsOf(o) : (series?.awards ?? "[]"),
    given("playoffs") ? playoffsOf(o) : (series?.playoffs ?? "[]"),
    given("penaltyRule") ? penaltyRuleOf(o) : (series?.penalty_rule ?? "power_play"),
    given("periods") ? periodsOf(o) : (series?.periods ?? 1),
  ] as Param[];
}

/**
 * An admin deletes a tournament (ADR 0074). One statement: the schema's cascades take everything that's its (sign-ups,
 * teams and their players, games and goals, the awards' winners), so the database does the work, not the Worker
 * (ADR 0059). The agenda points at it by source, not a foreign key, so its rows go by syncing it away.
 */
export async function deleteTournament(db: D1Database, id: number) {
  const res = await run(db, "DELETE FROM tournaments WHERE id = ?", [id]);
  if (!res.meta.changes) throw new HttpError(404, "No such tournament.");
  await syncTournament(db, id);
}

/**
 * A new tournament. Only its series, name and day are needed (the next one's quick form): what's left out takes the
 * series' fee, rules and usual hours (ADR 0074), and sign-up not open yet.
 */
export async function createTournament(db: D1Database, given: Record<string, unknown>) {
  const { typeId, series } = await seriesOf(db, given);
  const o: Record<string, unknown> = {
    startTime: series?.default_start_time ?? "11:00",
    endTime: series?.default_end_time ?? "16:00",
    status: "planned",
    feePence: series?.default_fee_pence ?? 0,
    ...Object.fromEntries(Object.entries(given).filter(([, v]) => v != null)),
  };
  const rules = rulesOf(o, series);
  const fields = [...(await tournamentFields(db, o)), ...rules];
  const kind = rules[4] as Kind;
  const teams = teamsOf(o, kind);
  const res = await run(
    db,
    `INSERT INTO tournaments (type_id, name, venue_id, location, map_url, held_on, start_time, end_time, capacity, status, fee_pence,
       season, public, signup_opens_on, signup_closes_on, draft_on, points_win, points_draw, points_loss,
       game_minutes, kind, awards, playoffs, penalty_rule, periods)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [typeId, ...fields],
  );
  const id = Number(res.meta.last_row_id);
  await setTeams(db, id, kind, teams);
  await syncTournament(db, id);
  return { id };
}

export async function updateTournament(db: D1Database, id: number, o: Record<string, unknown>) {
  const { typeId } = await seriesOf(db, o);
  const current = await first<Rules & { draft_state: string }>(
    db,
    `SELECT points_win, points_draw, points_loss, game_minutes, kind, awards, playoffs, penalty_rule, periods, draft_state
     FROM tournaments WHERE id = ?`,
    [id],
  );
  if (!current) throw new HttpError(404, "No such tournament.");
  const rules = rulesOf(o, current);
  if (rules[4] !== current.kind && current.draft_state !== "none")
    throw new HttpError(409, "The draft has started: it stays a draft.");
  const fields = [...(await tournamentFields(db, o)), ...rules];
  const kind = rules[4] as Kind;
  const teams = teamsOf(o, kind);
  const res = await run(
    db,
    `UPDATE tournaments SET type_id = ?, name = ?, venue_id = ?, location = ?, map_url = ?, held_on = ?, start_time = ?, end_time = ?, capacity = ?,
       status = ?, fee_pence = ?, season = ?, public = ?, signup_opens_on = ?, signup_closes_on = ?, draft_on = ?,
       points_win = ?, points_draw = ?, points_loss = ?, game_minutes = ?, kind = ?, awards = ?, playoffs = ?,
       penalty_rule = ?, periods = ?
     WHERE id = ?`,
    [typeId, ...fields, id],
  );
  if (!res.meta.changes) throw new HttpError(404, "No such tournament.");
  await setTeams(db, id, kind, teams);
  await syncTournament(db, id);
}

/** A tournament's name and day, while it exists (the record, ADR 0095). */
export const tournamentSummary = (db: D1Database, id: number) =>
  first<{ name: string; heldOn: string }>(db, "SELECT name, held_on heldOn FROM tournaments WHERE id = ?", [id]);
