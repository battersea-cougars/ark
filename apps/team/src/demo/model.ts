// The team app's schedule model (apps/team/worker/training/README.md), in the D1 tables' shapes: training repeats
// (series → sessions), tournaments are scheduled one by one under a type, anything else is a one-off event. The
// calendar is all three together.
import type { Award } from "../lib/awards";
import type { PenaltyRule } from "../lib/penalties";
import type { IconName } from "../app/shell/icons";
import type { DatedFee } from "../lib/dues";
import type { Weekday } from "../lib/recurrence";
import type { Phase } from "../lib/phase";
import type { Season } from "@cougars/shared/seasons";
import type { AfterMode, Venue } from "@cougars/shared/places";

export type { Venue };

/** The colours an admin can give a training or tournament, so each is easy to spot (app.css --tone-*). */
export const TONES = ["red", "blue", "green", "amber", "violet", "teal"] as const;
export type Tone = (typeof TONES)[number];

/** Icons an admin can pick for a training or a tournament. */
export const SCHEDULE_ICONS = ["stick", "skate", "whistle", "puck", "swords", "trophy", "medal", "flag"] as const;
export type ScheduleIcon = (typeof SCHEDULE_ICONS)[number] & IconName;

/** Who's in and who's waiting. In D1 this is the attendance / tournament_entries rows. */
export interface Entries {
  going: number[];
  waitlist: number[];
  /** Who signed up for a training (in or waiting) is a Quarterly skater, so comes before those paying as they go
   * (apps/team/worker/training/README.md). The lists already come in that order; this is for the badge. */
  quarterly?: number[];
  /** Who said they're out. Not answering isn't out: someone in none of the lists hasn't said yet. */
  out?: number[];
}

/** A repeating training, e.g. Friday Training. Sessions inherit everything they don't override. */
export interface TrainingSeries {
  id: number;
  slug: string;
  name: string;
  /** The phone tab label when it's the only training, e.g. "Friday". */
  shortName: string;
  icon: ScheduleIcon;
  tone: Tone;
  repeatEvery: number;
  weekdays: Weekday[];
  startsOn: string;
  endsOn: string | null;
  startTime: string;
  endTime: string;
  /** Where (apps/team/worker/training/README.md): a saved venue, else a name and the map link pasted for it. */
  venueId: number | null;
  venue: string;
  mapUrl: string;
  /** Places for skaters; null: no limit. */
  capacity: number | null;
  /** Places for goalies, counted apart from the skaters; null: no limit. */
  goalieCapacity?: number | null;
  /** A night's sign-up opens this many days before it, at midnight London (lib/signup.ts; Friday: 4, the Monday);
   * null or unset: always open. */
  signupOpensDays?: number | null;
  /** Listed on the public website calendar. */
  public: boolean;
  active: boolean;
  /** The fee per session, going forward from each date (apps/team/worker/dues/README.md). */
  fees: DatedFee[];
}

/** One night of a series. Null fields follow the series. */
export interface TrainingSession extends Entries {
  id: number;
  seriesId: number;
  heldOn: string;
  movedFrom?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  /** Somewhere else this week; none of the three: the series'. */
  venueId?: number | null;
  venue?: string | null;
  mapUrl?: string | null;
  capacity?: number | null;
  note?: string | null;
  cancelledAt?: string | null;
  /** Why it's off (apps/team/worker/training/README.md): called off by hand, and the tournaments on its day it's off for. */
  offByHand?: boolean;
  offFor?: number[];
  /** The fee for this session: written when the register closes, or an admin's override. */
  feePence?: number | null;
  /** Who came, once the register is closed. */
  attended?: number[];
  /** From the register on the night: who came without signing up (they're added to `going`), and who signed up
   * but didn't come (they stay in `going`). Browser-only until attendance is stored. */
  walkIns?: number[];
  noShows?: number[];
  registerClosedAt?: string | null;
}

