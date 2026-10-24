// The club's data as the app holds it: the core filled from D1 by /api/bootstrap before the app mounts
// (app/backend.ts), each page's parts as it's opened (app/page-data.svelte.ts, #178); after a change, only the parts
// it touched come back and are put in place (applySlices). The core's and the pages' parts of one list (everyone,
// the nights, the tournaments, what's owed) are kept apart and put together (app/club-whole.ts), so a page reads one
// list whichever they came from. The shapes match the D1 tables (docs/team-app-data-model.md).
import type { Action } from "../access/actions";
import { allOn, type NotificationPrefs } from "../lib/notification-topics";
import type { IconName } from "../app/shell/icons";
import type { AgendaRow, OneOff, Tournament, TournamentType, TrainingSeries, TrainingSession, Venue } from "./model";
import type { Quip } from "../lib/quips";
import type { Team } from "../lib/balance";
import type { Charge, DatedFee, Owed } from "../lib/dues";
import type { UsageLevel } from "../lib/usage-near";
import { duesOf, membersOf, nightsOf, tournamentsOf } from "../app/club-whole";

export type Position = "F" | "D" | "G";
export const POSITIONS: Record<Position, string> = { F: "Forward", D: "Defence", G: "Keeper" };
/** Each position's icon on a pick (the brand's Pick): a stick up front, a shield at the back, the net. */
export const POSITION_ICONS = { F: "stick", D: "shield", G: "net" } as const satisfies Record<Position, IconName>;

export interface Player {
  id: number;
  name: string;
  position: Position;
  rating: number;
  cougar: boolean;
  /** On the back of their card. */
  bio?: string;
  /** How their name shows on the website roster; null: first name and initial. */
  webName?: string | null;
  /** Training sessions they came to. */
  played?: number;
}

/** Everyone in the club. Filled by hydrate(). */
export const PLAYERS: Player[] = [];

/** Who you really are (the signed-in member). */
export let REAL_ID = 0;
/** Dev tools are here (outside production, for whoever sets the club's settings; ADR 0027). */
export let DEV_TOOLS = false;
/** Screens still on demo data (Upload) are shown: dev and local only (#63). */
export let UNFINISHED = false;
/** The Kumite simulator is here, for you (dev and your own machine, whoever runs tournaments; ADR 0123). */
export let SIMULATOR = false;
/** The role you run the app as day to day, if not your full one (ADR 0024). Read once by session.svelte.ts startSession. */
export let EVERYDAY_ROLE: number | null = null;
/** The member the server answers this sign-in as, when an admin is viewing the app as them (ADR 0024). */
export let VIEWING_AS: number | null = null;
/** What the server lets this sign-in do: while viewing as someone, the member's actions (ADR 0024). */
export let ACTIONS: Action[] = [];

const EMAILS = new Map<number, string | null>();
const REFERENCES = new Map<number, string | null>();
const PHONES = new Map<number, string | null>();
/** Only yours, unless you manage members. */
export const phoneFor = (id: number) => PHONES.get(id) ?? null;
export const emailFor = (p: Player) => EMAILS.get(p.id) ?? "No email yet";
/** Their bank reference (ADR 0007), or a dash: one that isn't sent is never made up, as it's what they pay with. */
export const referenceFor = (id: number) => REFERENCES.get(id) ?? "—";

export const VENUES: Venue[] = [];
export const SERIES: TrainingSeries[] = [];
export const SESSIONS: TrainingSession[] = [];
export const TOURNAMENT_TYPES: TournamentType[] = [];
export const TOURNAMENTS: Tournament[] = [];
/** The club's agenda, from today (ADR 0042). */
export const AGENDA: AgendaRow[] = [];
/** Where members pay by transfer (ADR 0007). */
export interface Bank {
  name: string;
  sortCode: string;
  account: string;
}
/**
 * The club's settings for the app: how often live pages check for updates (ADR 0072), and the club's bank details
 * (ADR 0007), null until whoever sets fees fills them in.
 */
export const SETTINGS: { liveRefreshSeconds: number; bank: Bank | null } = { liveRefreshSeconds: 10, bank: null };
export const ONE_OFFS: OneOff[] = [];
/** What your phone tells you: a choice per topic, on until you turn it off (ADR 0108). */
export const NOTIFICATIONS: NotificationPrefs = allOn();

export interface Role {
  id: number;
  name: string;
  description: string;
  system: boolean;
  actions: Action[];
}
export const ROLES: Role[] = [];

/** A member's plan (ADR 0007): Quarterly, pay as you go, or, for a keeper, free (the Keeper plan). */
export type Plan = "Subscription" | "Pay as you go" | "Keeper";
/** Keepers play training free, whatever else is on record; the rest by their quarterly membership. */
export const planOf = (position: string, quarterly: boolean): Plan =>
  position === "G" ? "Keeper" : quarterly ? "Subscription" : "Pay as you go";
/** A plan as people say it */
export const PLAN_NAMES: Record<Plan, string> = {
  Subscription: "Quarterly Member",
  "Pay as you go": "Pay as you go",
  Keeper: "Keeper · plays free",
};

