// Tournaments (ADR 0030, ADR 0060, ADR 0074): types (series) and editions, their teams, rules and playoffs.
import { PENALTY_MINUTES, PENALTY_RULES, type PenaltyRule } from "../../src/lib/penalties";
import { syncTournament, syncTournamentsOf } from "@cougars/shared/agenda";
import { batch, first, run, statement, type Param } from "@cougars/shared/d1";
import { isSeason, seasonEnd, seasonYear, type Season } from "@cougars/shared/seasons";
import { SCHEDULE_ICONS, TONES } from "../../src/demo/model";
import type { Winner } from "./awards";
import { STATS, decidedByOf, type Award, type DecidedBy, type PlayerStat } from "../../src/lib/awards";
import type { Game } from "./fixtures";
import { HttpError, bool, date, int, oneOf, text, time } from "../api/api.http";
import { freeSlug, slugify } from "../api/api.slugs";
import { afterFields, placeFields } from "../settings/venues";
import { HOUSE_RULES_MAX } from "../../src/lib/format-rules";
import { AFTER_MODES, type AfterMode } from "@cougars/shared/places";
import { fillingUp } from "../entries/entries";
import { broughtTeam, carriedNames, teamNameOf } from "./team-name";
import { shortName } from "../../src/lib/names";

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
  default_penalty_minutes: number;
  periods: number;
  break_minutes: number;
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
  after_venue_id: number | null;
  after_time: string | null;
  after_note: string;
  house_rules: string;
}

/** How a tournament makes its teams (ADR 0030): teams enter, or captains draft members. */
export const KINDS = ["teams", "draft"] as const;
type Kind = (typeof KINDS)[number];

/** A tournament type's award (ADR 0044): what it's called, a line on what it's for, and how it's decided. */
export type { Award };

export const parseAwards = (json: string): Award[] => {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

/** How an award's decided, checked (lib/awards.ts); left out, guessed from its name as it used to be, once. */
function decidedByIn(a: Record<string, unknown>, name: string): DecidedBy {
  const d = a.decidedBy;
  if (d == null) return decidedByOf({ name });
  if (typeof d !== "object") throw new HttpError(400, "decidedBy should say how it's decided.");
  const o = d as Record<string, unknown>;
  const kind = oneOf(o, "kind", ["stat", "vote", "live", "random"] as const);
  if (kind === "stat") return { kind, stat: oneOf(o, "stat", STATS) };
  if (kind === "vote") {
    const voters = oneOf(o, "voters", ["players", "skaters"] as const);
    if (o.tieBreak == null || o.tieBreak === "") return { kind, voters };
    return {
      kind,
      voters,
      tieBreak: oneOf(
        o,
        "tieBreak",
        STATS.filter((s): s is PlayerStat => s !== "table"),
      ),
    };
  }
  if (kind === "live") {
    const options = o.options ?? [];
    if (!Array.isArray(options) || options.length > 12) throw new HttpError(400, "Up to 12 names for a live call.");
    return { kind, options: options.map((name) => text({ name }, "name", { max: 40 })) };
  }
  return { kind };
}

/** Up to 8 awards, each with a name (no two the same) and how it's decided; empty rows are dropped. */
function awardsOf(o: Record<string, unknown>): string {
  const list = o.awards ?? [];
  if (!Array.isArray(list)) throw new HttpError(400, "awards should be a list.");
  const awards = list
    .map((a: Record<string, unknown>) => ({
      name: text(a, "name", { optional: true, max: 40 }).trim(),
      about: text(a, "about", { optional: true, max: 120 }).trim(),
      a,
    }))
    .filter((a) => a.name)
    .map(({ name, about, a }) => ({ name, about, decidedBy: decidedByIn(a, name) }));
  if (awards.length > 8) throw new HttpError(400, "Up to 8 awards.");
  if (new Set(awards.map((a) => a.name.toLowerCase())).size < awards.length)
    throw new HttpError(400, "Two awards can't share a name.");
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
    defaultPenaltyMinutes: t.default_penalty_minutes,
    periods: t.periods,
    breakMinutes: t.break_minutes,
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
    afterVenueId: t.after_venue_id,
    afterTime: t.after_time,
    afterNote: t.after_note,
    houseRules: t.house_rules,
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
    o.defaultPenaltyMinutes == null ? 2 : penaltyLengthOf(o),
    o.breakMinutes == null ? 2 : breakOf(o),
    // Where its tournaments go afterwards, unless one says otherwise (ADR 0074)
    ...(await afterFields(db, o)),
    // Its house rules (ADR 0074): plain text, a screen of it at most
    text(o, "houseRules", { optional: true, max: HOUSE_RULES_MAX }).trim(),
  ] as Param[];
}

