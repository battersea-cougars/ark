// The app's working copy of the club's data, filled from D1 (demo/data.ts hydrate) and copied in by
// app/backend.svelte.ts: once the data's in (start), and after each change. Empty until then, so it can be imported
// before the data arrives (main.ts).
import type { Team } from "../lib/balance";
import {
  AGENDA,
  CHARGES,
  CREDITS,
  PAYMENTS,
  REMINDERS,
  MEMBERS,
  NOTIFICATIONS,
  ONE_OFFS,
  QUIPS,
  ANNOUNCEMENTS,
  ROLES,
  SERIES,
  SESSIONS,
  SETTINGS,
  SUBSCRIPTION_FEES,
  TEAMS,
  TOURNAMENTS,
  TOURNAMENT_TYPES,
  VENUES,
  FOR_ADMINS,
} from "./data";

export const db = $state({
  venues: structuredClone(VENUES),
  series: structuredClone(SERIES),
  sessions: structuredClone(SESSIONS),
  tournamentTypes: structuredClone(TOURNAMENT_TYPES),
  tournaments: structuredClone(TOURNAMENTS),
  oneOffs: structuredClone(ONE_OFFS),
  /** What's on from today, from the server (ADR 0042). */
  agenda: structuredClone(AGENDA),
  roles: structuredClone(ROLES),
  members: structuredClone(MEMBERS),
  /** The quarterly rate, from each date (ADR 0007). */
  fees: structuredClone(SUBSCRIPTION_FEES),
  quips: structuredClone(QUIPS),
  /** Home's announcements (#85). */
  announcements: structuredClone(ANNOUNCEMENTS),
  /** How often live pages check for updates (ADR 0072), and the club's bank details (ADR 0007). */
  settings: structuredClone(SETTINGS),
  /** Published teams, by session id. */
  teams: structuredClone(TEAMS) as Record<number, Team[]>,
  /** One person for one session or tournament, paid or not (ADR 0007). */
  charges: structuredClone(CHARGES),
  /** Money paid in and not yet spent, by member: it pays their next charge. */
  credits: structuredClone(CREDITS),
  payments: structuredClone(PAYMENTS),
  /** What your phone tells you, a choice per topic (ADR 0108). */
  notifications: structuredClone(NOTIFICATIONS),
  /** When each member was last reminded of what they owe (ADR 0007). */
  reminders: structuredClone(REMINDERS),
  /** Home's For admins: the free limits getting close (ADR 0059). */
  forAdmins: structuredClone(FOR_ADMINS),
});
