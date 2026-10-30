// Refresh photos and videos (#109): the website keeps YouTube's and Instagram's answers ten minutes (ADR 0016, 0053),
// so a video just added to a playlist, or a post just made, can take that long to show. An admin presses Refresh
// photos and videos in Settings → Website, and the next visit reads them again: on the website within a minute.
// Nothing bumped, the website caches as it always has; and a refresh never loses the last good copy if YouTube is
// down. Driven through the team app's real handlers and the website's own modules (ADR 0031), over the same
// database, with Sanity, YouTube and Instagram faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBreakers } from "@cougars/shared/breaker";
import { clearCache } from "../../../web/src/lib/server/cache";
import { liveVideos } from "../../../web/src/lib/server/videos";
import { latestPosts } from "../../../web/src/lib/server/instagram";
import { mediaRefreshedAt } from "../../../web/src/lib/server/media-refresh";
import { NOW, minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Mo Member", position: "G", rating: 55, email: "mo@example.com" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
/** The club's Friday playlist on YouTube (unlisted videos included), and its Instagram, as they are now. */
let playlist: { id: string; title: string }[];
let posts: { id: string; caption: string }[];
let youtube: "up" | "down";

const item = ({ id, title }: { id: string; title: string }) => ({
  snippet: { publishedAt: "2026-10-02T21:40:00Z", title, description: "", resourceId: { videoId: id } },
  contentDetails: { videoId: id, videoPublishedAt: "2026-10-02T21:40:00Z" },
  status: { privacyStatus: "unlisted" },
});
const media = ({ id, caption }: { id: string; caption: string }) => ({
  id,
  caption,
  media_type: "IMAGE",
  media_url: `https://scontent.cdninstagram.com/${id}.jpg`,
  permalink: `https://www.instagram.com/p/${id}/`,
  timestamp: "2026-10-02T21:40:00Z",
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  clearCache();
  resetBreakers();
  w = testWorld(ROSTER);
  playlist = [{ id: "aaaaaaaaaaa", title: "Friday game" }];
  posts = [{ id: "111", caption: "Friday." }];
  youtube = "up";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname.endsWith(".sanity.io"))
      return Response.json({
        result: { club: { socials: {}, youtubePlaylists: [{ url: "PLfridayfridayfriday", label: "Friday" }] } },
      });
    if (url.hostname === "graph.facebook.com") return Response.json({ data: posts.map(media) });
    if (youtube === "down") return new Response("{}", { status: 503 });
    if (url.pathname.endsWith("/videos")) {
      const ids = url.searchParams.get("id")?.split(",") ?? [];
      return Response.json({ items: ids.map((id) => ({ id, status: { uploadStatus: "processed" } })) });
    }
    return Response.json({ items: playlist.map(item) });
  });
});
afterEach(() => vi.unstubAllGlobals());

/** The website, as a visitor at `at` finds it: same database, its own caches (no edge cache off a custom domain). */
const website = (at: Date) => {
  const deps = { now: () => at.getTime(), edge: null };
  const refreshedAt = () => mediaRefreshedAt(w.db, deps);
  return {
    videos: async () =>
      (
        await liveVideos({ sanity: { projectId: "proj", dataset: "production" }, youtubeKey: "k", refreshedAt }, deps)
      ).data.map((v) => v.title),
    photos: async () =>
      (await latestPosts({ account: "17841400000000001", token: async () => "token", refreshedAt }, deps)).data.map(
        (p) => p.caption,
      ),
  };
};

/** Dana, in Settings → Website. */
async function admin() {
  const b = await w.signedIn("dana@example.com");
  return {
    refresh: (now: Date) => b.call("POST", "/api/website/refresh-media", {}, { now }),
    website: async (now: Date) => (await b.call("GET", "/api/website", undefined, { now })).body,
  };
}

describe("Refresh photos and videos", () => {
  it("a video just added to a playlist is on the website within a minute of the press", async () => {
    const dana = await admin();
    expect(await website(NOW).videos()).toEqual(["Friday game"]);
    // Added on YouTube, unlisted, into the playlist: the website still has its copy from a minute ago
    playlist.push({ id: "bbbbbbbbbbb", title: "Kumite final" });
    expect(await website(minutes(1)).videos()).toEqual(["Friday game"]);
    expect((await dana.refresh(minutes(1))).status).toBe(200);
    expect(await website(minutes(2)).videos()).toEqual(expect.arrayContaining(["Friday game", "Kumite final"]));
  });

  it("a post just made on Instagram too", async () => {
    const dana = await admin();
    expect(await website(NOW).photos()).toEqual(["Friday."]);
    posts.unshift({ id: "222", caption: "Kumite night." });
    await dana.refresh(minutes(1));
    expect(await website(minutes(2)).photos()).toEqual(["Kumite night.", "Friday."]);
  });

  it("with nothing pressed, the website keeps its copy ten minutes, as it always has", async () => {
    expect(await website(NOW).videos()).toEqual(["Friday game"]);
    playlist.push({ id: "bbbbbbbbbbb", title: "Kumite final" });
    expect(await website(minutes(9)).videos()).toEqual(["Friday game"]);
    expect(await website(minutes(11)).videos()).toContain("Kumite final");
  });

  it("pressed while YouTube is down, the website still shows the last good list, not nothing", async () => {
    const dana = await admin();
    expect(await website(NOW).videos()).toEqual(["Friday game"]);
    youtube = "down";
    await dana.refresh(minutes(1));
    expect(await website(minutes(2)).videos()).toEqual(["Friday game"]);
  });

  it("the page says when it was last pressed, and the press is on the record", async () => {
    const dana = await admin();
    expect(await dana.website(NOW)).toMatchObject({ mediaRefreshedAt: null });
    const res = await dana.refresh(minutes(1));
    expect(res.body).toMatchObject({ mediaRefreshedAt: minutes(1).toISOString() });
    expect(await dana.website(minutes(2))).toMatchObject({ mediaRefreshedAt: minutes(1).toISOString() });
    const entry = w.db.raw.prepare("SELECT member_id FROM audit_log WHERE action = 'website.media_refreshed'").get();
    expect(entry).toBeTruthy();
  });

  it("a member who can't edit the website can't press it", async () => {
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("POST", "/api/website/refresh-media", {})).status).toBe(403);
    expect((w.db.raw.prepare("SELECT COUNT(*) n FROM website_times").get() as Json).n).toBe(0);
  });
});
