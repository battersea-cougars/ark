// The club, in parts (ADR 0036, ADR 0053, ADR 0057): what the bootstrap sends, and what a change sends back, each
// part as this member may see it.
import { fromRow as agendaItem, ensureAgenda, type AgendaRow } from "@cougars/shared/agenda";
import { can, type Action } from "../../src/access/actions";
import { londonEvening } from "../../src/lib/dates";
import { type Ctx } from "./api.route";
import { readClub, type Part, type Parts, type Viewer } from "./api.club";
import { chargesFrom } from "../dues/dues";
import { entriesFrom } from "../entries/entries";
import { gamesFrom } from "../tournaments/fixtures";
import { canGrant, membersFrom, rolesFrom } from "../members/members";
import { clubEventsFrom } from "../calendar/events";
import { seriesFrom, type SessionRow } from "../training/training";
import { tournamentTypesFrom, tournamentsFrom } from "../tournaments/tournaments";
import { venuesFrom } from "../settings/venues";
import { settingsFrom } from "../settings/settings";
import { teamsFrom } from "../training/training.teams";
import { prefsFrom } from "../push/push.prefs";
import { levelsFrom } from "../settings/usage.levels";

// ─── The club, in parts ───
// The bootstrap is all of them; a change's reply is the ones it touched. Each is what this member may see (ADR 0036).

// Who may see more than their own (ADR 0036). Anyone else sees, of anything personal, only their own.
/** Everyone's roles, and every role's actions: who sets them (ADR 0024). */
export const SEES_ROLES: readonly Action[] = ["manage:Member", "manage:Role"];
/** Everyone's answers (out as well as in) and the register (no-shows, walk-ins): who runs events and their teams. */
export const SEES_REGISTER: readonly Action[] = [
  "record:Attendance",
  "update:Event",
  "generate:Teams",
  "publish:Teams",
  "manage:Member",
  "manage:Tournament",
  "run:Draft",
];
/** Everyone's charges and payments (ADR 0007). Anyone else sees only their own. */
export const SEES_DUES: readonly Action[] = ["read:Dues", "record:Payment"];
export const holdsAny = (c: Ctx, actions: readonly Action[]) =>
  c.actions.has("manage:all") || actions.some((a) => c.actions.has(a));

/** Who's asking, as the club read needs them: who they are, the day, and what their actions let them see. */
export const viewerOf = (c: Ctx): Viewer => ({
  memberId: c.memberId,
  today: c.today,
  // A few weeks back, for what's just been held
  sessionsFrom: new Date(Date.parse(c.today) - 28 * 86_400_000).toISOString().slice(0, 10),
  now: c.now,
  seesRegister: holdsAny(c, SEES_REGISTER),
  seesPrivate: holdsAny(c, ["manage:Member"]),
  seesRoles: holdsAny(c, SEES_ROLES),
  seesRatings: holdsAny(c, ["read:Rating"]),
  // How to reach a team that entered from outside the club: for whoever runs tournaments
  seesContacts: holdsAny(c, ["manage:Tournament"]),
  // A draft night on the agenda: for whoever runs the draft, and that tournament's captains
  runsDraft: can(c.actions, "run:Draft"),
  seesDues: holdsAny(c, SEES_DUES),
  // The awards' winners before they're revealed: whoever runs tournaments, who reveals them
  seesAwards: holdsAny(c, ["manage:Tournament"]),
  seesUsage: holdsAny(c, ["read:Usage"]),
  keepsEmail: holdsAny(c, ["manage:Settings"]),
  evening: londonEvening(new Date(c.now)),
});

