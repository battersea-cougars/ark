// The team app's schedule model (ADR 0030). These are the shapes the D1 tables will have; the demo keeps them in
// memory. Training repeats (series → sessions); tournaments are scheduled one by one under a type; anything else
// is a one-off event. The calendar is all three together.
import type { IconName } from "../app/shell/icons";
import type { DatedFee } from "../lib/dues";
import type { Weekday } from "../lib/recurrence";
import type { Season } from "@cougars/shared/seasons";
import type { Venue } from "@cougars/shared/places";

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
  /** Who on a training's waitlist is a Quarterly Member, so goes ahead of those paying as they go (ADR 0030). The
   * waitlist already comes in that order; this is for the badge. */
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
  /** Where (ADR 0030): a saved venue, else a name and the map link pasted for it. */
  venueId: number | null;
  venue: string;
  mapUrl: string;
  /** Places for skaters; null: no limit. */
  capacity: number | null;
  /** Places for goalies, counted apart from the skaters; null: no limit. */
  goalieCapacity?: number | null;
  /** Listed on the public website calendar. */
  public: boolean;
  active: boolean;
  /** The fee per session, going forward from each date (ADR 0007). */
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
  /** How its tournaments make teams (ADR 0030). */
  kind: TournamentKind;
  active: boolean;
  /** Copied onto each new edition, where it can be changed. */
  defaultFeePence: number;
  /** Its usual hours, copied onto each new edition (ADR 0074). */
  defaultStartTime: string;
  defaultEndTime: string;
  /** What's handed out at each edition (ADR 0044), shown on the website. */
  awards: { name: string; about: string }[];
  /** The playoff games after the round robin, by table position (ADR 0061). */
  playoffs: Playoff[];
  /** Where its dates are, unless a date says otherwise (ADR 0030): a saved venue, else a name and map link. */
  venueId: number | null;
  location: string;
  mapUrl: string;
}

export type TournamentStatus = "planned" | "open" | "live" | "finished";

/** How a tournament makes its teams (ADR 0030): teams enter (a name, a captain, players), or captains draft members. */
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
  players: { memberId: number | null; name: string; pick?: number | null }[];
}

/** One edition, scheduled on its own: a name, a location, a date. */
export interface Tournament extends Entries {
  id: number;
  /** Its series (a tournament type), if it has one: a tournament can stand on its own. */
  typeId: number | null;
  name: string;
  /** Its own place: a saved venue, else a name and map link; none of them, its series' (ADR 0030). */
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
  /** Just a season so far, "Summer 2027" (ADR 0030): heldOn is then the season's last day, never shown. Null: heldOn is the day. */
  season: Season | null;
  /** Listed on the website. */
  public: boolean;
  /** The last day members can say they're in; null: up to the day. */
  /** Sign-up opens by itself on this day (ADR 0074), unless opened by hand. */
  signupOpensOn: string | null;
  signupClosesOn: string | null;
  /** Its own rules and awards, copied from its series and changed for it if need be (ADR 0030). */
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  gameMinutes: number;
  /** How it makes teams (ADR 0030): teams enter, or captains draft members. */
  kind: TournamentKind;
  awards: { name: string; about: string }[];
  /** The captains' draft, for a drafted one. */
  draftOn: string | null;
  /** Where its draft is (ADR 0060): none, scheduled (a day and captains), open (captains pick), closed (locked). */
  draftState?: DraftState;
  /** Its playoffs (copied from its series, ADR 0061), and its games once the fixtures are made. */
  playoffs: Playoff[];
  games?: TournamentGame[];
  /** Who won its awards (ADR 0044): a team or a player on one, by award name. */
  winners?: { award: string; teamId: number | null; memberId: number | null }[];
  /** Its teams: in pick order for a draft, else in the order they entered. */
  teams: TournamentTeam[];
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
  /** Where it really is (ADR 0030); "" for nowhere yet. */
  venue: string;
  address?: string;
  /** Opens the map. */
  mapUrl?: string;
  signup: boolean;
  capacity?: number | null;
  cancelled?: boolean;
  description?: string;
  /** The date isn't confirmed: shown as "TBC", sorted by the date it has. */
  dateTbc?: boolean;
  /** Just a season so far: shown as "Summer 2027" instead (ADR 0030). */
  season?: { name: string; year: number };
  href?: string;
  /** Said instead of its times: a reminder's ("Last day to say you're in", "Time to be set"). */
  timeText?: string;
  entries: Entries;
}

/** Where a captains' draft is (ADR 0060). */
export type DraftState = "none" | "scheduled" | "open" | "closed";

/** A playoff game by table position (ADR 0061): "Final", 1st v 2nd. */
export interface Playoff {
  name: string;
  home: number;
  away: number;
}

/** One of a tournament's games (ADR 0061): its round robin, then its playoffs (seeds until the table fills them). */
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
  /** The team suggested to keep score: one sitting it out (ADR 0061); null until its teams are known. */
  scoringTeamId?: number | null;
  /** Who holds the scoresheet: whoever pressed Start scoring. Only they score it. */
  keeperId?: number | null;
  /** The game clock: time left when it last stopped, and when it was started again (null: stopped). */
  clockLeftMs?: number | null;
  clockStartedAt?: string | null;
  /** Each goal as it went in, in order. */
  goals?: { id: number; teamId: number; scorerId: number | null; assistId: number | null; atMs: number }[];
}

/** A row of the club's agenda (ADR 0042, packages/shared/agenda.ts): what's on and when, from today. */
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
