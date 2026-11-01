// Types for break-glass.mjs, for the TypeScript that imports it (the team app's sign-in tests).
export const BREAK_GLASS_MINUTES: number;
export function issueBreakGlass(
  query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  options: { email: string; now?: Date; by?: string },
): Promise<{ code: string; memberId: number; name: string; expiresAt: string }>;
