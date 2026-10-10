// The app's working copy of the club's data, filled from D1 (demo/data.ts hydrate) and replaced by
// app/backend.svelte.ts after each change.
import type { Team } from "../lib/balance";
import {
  AGENDA,
  CHARGES,
  CREDITS,
  PAYMENTS,
  MEMBERS,
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
  /** How often live pages check for updates (ADR 0072). */
  settings: structuredClone(SETTINGS),
  /** Published teams, by session id. */
  teams: structuredClone(TEAMS) as Record<number, Team[]>,
  /** One person for one session or tournament, paid or not (ADR 0007). */
  charges: structuredClone(CHARGES),
  /** Money paid in and not yet spent, by member: it pays their next charge. */
  credits: structuredClone(CREDITS),
  payments: structuredClone(PAYMENTS),
});
