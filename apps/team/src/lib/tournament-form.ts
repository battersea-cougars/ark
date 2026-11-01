// A tournament as its forms hold it (ADR 0030): the one shape the wizard (lib/TournamentQuickCreate) and the full
// editor (lib/TournamentDateEditor) fill in, the field groups both show (lib/Tournament*Fields), and the way to and
// from a saved tournament. Pure: what the forms do with it is theirs.
import { seasonEnd, seasonOf, seasonYear, type Season } from "@cougars/shared/seasons";
import type { AfterMode } from "@cougars/shared/places";
import type {
  Playoff,
  Tournament,
  TournamentKind,
  TournamentStatus,
  TournamentTeam,
  TournamentType,
} from "../demo/model";
import { withDecidedBy, type Award } from "./awards";
import { londonToday } from "./dates";
import type { PenaltyRule } from "./penalties";

export interface TournamentForm {
  id: number;
  /** Its series, or none: a tournament can stand on its own */
  typeId: number | null;
  name: string;
  /** Optional: empty while it's just a season (ADR 0030) */
  heldOn: string;
  /** Always: the season it's in, which a day sets */
  season: Season;
  seasonYear: number;
  startTime: string;
  endTime: string;
  /** Its place (ADR 0030); none set: its series' */
  venueId: number | null;
  location: string;
  mapUrl: string;
  /** Where everyone goes afterwards (ADR 0074): its series' (usual), its own, or none this time */
  afterMode: AfterMode;
  afterVenueId: number | null;
  afterTime: string | null;
  afterNote: string;
  capacity: number | null;
  /** In pounds, as typed */
  fee: string;
  public: boolean;
  signupOpensOn: string;
  signupClosesOn: string;
  draftOn: string;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  gameMinutes: number;
  penaltyRule: PenaltyRule;
  periods: number;
  defaultPenaltyMinutes: number;
  breakMinutes: number;
  kind: TournamentKind;
  awards: Award[];
  playoffs: Playoff[];
  /** A draft's captains are teams with only a captain, in no order (the draft draws it) */
  teams: TournamentTeam[];
}

/** A new one's season: next summer, unless this one is still to come. */
function nextSummer(today = londonToday()) {
  const year = Number(today.slice(0, 4));
  return today <= seasonEnd("summer", year) ? year : year + 1;
}

/** A new one, on its own until a series is picked: next summer, sign-up opening today, the usual round robin. */
export function blankForm(today = londonToday()): TournamentForm {
  return {
    id: 0,
    typeId: null,
    name: "",
    heldOn: "",
    season: "summer",
    seasonYear: nextSummer(today),
    startTime: "11:00",
    endTime: "16:00",
    venueId: null,
    location: "",
    mapUrl: "",
    afterMode: "usual",
    afterVenueId: null,
    afterTime: null,
    afterNote: "",
    capacity: 24,
    fee: "0",
    public: true,
    signupOpensOn: today,
    signupClosesOn: "",
    draftOn: "",
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    gameMinutes: 12,
    penaltyRule: "power_play",
    periods: 1,
    defaultPenaltyMinutes: 2,
    breakMinutes: 2,
    kind: "teams",
    awards: [],
    playoffs: [],
    teams: [],
  };
}

/** A saved one, to edit. */
export function formOf(t: Tournament): TournamentForm {
  return {
    id: t.id,
    typeId: t.typeId,
    name: t.name,
    // A season's day is only its stand-in, never shown
    heldOn: t.season ? "" : t.heldOn,
    season: t.season ?? seasonOf(t.heldOn).season,
    seasonYear: t.season ? seasonYear(t.season, t.heldOn) : seasonOf(t.heldOn).year,
    startTime: t.startTime,
    endTime: t.endTime,
    venueId: t.venueId,
    location: t.location,
    mapUrl: t.mapUrl,
    afterMode: t.afterMode ?? "usual",
    afterVenueId: t.afterVenueId ?? null,
    afterTime: t.afterTime ?? null,
    afterNote: t.afterNote ?? "",
    capacity: t.capacity,
    fee: String(t.feePence / 100),
    public: t.public,
    signupOpensOn: t.signupOpensOn ?? "",
    signupClosesOn: t.signupClosesOn ?? "",
    draftOn: t.draftOn ?? "",
    pointsWin: t.pointsWin,
    pointsDraw: t.pointsDraw,
    pointsLoss: t.pointsLoss,
    gameMinutes: t.gameMinutes,
    penaltyRule: t.penaltyRule ?? "power_play",
    periods: t.periods ?? 1,
    defaultPenaltyMinutes: t.defaultPenaltyMinutes ?? 2,
    breakMinutes: t.breakMinutes ?? 2,
    kind: t.kind,
    awards: withDecidedBy(t.awards),
    playoffs: (t.playoffs ?? []).map((g) => ({ ...g })),
    teams: t.teams.map((team) => ({ ...team, players: team.players.map((p) => ({ ...p })) })),
  };
}

