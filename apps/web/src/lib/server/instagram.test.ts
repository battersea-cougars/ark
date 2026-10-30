import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBreakers } from "@cougars/shared/breaker";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { clearCache } from "./cache";
import { FAKE_POSTS, latestPosts, postImage, type InstagramConfig } from "./instagram";

// The club's account on Meta's Graph API: three posts, newest first, as /<account>/media answers
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
    caption: "Social night. Mostly upright.",
    media_type: "CAROUSEL_ALBUM",
    media_url: "https://scontent-lhr8-1.cdninstagram.com/v/social-1.jpg",
    permalink: "https://www.instagram.com/p/CCC/",
    timestamp: "2026-10-18T22:30:00+0000",
    children: {
      data: [
        { id: "18011", media_type: "IMAGE", media_url: "https://scontent-lhr8-1.cdninstagram.com/v/social-1.jpg" },
        { id: "18012", media_type: "VIDEO", media_url: "https://scontent-lhr8-1.cdninstagram.com/v/social-2.mp4" },
        { id: "18013", media_type: "IMAGE", media_url: "https://scontent-lhr8-1.cdninstagram.com/v/social-3.jpg" },
      ],
    },
  },
];

function fakeInstagram({ down = false, expired = false } = {}) {
  const calls = { feed: 0, media: 0, cdn: 0 };
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "graph.facebook.com") {
      if (down)
        return Response.json({ error: { message: "Application request limit reached", code: 4 } }, { status: 403 });
      if (url.pathname.endsWith(`/${ACCOUNT}/media`)) {
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

const ACCOUNT = "17841400000000001";
const config = (extra: Partial<InstagramConfig> = {}): InstagramConfig => ({
  account: ACCOUNT,
  token: async () => "token",
  ...extra,
});

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

  it("shows the newest photos first, each served by us, with its post's caption and a link to the post", async () => {
    const { fetch } = fakeInstagram();
    const { data, unavailable } = await latestPosts(config(), deps(fetch));
    expect(unavailable).toBe(false);
    expect(data[0]).toMatchObject({
      id: "1803",
      image: "/api/photos/1803",
      caption: "Friday night under the lights. Same time next week?",
      alt: "Friday night under the lights.",
      href: "https://www.instagram.com/p/AAA/",
      takenAt: "2026-10-31T21:05:00.000Z",
    });
  });

  it("leaves out videos, which the website can't play", async () => {
    const { fetch } = fakeInstagram();
    const ids = (await latestPosts(config(), deps(fetch))).data.map((p) => p.id);
    expect(ids).not.toContain("1802");
    expect(ids).not.toContain("18012");
  });

  it("shows each photo of a post with several as a photo of its own, linking to the post", async () => {
    const { fetch } = fakeInstagram();
    const { data } = await latestPosts(config(), deps(fetch));
    expect(data.map((p) => p.id)).toEqual(["1803", "18011", "18013"]);
    expect(data[2]).toMatchObject({
      image: "/api/photos/18013",
      caption: "Social night. Mostly upright.",
      href: "https://www.instagram.com/p/CCC/",
    });
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
    const notSetUp = { account: ACCOUNT, token: async () => null };
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

  it("is served for each photo of a post with several", async () => {
    const { fetch } = fakeInstagram();
    expect((await postImage(config(), "18013", deps(fetch))).status).toBe(200);
    expect((await postImage(config(), "18012", deps(fetch))).status).toBe(404);
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
    expect((await postImage(config({ token: async () => null, fake: true }), "1803", deps(fetch))).status).toBe(404);
    expect(calls.cdn).toBe(0);
  });
});
