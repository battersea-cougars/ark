// The website's photos are the club's Instagram (lib/server/instagram.ts): the home page's strip asks for the newest
// twelve (pages/api/photos/latest.ts), /photos/ shows the newest 48, and an old album's address goes to /photos/.
// Instagram (Meta's Graph API) is faked; the rest is the real routes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBreakers } from "@cougars/shared/breaker";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { clearCache } from "./cache";

const world = vi.hoisted(() => ({ env: { DB: null as unknown } }));
vi.mock("cloudflare:workers", () => world);
vi.mock("astro:env/server", () => ({ INSTAGRAM_TOKEN: "club-token", SITE_ENV: "production" }));
const { latestPosts, FEED_SIZE } = await import("./instagram");
const { instagramConfig } = await import("./instagram-env");
const latest = await import("../../pages/api/photos/latest");
const album = await import("../../pages/photos/[slug]");
const wixAlbum = await import("../../pages/gallery/[slug]");

/** The club's Instagram with this many photo posts, newest first. */
function instagram(posts: number) {
  const data = Array.from({ length: posts }, (_, i) => ({
    id: String(1000 + posts - i),
    caption: `Friday ${i}`,
    media_type: "IMAGE",
    media_url: `https://scontent-lhr8-1.cdninstagram.com/v/${i}.jpg`,
    permalink: `https://www.instagram.com/p/${i}/`,
    timestamp: new Date(Date.UTC(2026, 9, 31) - i * 86_400_000).toISOString(),
  }));
  return async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const limit = Number(url.searchParams.get("limit") ?? posts);
    // More than asked for: Instagram offers the next page
    const next = limit < posts ? { paging: { next: `${url.origin}${url.pathname}?after=${limit}` } } : {};
    return Response.json({ data: data.slice(0, limit), ...next });
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  clearCache();
  resetBreakers();
  world.env.DB = createTestD1();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (route: { GET: (c: any) => Response | Promise<Response> }) =>
  route.GET({ redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }) });

describe("the club's photos on the website", () => {
  it("the home page's strip is the newest twelve", async () => {
    vi.stubGlobal("fetch", instagram(30));
    const { photos } = (await (await get(latest)).json()) as { photos: { id: string }[] };
    expect(photos.map((p) => p.id)).toEqual(Array.from({ length: 12 }, (_, i) => String(1030 - i)));
  });

  it("the photos page is the newest 48; older ones are on Instagram", async () => {
    expect(FEED_SIZE).toBe(48);
    const { data, more } = await latestPosts(instagramConfig(), { fetch: instagram(60), edge: null });
    expect(data).toHaveLength(48);
    expect(more).toBe(true);
  });

  it("an old album's address, ours or Wix's, goes to the photos for good", async () => {
    for (const route of [album, wixAlbum]) {
      const res = await get(route);
      expect([res.status, res.headers.get("location")]).toEqual([301, "/photos/"]);
    }
  });
});
