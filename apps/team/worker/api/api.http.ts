// Small helpers for the JSON API: replies, and the error a handler throws to refuse a request.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Whether a request that changes something comes from the app's own pages. Browsers send Origin on every POST, PUT
 * and DELETE, so another site's form or script is refused even where SameSite cookies would let it through (a
 * sibling subdomain). A change that says nothing about where it came from (no Origin, and no `Sec-Fetch-Site:
 * same-origin`) is refused too: no browser's fetch sends one, so it can only be a script (#42).
 */
export function sameOrigin(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** What a request may send (#73): plenty for any form, a team's logo or a list of Fridays. */
export const MAX_BODY = 1024 * 1024;
const TOO_BIG = "That's too much to send at once.";

/**
 * The request with its body read, refused with a 413 once it's over `max` bytes: before anything is parsed, and
 * without reading more than that. The size it says it is counts first; one that says nothing is counted as it comes.
 */
export async function withinLimit(request: Request, max = MAX_BODY): Promise<Request> {
  if (!request.body) return request;
  if (Number(request.headers.get("content-length") ?? 0) > max) throw new HttpError(413, TOO_BIG);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, TOO_BIG);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new Request(request, { body: bytes });
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** The request's JSON body, as an object, or a 400. */
export async function body(request: Request): Promise<Record<string, unknown>> {
  // A form on another site can send text/plain without asking first; only JSON is accepted (with the Origin check)
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new HttpError(415, "Send JSON.");
  try {
    const value = await request.json();
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "Send a JSON object.");
}

// Field readers: each returns the value or throws a 400 naming the field.
export function text(o: Record<string, unknown>, key: string, { optional = false, max = 200 } = {}): string {
  const v = o[key];
  if (v == null || v === "") {
    if (optional) return "";
    throw new HttpError(400, `${key} is needed.`);
  }
  if (typeof v !== "string" || v.length > max) throw new HttpError(400, `${key} should be text (up to ${max}).`);
  return v.trim();
}
type IntRange = { min?: number; max?: number };
/** A whole number from the request, in range; null only when it may be left out (`nullable`). */
export function int(o: Record<string, unknown>, key: string, range: IntRange & { nullable: true }): number | null;
export function int(o: Record<string, unknown>, key: string, range?: IntRange & { nullable?: false }): number;
export function int(o: Record<string, unknown>, key: string, { min = 0, max = 1_000_000, nullable = false } = {}) {
  const v = o[key];
  if (v == null || v === "") {
    if (nullable) return null;
    throw new HttpError(400, `${key} is needed.`);
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new HttpError(400, `${key} should be a whole number from ${min} to ${max}.`);
  return v;
}
export function bool(o: Record<string, unknown>, key: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw new HttpError(400, `${key} should be true or false.`);
  return v;
}
export function oneOf<T extends string>(o: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = o[key];
  if (typeof v !== "string" || !allowed.includes(v as T))
    throw new HttpError(400, `${key} should be one of ${allowed.join(", ")}.`);
  return v as T;
}
export function date(o: Record<string, unknown>, key: string, { nullable = false } = {}): string | null {
  const v = o[key];
  if (v == null || v === "") {
    if (nullable) return null;
    throw new HttpError(400, `${key} is needed.`);
  }
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `${key} should be a date.`);
  return v;
}
export function time(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || !/^\d{2}:\d{2}$/.test(v)) throw new HttpError(400, `${key} should be a time (HH:MM).`);
  return v;
}