/** Each part of the club: the rows it's made from (api.club.ts, read as this member may see them) and how. */
export const SLICES = {
  // The role the app opens as, when it isn't your full one (ADR 0024)
  everydayRole: { parts: ["everydayRole"], shape: (_c: Ctx, p: Parts) => (p.everydayRole[0] as number | null) ?? null },
  members: { parts: ["members"], shape: (_c: Ctx, p: Parts) => membersFrom(p.members) },
  // Every role, for whoever sets them; anyone else, only the roles they could hold as they are: their own, and the
  // ones that can do less (their everyday role's choices, ADR 0024). What a stronger role can do isn't theirs to see.
  roles: {
    parts: ["roles", "roleActions"],
    shape: (c: Ctx, p: Parts) => {
      const roles = rolesFrom(p.roles, p.roleActions);
      return holdsAny(c, SEES_ROLES) ? roles : roles.filter((r) => canGrant(c.actions, r.actions));
    },
  },
  venues: { parts: ["venues"], shape: (_c: Ctx, p: Parts) => venuesFrom(p.venues) },
  series: { parts: ["series", "seriesFees"], shape: (_c: Ctx, p: Parts) => seriesFrom(p.series, p.seriesFees) },
  // Each with its answers and published teams
  sessions: {
    parts: ["sessions", "sessionEntries", "sessionTeams"],
    shape: (_c: Ctx, p: Parts) => {
      const rows = p.sessions as SessionRow[];
      const teams = teamsFrom(p.sessionTeams);
      return withEntries(rows, p.sessionEntries).map((s) => ({ ...s, teams: teams.get(s.id) ?? [] }));
    },
  },
  tournamentTypes: { parts: ["tournamentTypes"], shape: (_c: Ctx, p: Parts) => tournamentTypesFrom(p.tournamentTypes) },
  tournaments: {
    parts: [
      "tournaments",
      "tournamentTeams",
      "tournamentPlayers",
      "games",
      "goals",
      "penalties",
      "winners",
      "votes",
      "awardTitles",
      "tournamentEntries",
    ],
    shape: (c: Ctx, p: Parts) =>
      draftSeenBy(
        c,
        withEntries(
          tournamentsFrom(
            p.tournaments,
            p.tournamentTeams,
            p.tournamentPlayers,
            gamesFrom(p.games, p.goals, p.tournamentTeams, p.penalties),
            p.winners,
            p.votes,
            p.awardTitles,
          ),
          p.tournamentEntries,
        ),
      ),
  },
  clubEvents: {
    parts: ["clubEvents", "eventEntries"],
    shape: (_c: Ctx, p: Parts) => withEntries(clubEventsFrom(p.clubEvents), p.eventEntries),
  },
  // Dues (ADR 0007): your own charges, or everyone's for who sees Unpaid fees; and the quarterly rate
  charges: { parts: ["charges"], shape: (_c: Ctx, p: Parts) => chargesFrom(p.charges) },
  credits: { parts: ["credits"], shape: (_c: Ctx, p: Parts) => p.credits as { memberId: number; pence: number }[] },
  payments: {
    parts: ["payments"],
    shape: (_c: Ctx, p: Parts) =>
      p.payments as {
        id: number;
        memberId: number;
        pence: number;
        receivedOn: string;
        via: "transfer" | "cash" | "adjustment";
        reason: string | null;
      }[],
  },
  // When each was last reminded of what they owe (ADR 0007): who sees everyone's dues; anyone else, nothing
  reminders: {
    parts: ["reminders"],
    shape: (_c: Ctx, p: Parts) => p.reminders as { memberId: number; at: string }[],
  },
  subscriptionFees: {
    parts: ["subscriptionFees"],
    shape: (_c: Ctx, p: Parts) => p.subscriptionFees as { pence: number; from: string }[],
  },
  quips: { parts: ["quips"], shape: (_c: Ctx, p: Parts) => p.quips as { id: number; kind: string; text: string }[] },
  // Home's announcements (#85)
  announcements: {
    parts: ["announcements"],
    shape: (_c: Ctx, p: Parts) =>
      p.announcements as {
        id: number;
        title: string;
        body: string;
        link: string | null;
        endsOn: string;
        createdAt: string;
      }[],
  },
  // How often live pages check for updates (ADR 0072), and the club's bank details (ADR 0007)
  settings: { parts: ["settings"], shape: (_c: Ctx, p: Parts) => settingsFrom(p.settings) },
  // Your own notifications, a choice per topic (ADR 0108)
  notifications: { parts: ["notifications"], shape: (_c: Ctx, p: Parts) => prefsFrom(p.notifications) },
  // What only admins act on, for Home's For admins, in with the club so it's there on first paint: the free limits
  // getting close (ADR 0059), for whoever sees Usage, and Google having cancelled the email (ADR 0027), for whoever
  // looks after it; anyone else, none
  forAdmins: {
    parts: ["usageLevels", "mailFailure"],
    shape: (c: Ctx, p: Parts) => ({
      usage: levelsFrom(p.usageLevels, new Date(c.now)),
      emailStopped: p.mailFailure[0]?.failure === "cancelled",
    }),
  },
  // What's on from today (ADR 0042)
  agenda: { parts: ["agenda"], shape: (_c: Ctx, p: Parts) => (p.agenda as AgendaRow[]).map(agendaItem) },
} satisfies Record<string, { parts: Part[]; shape: (c: Ctx, p: Parts) => unknown }>;
export type Slice = keyof typeof SLICES;