/** A kind of tournament the club hosts, e.g. The Cougars Kumite: the format and rules every edition shares. */
export interface TournamentType {
  id: number;
  slug: string;
  name: string;
  shortName: string;
  icon: ScheduleIcon;
  tone: Tone;
  format: "round_robin";
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  gameMinutes: number;
  /** How a penalty's served (apps/team/worker/tournaments/README.md), copied onto each new edition. */
  penaltyRule: PenaltyRule;
  /** A game's periods (1 to 3), each gameMinutes long (apps/team/worker/tournaments/README.md), copied onto each new edition. */
  periods: number;
  /** The penalty sheet's usual length (2, 4 or 5, apps/team/worker/tournaments/README.md), copied onto each new edition. */
  defaultPenaltyMinutes: number;
  /** The break between periods, in minutes (apps/team/worker/tournaments/README.md), copied onto each new edition. */
  breakMinutes: number;
  /** How its tournaments make teams (apps/team/worker/training/README.md). */
  kind: TournamentKind;
  active: boolean;
  /** Copied onto each new edition, where it can be changed. */
  defaultFeePence: number;
  /** Its usual hours, copied onto each new edition (apps/team/worker/tournaments/README.md). */
  defaultStartTime: string;
  defaultEndTime: string;
  /** What's handed out at each edition (apps/team/worker/tournaments/README.md), shown on the website, each saying how it's decided. */
  awards: Award[];
  /** The playoff games after the round robin, by table position (apps/team/worker/tournaments/README.md). */
  playoffs: Playoff[];
  /** Where its dates are, unless a date says otherwise (apps/team/worker/training/README.md): a saved venue, else a name and map link. */
  venueId: number | null;
  location: string;
  mapUrl: string;
  /** Where everyone goes afterwards, every one of its dates unless one says otherwise (apps/team/worker/tournaments/README.md): a saved venue (none:
   *  nowhere), an optional time and what for ("Celebration and awards"). */
  afterVenueId: number | null;
  afterTime: string | null;
  afterNote: string;
  /** Its house rules (apps/team/worker/tournaments/README.md), as an admin writes them, a rule a line: under Format & rules. */
  houseRules: string;
}

export type TournamentStatus = "planned" | "open" | "live" | "finished";

/** How a tournament makes its teams (apps/team/worker/training/README.md): teams enter (a name, a captain, players), or captains draft members. */
export type TournamentKind = "teams" | "draft";
export const TOURNAMENT_KINDS: { id: TournamentKind; label: string; hint: string }[] = [
  { id: "teams", label: "Teams enter", hint: "Teams sign up with a name, a captain and their players." },
  { id: "draft", label: "Captains draft", hint: "Members sign up; captains draft them into teams." },
];
export const kindLabel = (kind: TournamentKind) => TOURNAMENT_KINDS.find((k) => k.id === kind)?.label ?? kind;

/** A team in a tournament: its captain is a member, or (a team from outside) a name and how to reach them. */
export interface TournamentTeam {
  id?: number;
  name: string;
  /** A small image (a data: URL); null: its initials. */
  logo: string | null;
  captainMemberId: number | null;
  captainName: string;
  contact: string;
  /**
   * Members, or players from outside the club by name, in order (a draft's in the order they were picked). `pick`:
   * the draft pick that brought them (its order across the whole draft); null when an admin put them on directly.
   */
  players: {
    memberId: number | null;
    name: string;
    pick?: number | null;
    /** Who made the pick: its captain, or whoever ran the draft picking for them (apps/team/worker/tournaments/README.md). */
    pickedBy?: number | null;
  }[];
  /** A draft's pick order, from 1, once it's drawn (apps/team/worker/tournaments/README.md); null till then, and for a team that entered. */
  pick?: number | null;
}