export interface MemberRow {
  player: Player;
  status: "pending" | "active" | "inactive";
  /** Highest first: Admin, then the others, Member last. */
  roles: string[];
  /** A Quarterly Member today, from `subscriptions` (ADR 0007); a keeper plays training free (the Keeper plan);
   * everyone else pays as they go. */
  plan: Plan;
  /** Next quarter's: what they chose, or this one running on. Only your own (false for anyone else). */
  planNext: Plan;
  /** The role their app opens as (ADR 0024); null: their full role. Only if you see roles. */
  everydayRoleId: number | null;
}
export const MEMBERS: MemberRow[] = [];

/** The quarterly rate, from each date (ADR 0007). */
export const SUBSCRIPTION_FEES: DatedFee[] = [];
/** Your own charges with something left to pay (ADR 0007, #177); the rest of your ledger is read a page at a time. */
export const CHARGES: Charge[] = [];
/** When each member was last reminded of what they owe (ADR 0007): for who sees everyone's dues. */
export const REMINDERS: { memberId: number; at: string }[] = [];
/** What each owes, by age, and their credit: your own, or everyone's if you see Unpaid fees (ADR 0007, #177). */
export const DUES: Owed[] = [];

/** What /api/bootstrap sends (apps/team/worker/api/api.ts). */
export interface Bootstrap {
  /** Who you are: whoever signed in, even while viewing as someone. */
  me: number;
  /** The member you're viewing the app as (ADR 0024): the server answers as them, read-only. */
  viewingAs?: number | null;
  actions: Action[];
  devTools?: boolean;
  /** Screens still on demo data (Upload) are shown: not in production (#63). */
  unfinished?: boolean;
  /** The Kumite simulator is here, and yours to use (ADR 0123): dev and your own machine only. */
  simulator?: boolean;
  /** The role the app opens as, when it isn't your full one (ADR 0024). */
  everydayRole: number | null;
  /** Home's people (#178): you in full, who you really are while viewing as someone, whoever's in your next things. */
  people: MemberJson[];
  /** Everyone (a page's, #178): your own private details are in `people`. */
  members?: MemberJson[];
  roles: Role[];
  venues: Venue[];
  series: TrainingSeries[];
  /** The nights from tonight, each with its sign-ups and teams. */
  sessions: SessionJson[];
  /** The weeks just held (a page's, #178). */
  pastSessions?: SessionJson[];
  tournamentTypes: TournamentType[];
  /** Home's and the calendar's: every one not played yet, and the last fortnight's. */
  tournaments: Tournament[];
  /** Each series' last one played, its front door's "last time" (a page's, #178). */
  lastPlayed?: Tournament[];
  clubEvents: OneOff[];
  quips: Quip[];
  /** Home's announcements (#85): the two newest still on, less any you dismissed. */
  announcements: Announcement[];
  /** What's on from today (ADR 0042). */
  agenda: AgendaRow[];
  settings: { liveRefreshSeconds: number; bank: Bank | null };
  charges: Charge[];
  /** When each was last reminded of what they owe (a page's, #178): for who sees everyone's dues. */
  reminders?: { memberId: number; at: string }[];
  /** Your own line of what you owe. */
  dues: Owed[];
  /** Everyone's (a page's, #178), for who sees Unpaid fees. */
  clubDues?: Owed[];
  subscriptionFees: DatedFee[];
  /** Your own notifications, a choice per topic (ADR 0108). */
  notifications: NotificationPrefs;
  /** What only admins act on, for Home's For admins: the free limits getting close (ADR 0059), the email stopped. */
  forAdmins: ForAdmins;
}

/** A member as the club read sends them. */
interface MemberJson {
  id: number;
  name: string;
  email: string | null;
  position: Position;
  rating: number;
  cougar: boolean;
  status: MemberRow["status"];
  paymentReference: string | null;
  roles: string[];
  bio: string;
  webName: string | null;
  phone: string | null;
  played: number;
  quarterly: boolean;
  quarterlyNext: boolean;
  everydayRoleId: number | null;
}
type SessionJson = TrainingSession & { teams: Team[] };

/** Home's For admins, from the server with the club, so its lines are there on first paint. */
export interface ForAdmins {
  /** The free limits at 70% or more, nearest first (lib/usage-near.ts); none for anyone who doesn't see Usage. */
  usage: UsageLevel[];
  /** Google cancelled the email's token (ADR 0027): for whoever looks after it (manage:Settings), nobody else. */
  emailStopped: boolean;
  /** What the club is owed in all (#178): the total, by how many, how much is over 90 days; null unless you see it. */
  owed: { total: number; people: number; worst: number } | null;
  /** Who's asking to join (#178), for whoever manages members. */
  asking: string[];
}
export const FOR_ADMINS: ForAdmins = { usage: [], emailStopped: false, owed: null, asking: [] };