/**
 * Picking a series copies its defaults in (ADR 0030, 0074): its usual hours, place, rules and awards, its type, its
 * name if there's none yet, and its fee unless anyone's paid (`charged`). They can then change for this one.
 */
export function withSeries(f: TournamentForm, t: TournamentType, { charged = false } = {}) {
  f.typeId = t.id;
  if (!f.name) f.name = t.name;
  if (!charged) f.fee = String(t.defaultFeePence / 100);
  f.startTime = t.defaultStartTime;
  f.endTime = t.defaultEndTime;
  f.venueId = t.venueId;
  f.location = t.location;
  f.mapUrl = t.mapUrl;
  f.pointsWin = t.pointsWin;
  f.pointsDraw = t.pointsDraw;
  f.pointsLoss = t.pointsLoss;
  f.gameMinutes = t.gameMinutes;
  f.penaltyRule = t.penaltyRule;
  f.periods = t.periods;
  f.defaultPenaltyMinutes = t.defaultPenaltyMinutes;
  f.breakMinutes = t.breakMinutes;
  f.kind = t.kind;
  f.awards = withDecidedBy(t.awards);
  f.playoffs = (t.playoffs ?? []).map((g) => ({ ...g }));
}

/** The next one in a series, as the wizard starts it: the series' defaults, next summer, sign-up opening today. */
export function nextInSeries(t: TournamentType, today = londonToday()): TournamentForm {
  const f = blankForm(today);
  withSeries(f, t);
  return f;
}

/** The day it sorts by: its own, else its season's last. */
export const formDay = (f: Pick<TournamentForm, "heldOn" | "season" | "seasonYear">) =>
  f.heldOn || seasonEnd(f.season, f.seasonYear);

/** A day sets the season it's in. */
export function setDay(f: TournamentForm, day: string) {
  f.heldOn = day;
  if (day) ({ season: f.season, year: f.seasonYear } = seasonOf(day));
}
/** A season the day isn't in clears the day. */
export function setSeason(f: TournamentForm, season: Season, year: number) {
  f.season = season;
  f.seasonYear = year;
  if (!f.heldOn) return;
  const s = seasonOf(f.heldOn);
  if (s.season !== season || s.year !== year) f.heldOn = "";
}

/** The fee typed, in pence; NaN when it isn't a sum of money. */
export function feePence(fee: string): number {
  const t = fee.trim().replace(/^£/, "");
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

/** As it's sent. `status`: never sent (lib/tournament-body.ts), its own page moves it on; kept as it is. */
export const toTournament = (f: TournamentForm, status: TournamentStatus = "planned"): Tournament => ({
  id: f.id,
  typeId: f.typeId,
  name: f.name,
  venueId: f.venueId,
  location: f.venueId ? "" : f.location.trim(),
  mapUrl: f.venueId ? "" : f.mapUrl.trim(),
  afterMode: f.afterMode,
  afterVenueId: f.afterMode === "own" ? f.afterVenueId : null,
  afterTime: f.afterMode === "own" ? f.afterTime : null,
  afterNote: f.afterMode === "own" ? f.afterNote.trim() : "",
  heldOn: formDay(f),
  season: f.heldOn ? null : f.season,
  startTime: f.startTime,
  endTime: f.endTime,
  capacity: f.capacity || null,
  status,
  feePence: feePence(f.fee) || 0,
  public: f.public,
  signupOpensOn: f.signupOpensOn || null,
  signupClosesOn: f.signupClosesOn || null,
  draftOn: f.kind === "draft" && f.draftOn ? f.draftOn : null,
  pointsWin: f.pointsWin,
  pointsDraw: f.pointsDraw,
  pointsLoss: f.pointsLoss,
  gameMinutes: f.gameMinutes,
  penaltyRule: f.penaltyRule,
  periods: f.periods,
  defaultPenaltyMinutes: f.defaultPenaltyMinutes,
  breakMinutes: f.breakMinutes,
  kind: f.kind,
  awards: f.awards.filter((a) => a.name.trim()),
  playoffs: f.playoffs.filter((g) => g.name.trim()),
  teams: f.teams,
  going: [],
  waitlist: [],
});
