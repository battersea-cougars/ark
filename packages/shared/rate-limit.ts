// Best-effort per-IP rate limit using the Workers Cache API (free, per data
// centre, not atomic). Good enough to stop a form being hammered; not a
// security boundary. Same approach as ark's functions/_lib/form-rate-limit.js.

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  now?: number;
  /** false: only says whether it's used up, without counting this one. */
  spend?: boolean;
}

export async function rateLimit(
  cache: CacheLike,
  bucket: string,
  ip: string,
  { limit, windowSeconds, now = Date.now(), spend = true }: RateLimitOptions,
): Promise<{ allowed: boolean }> {
  const window = Math.floor(now / 1000 / windowSeconds);
  const key = `https://rate-limit.internal/${bucket}/${encodeURIComponent(ip)}/${window}`;
  const hit = await cache.match(key);
  const count = hit ? Number(await hit.text()) || 0 : 0;
  if (count >= limit) return { allowed: false };
  if (!spend) return { allowed: true };
  await cache.put(key, new Response(String(count + 1), { headers: { "Cache-Control": `max-age=${windowSeconds}` } }));
  return { allowed: true };
}
