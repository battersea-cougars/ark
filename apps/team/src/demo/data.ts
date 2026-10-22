// The club's data as the app holds it: filled from D1 by /api/bootstrap before the app mounts (app/backend.ts);
// after a change, only the parts it touched come back and are put in place (applySlices). The shapes match the D1 tables (docs/team-app-data-model.md).
import type { Action } from "../access/actions";
import { allOn, type NotificationPrefs } from "../lib/notification-topics";
import type { IconName } from "../app/shell/icons";
import type { AgendaRow, OneOff, Tournament, TournamentType, TrainingSeries, TrainingSession, Venue } from "./model";
import type { Quip } from "../lib/quips";
import type { Team } from "../lib/balance";
import type { Charge, DatedFee, Payment } from "../lib/dues";

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
  /** The name their team takes as a Kumite captain (ADR 0060); "" the automatic one. Your own, or an admin's view. */
  kumiteTeamName?: string | null;
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
/** The role you run the app as day to day, if not your full one (ADR 0024). Read once by session.svelte.ts startSession. */
export let EVERYDAY_ROLE: number | null = null;

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
/** Charges: your own, or everyone's if you see Unpaid fees (ADR 0007). */
export const CHARGES: Charge[] = [];
/** When each member was last reminded of what they owe (ADR 0007): for who sees everyone's dues. */
export const REMINDERS: { memberId: number; at: string }[] = [];
/** Each payment: your own, or everyone's if you see Unpaid fees; for the dues ledger (ADR 0007). */
export const PAYMENTS: Payment[] = [];
/** Money paid in and not yet spent on a charge, by member: it pays their next one (ADR 0007). */
export const CREDITS: { memberId: number; pence: number }[] = [];

/** What /api/bootstrap sends (apps/team/worker/api/api.ts). */
export interface Bootstrap {
  me: number;
  actions: Action[];
  devTools?: boolean;
  /** Screens still on demo data (Upload) are shown: not in production (#63). */
  unfinished?: boolean;
  /** The role the app opens as, when it isn't your full one (ADR 0024). */
  everydayRole: number | null;
  members: {
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
    kumiteTeamName: string | null;
    played: number;
    quarterly: boolean;
    quarterlyNext: boolean;
    everydayRoleId: number | null;
  }[];
  roles: Role[];
  venues: Venue[];
  series: TrainingSeries[];
  sessions: (TrainingSession & { teams: Team[] })[];
  tournamentTypes: TournamentType[];
  tournaments: Tournament[];
  clubEvents: OneOff[];
  quips: Quip[];
  /** Home's announcements (#85): the two newest still on, less any you dismissed. */
  announcements: Announcement[];
  /** What's on from today (ADR 0042). */
  agenda: AgendaRow[];
  settings: { liveRefreshSeconds: number; bank: Bank | null };
  charges: Charge[];
  reminders: { memberId: number; at: string }[];
  credits: { memberId: number; pence: number }[];
  payments: Payment[];
  subscriptionFees: DatedFee[];
  /** Your own notifications, a choice per topic (ADR 0108). */
  notifications: NotificationPrefs;
}

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
export type Slices = Partial<Omit<Bootstrap, "me" | "actions" | "devTools" | "unfinished">>;

/** Put the club's data in place (app/backend.svelte.ts copies it into the store). Runs before the app mounts, and again
 * whenever the whole club is reloaded. */
export function hydrate(b: Bootstrap) {
  REAL_ID = b.me;
  DEV_TOOLS = !!b.devTools;
  UNFINISHED = !!b.unfinished;
  applySlices(b);
}

/** Put the parts of the club's data that came back in place; the rest stays as it is. */
export function applySlices(b: Slices) {
  if (b.everydayRole !== undefined) EVERYDAY_ROLE = b.everydayRole;
  if (b.members) {
    EMAILS.clear();
    REFERENCES.clear();
    PHONES.clear();
    const players = b.members.map((m) => {
      EMAILS.set(m.id, m.email);
      REFERENCES.set(m.id, m.paymentReference);
      PHONES.set(m.id, m.phone);
      const { id, name, position, rating, cougar, bio, webName, kumiteTeamName, played } = m;
      return { id, name, position, rating, cougar, bio, webName, kumiteTeamName, played };
    });
    fill(PLAYERS, players);
    fill(
      MEMBERS,
      b.members.map((m, i) => ({
        player: players[i],
        status: m.status,
        roles: m.roles,
        plan: planOf(m.position, m.quarterly),
        planNext: planOf(m.position, m.quarterlyNext),
        everydayRoleId: m.everydayRoleId ?? null,
      })),
    );
  }
  if (b.roles) fill(ROLES, b.roles);
  if (b.venues) fill(VENUES, b.venues);
  if (b.series) fill(SERIES, b.series);
  if (b.sessions) {
    fill(
      SESSIONS,
      b.sessions.map(({ teams: _, ...s }) => s),
    );
    for (const k of Object.keys(TEAMS)) delete TEAMS[Number(k)];
    for (const s of b.sessions) if (s.teams.length) TEAMS[s.id] = s.teams;
  }
  if (b.quips) fill(QUIPS, b.quips);
  if (b.announcements) fill(ANNOUNCEMENTS, b.announcements);
  if (b.tournamentTypes) fill(TOURNAMENT_TYPES, b.tournamentTypes);
  if (b.tournaments) fill(TOURNAMENTS, b.tournaments);
  if (b.clubEvents) fill(ONE_OFFS, b.clubEvents);
  if (b.agenda) fill(AGENDA, b.agenda);
  if (b.settings) Object.assign(SETTINGS, b.settings);
  if (b.charges) fill(CHARGES, b.charges);
  if (b.reminders) fill(REMINDERS, b.reminders);
  if (b.credits) fill(CREDITS, b.credits);
  if (b.payments) fill(PAYMENTS, b.payments);
  if (b.subscriptionFees) fill(SUBSCRIPTION_FEES, b.subscriptionFees);
  if (b.notifications) Object.assign(NOTIFICATIONS, b.notifications);
}

/** The old app's names: the Cougar players' team is "Cougars", the rest are colours. */
export const TEAM_NAMES = ["Cougars", "White", "Black", "Red", "Gold"];
/** Display order, also from the old app: Cougars, then Black, then White. */
export const TEAM_ORDER: Record<string, number> = { Cougars: 0, Black: 1, White: 2, Red: 3, Gold: 4 };