/** One edition, scheduled on its own: a name, a location, a date. */
export interface Tournament extends Entries {
  id: number;
  /** Its series (a tournament type), if it has one: a tournament can stand on its own. */
  typeId: number | null;
  name: string;
  /** Its own place: a saved venue, else a name and map link; none of them, its series' (apps/team/worker/training/README.md). */
  venueId: number | null;
  location: string;
  mapUrl: string;
  heldOn: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  status: TournamentStatus;
  champions?: string | null;
  feePence: number;
  /** Just a season so far, "Summer 2027" (apps/team/worker/training/README.md): heldOn is then the season's last day, never shown. Null: heldOn is the day. */
  season: Season | null;
  /** Listed on the website. */
  public: boolean;
  /** The last day members can say they're in; null: up to the day. */
  /** Sign-up opens by itself on this day (apps/team/worker/tournaments/README.md), unless opened by hand. */
  signupOpensOn: string | null;
  signupClosesOn: string | null;
  /** When an admin closed sign-up early (apps/team/worker/tournaments/README.md), its dates left as they were; null: they haven't. */
  signupClosedAt?: string | null;
  /** Its own rules and awards, copied from its series and changed for it if need be (apps/team/worker/training/README.md). */
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  gameMinutes: number;
  /** How a penalty's served, copied from its series (apps/team/worker/tournaments/README.md); left out on a save, it keeps what it was. */
  penaltyRule?: PenaltyRule;
  /** A game's periods, each gameMinutes long, copied from its series (apps/team/worker/tournaments/README.md); left out, it keeps what it was. */
  periods?: number;
  /** The penalty sheet's usual length, copied from its series (apps/team/worker/tournaments/README.md); left out, it keeps what it was. */
  defaultPenaltyMinutes?: number;
  /** The break between periods, copied from its series (apps/team/worker/tournaments/README.md); left out, it keeps what it was. */
  breakMinutes?: number;
  /** How it makes teams (apps/team/worker/training/README.md): teams enter, or captains draft members. */
  kind: TournamentKind;
  awards: Award[];
  /** The captains' draft, for a drafted one. */
  draftOn: string | null;
  /** Where its draft is (apps/team/worker/tournaments/README.md): none, scheduled (a day and captains), open (captains pick), closed (locked). */
  draftState?: DraftState;
  /** Its playoffs (copied from its series, apps/team/worker/tournaments/README.md), and its games once the fixtures are made. */
  playoffs: Playoff[];
  games?: TournamentGame[];
  /** Who won its awards (apps/team/worker/tournaments/README.md): a team or a player on one, by award name. A member is sent an award's winner on
   *  its evening only once it's been revealed. */
  winners?: { award: string; teamId: number | null; memberId: number | null; title?: string | null }[];
  /** How many of its awards have been revealed at the after-party, in the order listed (apps/team/worker/tournaments/README.md). */
  awardsRevealed?: number;
  /** The after-party's one card, a drum (apps/team/worker/tournaments/README.md): rolled on from the last one revealed to the next, sealed. */
  awardsNext?: boolean;
  /** When an admin confirmed the awards the data decides (apps/team/worker/tournaments/README.md); null: not yet. */
  awardsConfirmedAt?: string | null;
  /** Each voted award's votes (apps/team/worker/tournaments/README.md), cast till the awards are confirmed: how many are in, and the one you cast
   *  (never anyone else's). */
  votes?: { award: string; cast: number; mine: number | null }[];
  /** The judges' call's name tonight, once the awards are confirmed (apps/team/worker/tournaments/README.md): everyone's, before it's revealed. */
  /** The awards given (once confirmed), each with the judges' call's name tonight, if it's one; never who won. */
  titles?: { award: string; title: string | null }[];
  /** Its teams: in pick order for a draft, else in the order they entered. */
  teams: TournamentTeam[];
  /** Where everyone goes afterwards (apps/team/worker/tournaments/README.md): its series' (usual), its own (the three below), or none this time.
   *  Left out on a save, it keeps what it had. */
  afterMode?: AfterMode;
  afterVenueId?: number | null;
  afterTime?: string | null;
  afterNote?: string;
}

/** Anything else on the calendar: a social, a kit day. */
export interface OneOff extends Entries {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
  /** A saved venue, else a name and the map link pasted for it. */
  venueId: number | null;
  venue: string;
  mapUrl: string;
  /** A line or two, shown on the website and on the card. */
  description: string;
  /** Listed on the website's What's on. */
  public: boolean;
  signup: boolean;
  capacity?: number | null;
  cancelledAt: string | null;
}