/**
 * Each event with its answers: who's in and who's waiting, for everyone (that's what a sign-up is for); who said
 * they're out, who didn't turn up and who walked in, only your own, unless you run events (ADR 0036): the club read
 * leaves the rest out.
 */
export function withEntries<T extends { id: number }>(rows: T[], entries: Parameters<typeof entriesFrom>[0]) {
  const byEvent = entriesFrom(
    entries,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, ...byEvent.get(r.id)! }));
}

/**
 * A draft is for its captains and whoever runs it (ADR 0060): who went when is nobody else's business. Anyone else
 * sees the captains and no players while it's on; once it's closed, the teams, with no pick numbers and in an order
 * that says nothing about them (a hash of the team and player, so it's the same every time they look).
 */
export function draftSeenBy<T extends ReturnType<typeof tournamentsFrom>[number]>(c: Ctx, tournaments: T[]): T[] {
  // Whoever runs the draft, and admins who edit the teams, see it all
  if (can(c.actions, "run:Draft") || can(c.actions, "manage:Tournament")) return tournaments;
  const jumble = (teamId: number, memberId: number | null, name: string) =>
    Math.imul(teamId * 31 + (memberId ?? name.length), 2654435761) >>> 0;
  return tournaments.map((t) => {
    if (t.kind !== "draft" || t.teams.some((team) => team.captainMemberId === c.memberId)) return t;
    const closed = t.draftState === "closed";
    return {
      ...t,
      teams: t.teams.map((team) => ({
        ...team,
        players: closed
          ? team.players
              .map((p) => ({ ...p, pick: null, pickedBy: null }))
              .sort((a, b) => jumble(team.id, a.memberId, a.name) - jumble(team.id, b.memberId, b.name))
          : [],
      })),
    };
  });
}

/** Anything on the calendar changed: the agenda comes back with it (ADR 0042). */
export const SCHEDULE: readonly Slice[] = [
  "series",
  "sessions",
  "venues",
  "tournamentTypes",
  "tournaments",
  "clubEvents",
];

/**
 * The named parts of the club, in one read: D1's round trips are what the app waits on, so it's one statement however
 * many parts (api.club.ts). The agenda is filled from scratch first if it's empty (a rebuilt database).
 */
export async function slices(c: Ctx, names: readonly Slice[]): Promise<Partial<Record<Slice, unknown>>> {
  if (names.includes("agenda")) await ensureAgenda(c.env.DB);
  const parts = await readClub(c.env.DB, viewerOf(c), [...new Set(names.flatMap((n) => SLICES[n].parts))]);
  return Object.fromEntries(names.map((n) => [n, SLICES[n].shape(c, parts)]));
}

// Who can see what depends on roles: after a change to members or roles, read the parts with the actions as they are now
export const ACCESS: readonly Slice[] = ["members", "roles", "everydayRole"];
