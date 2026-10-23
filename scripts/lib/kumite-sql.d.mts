// Types for kumite-sql.mjs, for the TypeScript that imports it (the team app's use-case tests). The snapshot's shape
// is what apps/web/src/lib/sanity/content.ts reads.
export function kumiteSql(today?: string): string;
export function kumiteFrom(rows: unknown[]): {
  awards: { name: string; about?: string; decidedBy?: unknown }[];
  next: { startsAt: string; venue: string; dateTbc: boolean; season: string | null } | null;
} | null;
