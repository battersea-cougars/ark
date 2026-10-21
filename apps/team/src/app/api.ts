// Fetching from the team app's Worker (apps/team/worker/api/api.ts). Kept apart from the store so the app can load the
// club's data before anything that reads it is imported (main.ts).
import type { Bootstrap, Slices } from "../demo/data";
import { atVersion, VERSION_HEADER } from "./club-tag";
import { Brake } from "./brake";
import { BUILD_HEADER } from "./build";
import { heardBuild } from "./update.svelte";

/** Keeps a tab that's gone wrong from spending the club's free allowance (ADR 0055). */
export const brake = new Brake();

/** What the server refused, and how (401: nobody's signed in). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Set once the app is up: from then on, a session that's gone (signed out elsewhere, revoked) reloads to sign-in. */
export const running = { app: false };

export async function api<T = unknown>(method: string, path: string, payload?: unknown): Promise<T> {
  const res = await send(path, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return versioned(res, await read<T>(res, path));
}

// The club's data version a reply was read at (a change's, the bootstrap's), kept beside the reply itself
const versions = new WeakMap<object, number>();
function versioned<T>(res: Response, data: T): T {
  const v = res.headers.get(VERSION_HEADER);
  if (v && data && typeof data === "object") versions.set(data, Number(v));
  return data;
}
/** The club's data version a reply was read at (or after), if it said (catch-up.ts). */
export const versionOf = (data: unknown) => (data && typeof data === "object" ? versions.get(data) : undefined);

/** Every call to the Worker: through the brake, which hears how it went. `started`: a request already on its way. */
async function send(path: string, init?: RequestInit, started?: Promise<Response>): Promise<Response> {
  const why = brake.take();
  if (why) throw new ApiError(429, why);
  try {
    return await (started ?? fetch(path, init));
  } catch (e) {
    brake.failed();
    throw e;
  }
}

async function read<T>(res: Response, path: string): Promise<T> {
  const ours = (res.headers.get("content-type") ?? "").includes("application/json");
  const text = await res.text().catch(() => "");
  // Cloudflare's own page for a Worker over its free daily requests says "1027"
  brake.answered(res.status, ours, !ours && res.status === 429 && /\b1027\b/.test(text));
  let data: { error?: string } = {};
  try {
    if (ours && text) data = JSON.parse(text);
  } catch {
    // not what it said it was: treat as no body
  }
  if (res.status === 401 && running.app && !path.startsWith("/api/auth/")) location.replace("/");
  if (!res.ok) throw new ApiError(res.status, data.error ?? `The server said ${res.status}.`);
  return data as T;
}

// The bootstrap's ETag (ADR 0053). Opening the app, the browser asks with the reply it kept; after that the app asks
// with the tag at the data version its copy holds, which moves on as live pages read the club in parts (catch-up.ts,
// ADR 0072): a club that hasn't changed since is an empty 304.
let bootstrapTag: string | null = null;

// index.html reads the club before any script has arrived (ADR 0120). The first getBootstrap takes that reply, once;
// if it never came (no network), the app asks itself, so a failure reads as it always did.
declare global {
  interface Window {
    cougarsBootstrap?: Promise<Response | null>;
  }
}
async function startedBootstrap(): Promise<Response | undefined> {
  const started = globalThis.window?.cougarsBootstrap;
  if (!started) return undefined;
  delete window.cougarsBootstrap;
  return (await started) ?? undefined;
}

export async function getBootstrap(): Promise<Bootstrap> {
  const early = await startedBootstrap();
  const res = await send("/api/bootstrap", undefined, early && Promise.resolve(early));
  const data = await read<Bootstrap>(res, "/api/bootstrap");
  bootstrapTag = res.headers.get("etag");
  heardBuild(res.headers.get(BUILD_HEADER));
  return versioned(res, data);
}

/** The whole club, or null if nothing has changed since the version held (`versionOf` the club says its version). */
export async function bootstrapIfChanged(held: number): Promise<Bootstrap | null> {
  if (!bootstrapTag || !held) return getBootstrap();
  const ask = { cache: "no-store" as const, headers: { "if-none-match": atVersion(bootstrapTag, held) } };
  const res = await send("/api/bootstrap", ask);
  if (res.status !== 304) {
    const data = await read<Bootstrap>(res, "/api/bootstrap");
    bootstrapTag = res.headers.get("etag");
    heardBuild(res.headers.get(BUILD_HEADER));
    return versioned(res, data);
  }
  brake.answered(304, true);
  heardBuild(res.headers.get(BUILD_HEADER));
  return null;
}

/** Just these parts of the club, and the data version they're at least as new as (catch-up.ts). */
export const readSlices = (names: string[]) =>
  api<{ version: number; slices: Slices }>("GET", `/api/slices?names=${names.join(",")}`);
