// Types for dev-server.mjs, for the TypeScript that imports it (apps/team/vite.config.ts).
export function takeOverPort(port: number, pidFile: string): Promise<void>;
export function stopDevServerOn(port: number, owner?: number): Promise<void>;
