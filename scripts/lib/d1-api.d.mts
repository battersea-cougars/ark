// Types for d1-api.mjs, for the TypeScript that imports it (the website build's Sanity count).
export const DATABASES: Record<"production" | "dev", string>;
export function remoteD1(environment: string): Promise<(sql: string, params?: unknown[]) => Promise<unknown[]>>;