/** Home's lines, from D1. */
export const QUIPS: Quip[] = [];
/** An admin's note at the top of Home (#85), until its last day. */
export interface Announcement {
  id: number;
  title: string;
  body: string;
  link: string | null;
  endsOn: string;
  createdAt: string;
}
export const ANNOUNCEMENTS: Announcement[] = [];
/** Published teams, by session id. */
export const TEAMS: Record<number, Team[]> = {};

const fill = <T>(list: T[], items: T[]) => list.splice(0, list.length, ...items);

/** The parts of the club's data that a change sends back (worker/api/api.ts SLICES): all of it but who you are. */
export type Slices = Partial<Omit<Bootstrap, "me" | "viewingAs" | "actions" | "devTools" | "unfinished" | "simulator">>;

/** Put the club's data in place (app/backend.svelte.ts copies it into the store). Runs before the app mounts, and again
 * whenever the whole club is reloaded. */
export function hydrate(b: Bootstrap) {
  REAL_ID = b.me;
  VIEWING_AS = b.viewingAs ?? null;
  ACTIONS = b.actions;
  DEV_TOOLS = !!b.devTools;
  UNFINISHED = !!b.unfinished;
  SIMULATOR = !!b.simulator;
  applySlices(b);
}

/** The lists that come in two parts, the core's and a page's (#178). */
const TWO_PART = [
  "people",
  "members",
  "sessions",
  "pastSessions",
  "tournaments",
  "lastPlayed",
  "dues",
  "clubDues",
] as const;
/** Each of those parts as it last came. */
const SOURCES: Pick<Slices, (typeof TWO_PART)[number]> = {};

/** Everyone, as the store holds them: their details, and the private ones apart (only yours, unless you see them). */
function putMembers(members: MemberJson[]) {
  EMAILS.clear();
  REFERENCES.clear();
  PHONES.clear();
  const players = members.map((m) => {
    EMAILS.set(m.id, m.email);
    REFERENCES.set(m.id, m.paymentReference);
    PHONES.set(m.id, m.phone);
    const { id, name, position, rating, cougar, bio, webName, played } = m;
    return { id, name, position, rating, cougar, bio, webName, played };
  });
  fill(PLAYERS, players);
  fill(
    MEMBERS,
    members.map((m, i) => ({
      player: players[i],
      status: m.status,
      roles: m.roles,
      plan: planOf(m.position, m.quarterly),
      planNext: planOf(m.position, m.quarterlyNext),
      everydayRoleId: m.everydayRoleId ?? null,
    })),
  );
}

/** Put the parts of the club's data that came back in place; the rest stays as it is. */
export function applySlices(b: Slices) {
  for (const key of TWO_PART) if (b[key]) Object.assign(SOURCES, { [key]: b[key] });
  if (b.everydayRole !== undefined) EVERYDAY_ROLE = b.everydayRole;
  if (b.people || b.members) putMembers(membersOf(SOURCES.members, SOURCES.people ?? [], VIEWING_AS ?? REAL_ID));
  if (b.roles) fill(ROLES, b.roles);
  if (b.venues) fill(VENUES, b.venues);
  if (b.series) fill(SERIES, b.series);
  if (b.sessions || b.pastSessions) {
    const nights = nightsOf(SOURCES.sessions ?? [], SOURCES.pastSessions);
    fill(
      SESSIONS,
      nights.map(({ teams: _, ...s }) => s),
    );
    for (const k of Object.keys(TEAMS)) delete TEAMS[Number(k)];
    for (const s of nights) if (s.teams.length) TEAMS[s.id] = s.teams;
  }
  if (b.quips) fill(QUIPS, b.quips);
  if (b.announcements) fill(ANNOUNCEMENTS, b.announcements);
  if (b.tournamentTypes) fill(TOURNAMENT_TYPES, b.tournamentTypes);
  if (b.tournaments || b.lastPlayed) fill(TOURNAMENTS, tournamentsOf(SOURCES.tournaments ?? [], SOURCES.lastPlayed));
  if (b.clubEvents) fill(ONE_OFFS, b.clubEvents);
  if (b.agenda) fill(AGENDA, b.agenda);
  if (b.settings) Object.assign(SETTINGS, b.settings);
  if (b.charges) fill(CHARGES, b.charges);
  if (b.reminders) fill(REMINDERS, b.reminders);
  if (b.dues || b.clubDues) fill(DUES, duesOf(SOURCES.dues ?? [], SOURCES.clubDues));
  if (b.subscriptionFees) fill(SUBSCRIPTION_FEES, b.subscriptionFees);
  if (b.notifications) Object.assign(NOTIFICATIONS, b.notifications);
  if (b.forAdmins) Object.assign(FOR_ADMINS, b.forAdmins);
}

/** The old app's names: the Cougar players' team is "Cougars", the rest are colours. */
export const TEAM_NAMES = ["Cougars", "White", "Black", "Red", "Gold"];
/** Display order, also from the old app: Cougars, then Black, then White. */
export const TEAM_ORDER: Record<string, number> = { Cougars: 0, Black: 1, White: 2, Red: 3, Gold: 4 };
