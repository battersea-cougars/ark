import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBreakers } from "@cougars/shared/breaker";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { clearCache } from "./cache";
import { FAKE_POSTS, latestPosts, postImage, type InstagramConfig } from "./instagram";

// The club's account on Instagram's API: three posts, newest first, as /me/media answers
const MEDIA = [
  {
    id: "1803",
    caption: "Friday night under the lights. Same time next week?",
    media_type: "IMAGE",
    media_url: "https://scontent-lhr8-1.cdninstagram.com/v/friday.jpg?oe=AAA",
    permalink: "https://www.instagram.com/p/AAA/",
    timestamp: "2026-10-31T21:05:00+0000",
  },
  {
    id: "1802",
    caption: "Kumite highlights 🥋",
    media_type: "VIDEO",
    media_url: "https://scontent-lhr8-1.cdninstagram.com/v/kumite.mp4",
    thumbnail_url: "https://scontent-lhr8-1.cdninstagram.com/v/kumite-cover.jpg",
    permalink: "https://www.instagram.com/reel/BBB/",
    timestamp: "2026-10-25T18:00:00+0000",
  },
  {
    id: "1801",
    media_type: "CAROUSEL_ALBUM",
    media_url: "https://scontent-lhr8-1.cdninstagram.com/v/social-1.jpg",
    permalink: "https://www.instagram.com/p/CCC/",
    timestamp: "2026-10-18T22:30:00+0000",
    children: { data: [{ id: "a" }, { id: "b" }, { id: "c" }] },
  },
];

function fakeInstagram({ down = false, expired = false } = {}) {
  const calls = { feed: 0, media: 0, cdn: 0 };
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "graph.instagram.com") {
      if (down)
        return Response.json({ error: { message: "Application request limit reached", code: 4 } }, { status: 403 });
      if (url.pathname.endsWith("/me/media")) {
        calls.feed++;
        return Response.json({ data: MEDIA });
      }
      calls.media++; // one post, asked again for a fresh picture address
      return Response.json({
        id: "1803",
        media_type: "IMAGE",
        media_url: "https://scontent-lhr8-1.cdninstagram.com/v/friday.jpg?oe=NEW",
      });
    }
    calls.cdn++;
    if (expired && !url.search.includes("NEW")) return new Response("URL signature expired", { status: 403 });
    return new Response("jpeg bytes", { headers: { "content-type": "image/jpeg" } });
  });
  return { fetch, calls };
}

const config = (extra: Partial<InstagramConfig> = {}): InstagramConfig => ({ token: async () => "token", ...extra });

describe("the club's Instagram on the website", () => {
  let t = 0;
  const deps = (fetch: typeof globalThis.fetch) => ({ fetch, now: () => t, edge: null });
  beforeEach(() => {
    clearCache();
    resetBreakers();
    t = Date.parse("2026-11-01T12:00:00Z");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the newest posts first, each picture served by us, with its caption and a link to the post", async () => {
    const { fetch } = fakeInstagram();
    const { data, unavailable } = await latestPosts(config(), deps(fetch));
    expect(unavailable).toBe(false);
    expect(data.map((p) => p.id)).toEqual(["1803", "1802", "1801"]);
    expect(data[0]).toMatchObject({
      kind: "image",
      image: "/api/photos/1803",
      caption: "Friday night under the lights. Same time next week?",
      alt: "Friday night under the lights.",
      href: "https://www.instagram.com/p/AAA/",
      takenAt: "2026-10-31T21:05:00.000Z",
    });
  });

  it("shows a video by its cover picture and an album by its first, saying how many", async () => {
    const { fetch } = fakeInstagram();
    const [, video, album] = (await latestPosts(config(), deps(fetch))).data;
    expect(video).toMatchObject({
      kind: "video",
      image: "/api/photos/1802",
      href: "https://www.instagram.com/reel/BBB/",
    });
    expect(album).toMatchObject({ kind: "album", count: 3, caption: null, alt: "A photo from the club's Instagram" });
  });

  it("asks Instagram once every ten minutes, however many people look", async () => {
    const { fetch, calls } = fakeInstagram();
    for (let i = 0; i < 5; i++) await latestPosts(config(), deps(fetch));
    expect(calls.feed).toBe(1);
    t += 10 * 60_000 + 1;
    await latestPosts(config(), deps(fetch));
    expect(calls.feed).toBe(2);
  });

  it("keeps showing the last posts it had while Instagram is down, and says so when it has none", async () => {
    captureLogs();
    await latestPosts(config(), deps(fakeInstagram().fetch));
    t += 60 * 60_000;
    const down = fakeInstagram({ down: true });
    expect((await latestPosts(config(), deps(down.fetch))).data).toHaveLength(3);

    clearCache();
    resetBreakers();
    expect(await latestPosts(config(), deps(down.fetch))).toEqual({ data: [], unavailable: true });
  });

  it("is a sample feed outside production until the club has connected Instagram, and empty in production", async () => {
    const { fetch, calls } = fakeInstagram();
    const notSetUp = { token: async () => null };
    expect((await latestPosts({ ...notSetUp, fake: true }, deps(fetch))).data).toEqual(FAKE_POSTS);
    expect(await latestPosts(notSetUp, deps(fetch))).toEqual({ data: [], unavailable: false });
    expect(calls.feed).toBe(0);
  });
});

describe("a post's picture", () => {
  const deps = (fetch: typeof globalThis.fetch) => ({
    fetch,
    now: () => Date.parse("2026-11-01T12:00:00Z"),
    edge: null,
  });
  beforeEach(() => {
    clearCache();
    resetBreakers();
  });

  it("comes from Instagram's servers through ours, kept by browsers for a week", async () => {
    const { fetch } = fakeInstagram();
    const res = await postImage(config(), "1803", deps(fetch));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("max-age=604800");
    expect(await res.text()).toBe("jpeg bytes");
  });

  it("is fetched from a fresh address when Instagram's has expired", async () => {
    const { fetch, calls } = fakeInstagram({ expired: true });
    const res = await postImage(config(), "1803", deps(fetch));
    expect(res.status).toBe(200);
    expect(calls.media).toBe(1);
  });

  it("is only ever one of the club's recent posts: anything else is not found", async () => {
    const { fetch, calls } = fakeInstagram();
    expect((await postImage(config(), "999", deps(fetch))).status).toBe(404);
    expect((await postImage(config(), "../me", deps(fetch))).status).toBe(404);
    expect((await postImage({ token: async () => null, fake: true }, "1803", deps(fetch))).status).toBe(404);
    expect(calls.cdn).toBe(0);
  });
});
