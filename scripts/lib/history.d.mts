// Types for history.mjs, for the TypeScript that imports it (a club with a year behind it in the use cases,
// apps/team/worker/dues/dues.history.use-cases.test.ts).
type Row = Record<string, unknown>;
export interface HistoryDb {
  rows(sql: string): Promise<Row[]>;
  run(sql: string): Promise<unknown>;
}
export function seedHistory(
  db: HistoryDb,
  options: { today: string; kumites?: number; weeks?: number; seed?: number },
): Promise<{ made: unknown; rows: Record<string, number> }>;
