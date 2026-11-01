// Types for history.rows.mjs, for the TypeScript that imports it (the team app's club with years behind it,
// apps/team/worker/api/bootstrap.testing.ts).
type Row = Record<string, unknown>;
export const KUMITE_TABLES: string[];
export const KUMITE_ID_TABLES: string[];
export function NEXT_IDS_SQL(tables: string[]): string;
export function idsFrom(next: Record<string, number>): (table: string) => number;
export function kumiteRows(
  k: {
    tournament: Row;
    teams: (Row & { players: Row[] })[];
    entries?: Row[];
    games?: Row[];
    winners?: Row[];
    votes?: Row[];
  },
  nextId: (table: string) => number,
  out?: Record<string, object[]>,
): Row & { id: number };
export function insertsSql(tables: Record<string, object[]>, order?: string[]): string;
