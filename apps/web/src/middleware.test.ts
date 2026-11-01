import { describe, expect, it, vi } from "vitest";
import type { CacheLike } from "@cougars/shared/rate-limit";
import { siteHeaders } from "./lib/server/headers";

vi.mock("astro:middleware", () => ({ defineMiddleware: (fn: unknown) => fn }));
vi.mock("astro:env/server", () => ({ SITE_ENV: "dev" }));
const { LIVE_LIMIT, SITE_HEADERS, secured, tooMany } = await import("./middleware");

function memoryCache(): CacheLike {
  const store = new Map<string, string>();
  return {
    match: async (key) => (store.has(key) ? new Response(store.get(key)) : undefined),
    put: async (key, res) => void store.set(key, await res.text()),
  };
}

describe("live routes", () => {
  it("turn away an address that keeps asking, for a minute, and nobody else", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = memoryCache();
    const now = Date.parse("2026-10-07T12:00:00Z");
    for (let i = 0; i < LIVE_LIMIT.limit; i++) expect(await tooMany(cache, "1.2.3.4", now)).toBeNull();
    const refused = await tooMany(cache, "1.2.3.4", now);
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("Retry-After")).toBe("60");
    // A refusal is a live response like any other: the same security headers (ADR 0036)
    expect(Object.fromEntries(refused!.headers)).toMatchObject(SITE_HEADERS);
    expect(await tooMany(cache, "5.6.7.8", now)).toBeNull();
    expect(await tooMany(cache, "1.2.3.4", now + 60_000)).toBeNull();
  });
});

describe("security headers (ADR 0036)", () => {
  it("go on every live response, this site's own (lib/server/headers.ts; the built _headers in headers.test.ts)", () => {
    const live = secured(new Response("<!doctype html>", { headers: { "content-type": "text/html" } }));
    expect(SITE_HEADERS).toEqual(siteHeaders("dev"));
    expect(Object.fromEntries(live.headers)).toMatchObject(SITE_HEADERS);
  });
});