/** What the calendar and the In/Out card show, whatever the source. `entries` is the source's own list. */
export interface Bookable {
  key: string;
  kind: "training" | "tournament" | "social";
  /** The calendar filter it belongs to: "series:1", "type:1", "social". */
  filter: string;
  icon: IconName;
  tone: Tone;
  title: string;
  startsAt: string;
  endsAt: string;
  /** Where it really is (apps/team/worker/training/README.md); "" for nowhere yet. */
  venue: string;
  address?: string;
  /** Opens the map. */
  mapUrl?: string;
  signup: boolean;
  /** Places (a training's: the skaters'); null: no limit. */
  capacity?: number | null;
  /** A training's places for keepers, counted apart (lib/places.ts); null or unset: no limit. */
  goalieCapacity?: number | null;
  cancelled?: boolean;
  description?: string;
  /** The date isn't confirmed: shown as "TBC", sorted by the date it has. */
  dateTbc?: boolean;
  /** Just a season so far: shown as "Summer 2027" instead (apps/team/worker/training/README.md). */
  season?: { name: string; year: number };
  href?: string;
  /** Said instead of its times: a reminder's ("Last day to say you're in", "Time to be set"). */
  timeText?: string;
  /** A training night whose sign-up isn't open yet: when it opens, short ("Mon", "Mon 19 Oct"), said where In would
   * be. Unset: open. */
  opens?: string;
  /** A tournament that's started (lib/edition.ts hasStarted), or a training night that has (apps/team/worker/training/README.md): who's in
   * is an admin's or the register's to change, so In and Out are a line in their place (apps/team/worker/tournaments/README.md). */
  started?: boolean;
  /** That line, where it isn't "Ask an admin to change it": a training's, started or over. */
  startedWords?: string;
  /** Past, on or next, by its status, never its date (lib/phase.ts, apps/team/worker/tournaments/README.md): what Home and the calendar go by. */
  phase: Phase;
  entries: Entries;
}

/** Where a captains' draft is (apps/team/worker/tournaments/README.md). */
export type DraftState = "none" | "scheduled" | "open" | "closed";

/** A playoff game by table position (apps/team/worker/tournaments/README.md): "Final", 1st v 2nd. */
export interface Playoff {
  name: string;
  home: number;
  away: number;
}

/** One of a tournament's games (apps/team/worker/tournaments/README.md): its round robin, then its playoffs (seeds until the table fills them). */
export interface TournamentGame {
  id: number;
  stage: "group" | "playoff";
  round: number;
  position: number;
  name: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeSeed: number | null;
  awaySeed: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  status: "next" | "live" | "done";
  /** The team suggested to keep score: one sitting it out (apps/team/worker/tournaments/README.md); null until its teams are known. */
  scoringTeamId?: number | null;
  /** Who holds the scoresheet: whoever pressed Start scoring. Only they score it. */
  keeperId?: number | null;
  /** The game clock: time left when it last stopped, and when it was started again (null: stopped). */
  clockLeftMs?: number | null;
  clockStartedAt?: string | null;
  /** The period being played (apps/team/worker/tournaments/README.md): the clock counts each down in turn. */
  period?: number;
  /** When the last period ended: the break before this one, until its clock starts (apps/team/worker/tournaments/README.md). */
  periodEndedAt?: string | null;
  /** When it actually kicked off: the first Start of its clock (null: not yet). The card shows it once it's on. */
  startedAt?: string | null;
  /** Each goal as it went in, in order: its period and the time into it. */
  goals?: {
    id: number;
    teamId: number;
    scorerId: number | null;
    assistId: number | null;
    atMs: number;
    period?: number | null;
  }[];
  /** Each penalty as it was called, in order (lib/penalties.ts works out the penalty clock). */
  penalties?: GamePenalty[];
}

/** A penalty (apps/team/worker/tournaments/README.md): who (null: a bench penalty, or nobody said), 2 or 5 minutes, what for, when in game time. */
export interface GamePenalty {
  id: number;
  teamId: number;
  memberId: number | null;
  minutes: number;
  /** lib/penalties.ts INFRACTIONS, or "" when nobody said. */
  infraction: string;
  atMs: number | null;
  /** Which period (atMs is the time into it); null with no time. */
  period?: number | null;
  recordedBy?: number | null;
}

/** A row of the club's agenda (ADR 0016, packages/shared/agenda.ts): what's on and when, from today. */
export interface AgendaRow {
  key: string;
  source: "session" | "tournament" | "club_event";
  sourceId: number;
  kind: "training" | "tournament" | "draft" | "signup_closes" | "event";
  /** The calendar's filter: series:1, type:1, tournament, social. */
  group: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  day: string;
  allDay: boolean;
  dateTbc: boolean;
  season: string | null;
  venue: string;
  mapUrl: string;
  description: string;
  public: boolean;
  cancelled: boolean;
  audience: "everyone" | "captains";
}