/** The break between periods (ADR 0061), in minutes: none to a quarter of an hour. */
const breakOf = (o: Record<string, unknown>) => int(o, "breakMinutes", { max: 15 });

/** A game's periods (ADR 0061): 1 to 3. */
const periodsOf = (o: Record<string, unknown>) => int(o, "periods", { min: 1, max: 3 });

/** The penalty sheet's usual length (ADR 0061): a minor, a double minor or a major. */
const penaltyLengthOf = (o: Record<string, unknown>) => {
  const minutes = int(o, "defaultPenaltyMinutes");
  if (!(PENALTY_MINUTES as readonly number[]).includes(minutes))
    throw new HttpError(400, "A penalty's 2, 4 (a double minor) or 5 minutes.");
  return minutes;
};

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
       playoffs, penalty_rule, periods, default_penalty_minutes, break_minutes, after_venue_id, after_time, after_note,
       house_rules, slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
       location = ?, map_url = ?, playoffs = ?, penalty_rule = ?, periods = ?, default_penalty_minutes = ?,
       break_minutes = ?, after_venue_id = ?, after_time = ?, after_note = ?, house_rules = ?
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
  defaultPenaltyMinutes: number;
  periods: number;
  breakMinutes: number;
  kind: Kind;
  awards: string;
  playoffs: string;
  draftState: string;
  afterMode: AfterMode;
  afterVenueId: number | null;
  afterTime: string | null;
  afterNote: string;
  awardsRevealed: number;
  awardsNext: number;
  awardsConfirmedAt: string | null;
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
  votes: { tournamentId: number; award: string; cast: number; mine: number | null }[] = [],
  titles: { tournamentId: number; award: string; title: string | null }[] = [],
) {
  return rows.map((t) => ({
    ...t,
    draftState: draftStateOf(
      t,
      teams.some((team) => team.tournamentId === t.id),
    ),
    public: Boolean(t.public),
    awardsNext: Boolean(t.awardsNext),
    awards: parseAwards(t.awards),
    playoffs: parsePlayoffs(t.playoffs),
    games: games.filter((g) => g.tournamentId === t.id).map(({ tournamentId: _, ...g }) => g),
    winners: winners.filter((x) => x.tournamentId === t.id).map(({ tournamentId: _, ...x }) => x),
    votes: votes.filter((x) => x.tournamentId === t.id).map(({ tournamentId: _, ...x }) => x),
    titles: titles.filter((x) => x.tournamentId === t.id).map(({ tournamentId: _, ...x }) => x),
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

/**
 * A tournament's own fields, checked. `stored`: its sign-up dates as they are (a save): dates left as they were aren't
 * checked against each other, so one stored closing before it opens (as the first Close sign-up left them) never
 * stops an unrelated save; dates changed are.
 */
async function tournamentFields(
  db: D1Database,
  o: Record<string, unknown>,
  stored?: { opensOn: string | null; closesOn: string | null },
) {
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
  const unchanged = stored && stored.opensOn === signupOpensOn && stored.closesOn === signupClosesOn;
  if (signupOpensOn && signupClosesOn && signupClosesOn < signupOpensOn && !unchanged)
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

/**
 * Where a tournament goes afterwards (ADR 0074): its series' (usual), its own venue, time and note, or none this time.
 * Left out of a save, it keeps what it had (a new one: its series'). As [after_mode, after_venue_id, after_time,
 * after_note].
 */
async function tournamentAfterOf(db: D1Database, o: Record<string, unknown>, current?: Param[]): Promise<Param[]> {
  if (o.afterMode == null) return current ?? ["usual", null, null, ""];
  const mode = oneOf(o, "afterMode", AFTER_MODES);
  if (mode !== "own") return [mode, null, null, ""];
  const own = await afterFields(db, o);
  if (own[0] == null) throw new HttpError(400, "Say where everyone goes afterwards, or leave it on the usual.");
  return [mode, ...own];
}

/** A team as the app sends it (ADR 0030). */
interface TeamIn {
  /** The team it is, if it's been saved before: teams are changed in place, never remade (ADR 0060). */
  id: number | null;
  name: string;
  logo: string | null;
  /** Sent with its id and no name or logo (the editor, ADR 0030): its look is its page's, so it keeps the one it has. */
  keepsLook: boolean;
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
  const name = teamNameOf(o);
  const logo = logoOf(o);
  // This edition's team only: it's then the one its captain brings to the series' next (team-name.ts, ADR 0060)
  await run(db, "UPDATE tournament_teams SET name = ?, logo = ? WHERE id = ?", [name, logo, teamId]);
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
    const id = int(t, "id", { min: 1, nullable: true });
    const team = {
      id,
      name: teamNameOf(t),
      logo,
      keepsLook: id !== null && t.name === undefined && t.logo === undefined,
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
    if (kind === "teams" && !team.name && !team.keepsLook) throw new HttpError(400, "Every team needs a name.");
    return team;
  });
  // A draft's players come from its picks (draft.ts), never from the editor
  if (kind === "draft") for (const t of teams) t.players = [];
  const members = teams.flatMap((t) => [t.captainMemberId, ...t.players.map((p) => p.memberId)]).filter((m) => m);
  if (new Set(members).size !== members.length) throw new HttpError(400, "Someone is on two teams.");
  return teams;
}

/** Every member the teams name (captains and players), once each. */
const namedIn = (teams: TeamIn[]) =>
  [...new Set(teams.flatMap((t) => [t.captainMemberId, ...t.players.map((p) => p.memberId)]))].filter(
    (m) => m !== null,
  );

/** SQL: how many of these members (a JSON list) there are, to see that every one the teams name is a member. */
const KNOWN = "SELECT count(*) n FROM members WHERE id IN (SELECT value FROM json_each(?))";

/**
 * Save a tournament's teams as the editor sends them (ADR 0060): each one changed in place (by its id, or in a draft
 * by its captain), new ones added, missing ones removed. A draft's picks and pick order are never touched here (the
 * order is drawn when it opens), and once its draft is open its captains and their drawn order are fixed. A draft's captains are in the tournament automatically.
 */
async function setTeams(db: D1Database, id: number, kind: Kind, teams: TeamIn[] | null, now = new Date()) {
  if (!teams) return;
  // What it's checked against, in one round trip
  const named = namedIn(teams);
  const captains = teams.map((t) => t.captainMemberId).filter((m) => m !== null);
  const [known, teamRows, draft, carriedRows] = await batch(db, [
    statement(db, KNOWN, [JSON.stringify(named)]),
    statement(
      db,
      "SELECT id, captain_member_id captain, name FROM tournament_teams WHERE tournament_id = ? ORDER BY coalesce(pick, 1000), id",
      [id],
    ),
    statement(db, "SELECT draft_state s, type_id series FROM tournaments WHERE id = ?", [id]),
    // The team each captain brings from the series' last edition they captained in (team-name.ts)
    statement(
      db,
      `SELECT m.id, m.name, m.web_name webName, b.name carried, b.logo carriedLogo FROM members m
       LEFT JOIN tournament_teams b ON b.id = ${broughtTeam("?")}
       WHERE m.id IN (SELECT value FROM json_each(?))`,
      [id, JSON.stringify(captains)],
    ),
  ]);
  if ((known.results[0] as { n: number }).n !== named.length) throw new HttpError(400, "No such member.");
  const existing = teamRows.results as { id: number; captain: number | null; name: string }[];
  const tournament = draft.results[0] as { s: string; series: number | null } | undefined;
  const state = tournament?.s;
  // A draft in a series: its captains bring their teams from edition to edition (#150: in one that teams enter, the
  // team would, not its captain)
  const bringing = kind === "draft" && tournament?.series != null;
  if (kind === "draft" && (state === "open" || state === "closed")) {
    // The same captains, in any order: an editor opened before the draw sends them as it saw them, and the order is
    // the draw's (kept in each row's pick), never the editor's
    const captainsOf = (list: { captain?: number | null; captainMemberId?: number | null }[]) =>
      list.map((t) => t.captain ?? t.captainMemberId ?? null).sort((a, b) => (a ?? 0) - (b ?? 0));
    const same = JSON.stringify(captainsOf(teams)) === JSON.stringify(captainsOf(existing));
    if (!same) throw new HttpError(409, "The draft has started: the captains are set.");
  }
  const match = (t: TeamIn) =>
    existing.find((e) => e.id === t.id) ??
    (kind === "draft" ? existing.find((e) => e.captain !== null && e.captain === t.captainMemberId) : undefined);
  // Which row each team is (none: it's new), each row once
  const kept = new Set<number>();
  const rows = teams.map((t) => {
    const found = match(t);
    if (!found || kept.has(found.id)) return undefined;
    kept.add(found.id);
    return found;
  });
  // A team sent with neither its id nor a name (an editor that hasn't seen what the server named it, matched by its
  // captain) keeps the name it has, and its logo unless one's sent: a stale editor never clears them. One sent by its
  // id with no name or logo keeps both: they're changed on the team's page (Edit the team), never by the editor, so
  // an editor left open while its captain renames it never puts the old name back
  const unseen = teams.map((t, i) => !!rows[i] && ((t.id === null && !t.name) || t.keepsLook));
  if (kind === "teams" && teams.some((t, i) => t.keepsLook && !rows[i]))
    throw new HttpError(400, "Every team needs a name.");
  // A captain's new team, left unnamed, takes the name and logo of the team they bring (team-name.ts, ADR 0060),
  // unless another team goes by that name, automatic names included: then it has the automatic name and initials
  const captainRows = carriedRows.results as {
    id: number;
    name: string;
    webName: string | null;
    carried: string | null;
    carriedLogo: string | null;
  }[];
  const captainOf = (m: number | null) => captainRows.find((r) => r.id === m);
  const carrying = teams.map((t, i) => bringing && !rows[i] && !t.name && !t.logo && t.captainMemberId !== null);
  const carried = carriedNames(
    teams.map((t, i) => {
      const c = captainOf(t.captainMemberId);
      return {
        carried: carrying[i] ? (c?.carried ?? "") : null,
        name: unseen[i] ? rows[i]!.name : t.name,
        automatic: c ? `Team ${shortName(c)}` : null,
      };
    }),
  );
  // Every change goes in one batch. A team just added is the newest: ids only go up (AUTOINCREMENT), and a batch
  // runs in order, alone
  const statements: D1PreparedStatement[] = [];
  for (const [i, t] of teams.entries()) {
    const row = rows[i];
    if (carrying[i]) {
      const brought = captainOf(t.captainMemberId);
      t.name = carried[i];
      // Its logo comes with the name; a name given way to (another team goes by it) brings neither
      if (t.name === (brought?.carried ?? "")) t.logo = brought?.carriedLogo ?? null;
    }
    // A draft's pick order is drawn when it opens (draft.ts), never the editor's: the order they're named in means
    // nothing, so a save leaves it as it is (none yet, or the draw)
    const drawn = kind === "draft" ? 1 : 0;
    let teamId: Param;
    let team: string;
    if (row) {
      teamId = row.id;
      team = "?";
      statements.push(
        statement(
          db,
          `UPDATE tournament_teams SET name = CASE WHEN ? THEN name ELSE ? END,
             logo = CASE WHEN ? THEN coalesce(?, logo) ELSE ? END, captain_member_id = ?, captain_name = ?, contact = ?,
             pick = CASE WHEN ? THEN pick END
           WHERE id = ?`,
          [
            unseen[i] ? 1 : 0,
            t.name,
            unseen[i] ? 1 : 0,
            t.logo,
            t.logo,
            t.captainMemberId,
            t.captainName,
            t.contact,
            drawn,
            teamId,
          ],
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
  | "default_penalty_minutes"
  | "break_minutes"
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
    given("defaultPenaltyMinutes") ? penaltyLengthOf(o) : (series?.default_penalty_minutes ?? 2),
    given("breakMinutes") ? breakOf(o) : (series?.break_minutes ?? 2),
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
  const fields = [...(await tournamentFields(db, o)), ...rules, ...(await tournamentAfterOf(db, o))];
  const kind = rules[4] as Kind;
  const teams = teamsOf(o, kind);
  // Its teams' members checked before it goes in, as every other refusal is (#132): a refused create makes nothing
  const named = teams ? namedIn(teams) : [];
  if (named.length && (await first<{ n: number }>(db, KNOWN, [JSON.stringify(named)]))?.n !== named.length)
    throw new HttpError(400, "No such member.");
  const res = await run(
    db,
    `INSERT INTO tournaments (type_id, name, venue_id, location, map_url, held_on, start_time, end_time, capacity, status, fee_pence,
       season, public, signup_opens_on, signup_closes_on, draft_on, points_win, points_draw, points_loss,
       game_minutes, kind, awards, playoffs, penalty_rule, periods, default_penalty_minutes, break_minutes, after_mode,
       after_venue_id, after_time, after_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [typeId, ...fields],
  );
  const id = Number(res.meta.last_row_id);
  await setTeams(db, id, kind, teams);
  await syncTournament(db, id);
  return { id };
}

export async function updateTournament(
  db: D1Database,
  id: number,
  o: Record<string, unknown>,
  today: string,
  now: string,
) {
  const { typeId } = await seriesOf(db, o);
  const current = await first<
    Rules & {
      draft_state: string;
      after_mode: AfterMode;
      after_venue_id: number | null;
      after_time: string | null;
      after_note: string;
      signup_opens_on: string | null;
      signup_closes_on: string | null;
      status: string;
    }
  >(
    db,
    `SELECT points_win, points_draw, points_loss, game_minutes, kind, awards, playoffs, penalty_rule, periods, default_penalty_minutes,
       break_minutes, draft_state, after_mode, after_venue_id, after_time, after_note, signup_opens_on, signup_closes_on,
       status
     FROM tournaments WHERE id = ?`,
    [id],
  );
  if (!current) throw new HttpError(404, "No such tournament.");
  const rules = rulesOf(o, current);
  if (rules[4] !== current.kind && current.draft_state !== "none")
    throw new HttpError(409, "The draft has started: it stays a draft.");
  const after = await tournamentAfterOf(db, o, [
    current.after_mode,
    current.after_venue_id,
    current.after_time,
    current.after_note,
  ]);
  const stored = { opensOn: current.signup_opens_on, closesOn: current.signup_closes_on };
  // Its status moves on from its own page (Manage: Close sign-up, Move to…, ADR 0074), so the editor leaves it out
  // and it stays as it is; a save that names one still sets it
  const status = o.status ?? current.status;
  const fields = [...(await tournamentFields(db, { ...o, status }, stored)), ...rules, ...after];
  const kind = rules[4] as Kind;
  const teams = teamsOf(o, kind);
  // A limit raised moves the first waiting up into its room, in the same batch (ADR 0030)
  const [res] = await batch(db, [
    statement(
      db,
      `UPDATE tournaments SET type_id = ?, name = ?, venue_id = ?, location = ?, map_url = ?, held_on = ?, start_time = ?, end_time = ?, capacity = ?,
         status = ?, fee_pence = ?, season = ?, public = ?, signup_opens_on = ?, signup_closes_on = ?, draft_on = ?,
         points_win = ?, points_draw = ?, points_loss = ?, game_minutes = ?, kind = ?, awards = ?, playoffs = ?,
         penalty_rule = ?, periods = ?, default_penalty_minutes = ?, break_minutes = ?, after_mode = ?,
         after_venue_id = ?, after_time = ?, after_note = ?
       WHERE id = ?`,
      [typeId, ...fields, id],
    ),
    fillingUp(db, "tournament", { sql: "t.id = ?", params: [id] }, today, now),
  ]);
  if (!res.meta.changes) throw new HttpError(404, "No such tournament.");
  await setTeams(db, id, kind, teams);
  await syncTournament(db, id);
}

/** A tournament's name and day, while it exists (the record, ADR 0095). */
export const tournamentSummary = (db: D1Database, id: number) =>
  first<{ name: string; heldOn: string }>(db, "SELECT name, held_on heldOn FROM tournaments WHERE id = ?", [id]);
