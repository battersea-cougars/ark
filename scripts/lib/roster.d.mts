// Types for roster.mjs, for the TypeScript that imports it (the team app's API tests).
export interface RosterPlayer {
  name: string;
  position: "F" | "D" | "G";
  rating: number;
  email: string | null;
  roles: string[];
  /** On the club's official team (the Cougars). */
  cougar: boolean;
  /** The role their app opens as day to day (ADR 0024), set when the seed adds them. */
  everyday: string | null;
}
export function parseRoster(text: string): RosterPlayer[];
export function rosterSql(players: RosterPlayer[], now?: Date): string;
