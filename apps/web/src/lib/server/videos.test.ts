import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "../fixtures/youtube.json";
import { resetBreakers } from "@cougars/shared/breaker";
import { clearCache } from "./cache";
import { liveVideos, type VideosConfig } from "./videos";
import { DEMO_VIDEOS } from "../sanity/demo";

const sanity = { projectId: "proj", dataset: "production" };
const pasted = {
  _id: "video-pasted",
  youtubeUrl: "https://www.youtube.com/watch?v=pppppppppp1",
  title: "Pasted link",
  recordedOn: "2026-10-02",
};

// The network boundary: Sanity's API CDN and the YouTube API, answering from fixtures and counting calls.
function fakeNetwork({
  club = {},
  videos = [pasted] as object[],
  youtube = "ok" as "ok" | "down",
  sanityUp = true,
  processing = [] as string[],
  statusDown = false,
} = {}) {
  const calls = { sanity: 0, youtube: 0 };
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    if (url.hostname.endsWith(".sanity.io")) {
      calls.sanity++;
      if (!sanityUp) return new Response("down", { status: 500 });
      return Response.json({ result: { club: { socials: {}, ...club }, videos } });
    }
    calls.youtube++;
    if (youtube === "down") return Response.json(fixtures.quotaExceeded, { status: 403 });
    if (url.pathname.endsWith("/channels")) return Response.json(fixtures.channels);
    if (url.pathname.endsWith("/videos")) {
      if (statusDown) return new Response("{}", { status: 503 });
      const ids = url.searchParams.get("id")?.split(",") ?? [];
      const uploadStatus = (id: string) => (processing.includes(id) ? "uploaded" : "processed");
      return Response.json({ items: ids.map((id) => ({ id, status: { uploadStatus: uploadStatus(id) } })) });
    }
    return Response.json({ items: fixtures.playlistItems.items });
  });
  return { fetch, calls };
}

const config = (extra: Partial<VideosConfig> = {}): VideosConfig => ({ sanity, youtubeKey: "k", ...extra });

describe("liveVideos", () => {
  let t = 0;
  const now = () => t;
  beforeEach(() => {
    clearCache();
    resetBreakers();
    t = 1_000_000;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is the Sanity videos only before the club has a channel", async () => {
    const { fetch, calls } = fakeNetwork();
    vi.stubGlobal("fetch", fetch);
    const { data } = await liveVideos(config(), { now, edge: null });
    expect(data.map((v) => v.title)).toEqual(["Pasted link"]);
    expect(calls.youtube).toBe(0);
  });

  it("merges a club playlist (unlisted included) with the Sanity videos", async () => {
    const { fetch } = fakeNetwork({
      club: { youtubePlaylists: [{ url: "PLabcdefghijklmnop", label: "Friday hockey" }] },
    });
    vi.stubGlobal("fetch", fetch);
    const { data } = await liveVideos(config(), { now, edge: null });
    expect(data.map((v) => v.title)).toEqual(
      expect.arrayContaining(["Friday session, full game", "Team only", "Kumite final", "Pasted link"]),
    );
    expect(data.find((v) => v.title === "Team only")?.label).toBe("Friday hockey");
    expect(data.find((v) => v.title === "Pasted link")?.label).toBeNull();
  });

  it("asks YouTube once per ten minutes, and Sanity once a minute", async () => {
    const { fetch, calls } = fakeNetwork({ club: { socials: { youtube: "https://www.youtube.com/@club" } } });
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 5; i++) await liveVideos(config(), { now, edge: null });
    expect(calls).toEqual({ sanity: 1, youtube: 3 }); // channels + playlistItems + videos
    t += 61_000;
    await liveVideos(config(), { now, edge: null });
    expect(calls).toEqual({ sanity: 2, youtube: 3 });
    t += 10 * 60_000;
    await liveVideos(config(), { now, edge: null });
    expect(calls.youtube).toBe(6);
  });

  it("shows a new upload only once YouTube has finished processing it, within ten minutes", async () => {
    const club = { youtubePlaylists: [{ url: "PLabcdefghijklmnop", label: "Friday hockey" }] };
    vi.stubGlobal("fetch", fakeNetwork({ club, processing: ["aaaaaaaaaaa"] }).fetch);
    const titles = async () => (await liveVideos(config(), { now, edge: null })).data.map((v) => v.title);
    expect(await titles()).not.toContain("Friday session, full game");
    vi.stubGlobal("fetch", fakeNetwork({ club }).fetch);
    t += 9 * 60_000;
    expect(await titles()).not.toContain("Friday session, full game"); // still the cached list
    t += 61_000;
    expect(await titles()).toContain("Friday session, full game");
  });

  it("keeps the last good list when YouTube won't say which videos are ready", async () => {
    const club = { youtubePlaylists: [{ url: "PLabcdefghijklmnop", label: "Friday hockey" }] };
    vi.stubGlobal("fetch", fakeNetwork({ club, processing: ["aaaaaaaaaaa"] }).fetch);
    const before = (await liveVideos(config(), { now, edge: null })).data;
    t += 11 * 60_000;
    vi.stubGlobal("fetch", fakeNetwork({ club, statusDown: true }).fetch);
    expect((await liveVideos(config(), { now, edge: null })).data).toEqual(before);
  });

  it("reads Sanity through its API CDN", async () => {
    const { fetch } = fakeNetwork();
    vi.stubGlobal("fetch", fetch);
    await liveVideos(config(), { now, edge: null });
    expect(String(fetch.mock.calls[0][0])).toContain("https://proj.apicdn.sanity.io/");
  });

  it("keeps showing the last YouTube list when YouTube fails", async () => {
    const club = { socials: { youtube: "https://www.youtube.com/@club" } };
    vi.stubGlobal("fetch", fakeNetwork({ club }).fetch);
    const before = (await liveVideos(config(), { now, edge: null })).data;
    t += 11 * 60_000;
    vi.stubGlobal("fetch", fakeNetwork({ club, youtube: "down" }).fetch);
    expect((await liveVideos(config(), { now, edge: null })).data).toEqual(before);
  });

  it("stops asking YouTube once its daily quota is spent, until it resets", async () => {
    const club = { socials: { youtube: "https://www.youtube.com/@club" } };
    const { fetch, calls } = fakeNetwork({ club, youtube: "down" });
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 3; i++) {
      await liveVideos(config(), { now, edge: null });
      t += 11 * 60_000; // past the cache each time
    }
    expect(calls.youtube).toBe(1); // the first 403 paused YouTube until midnight Pacific
  });

  it("still shows the Sanity videos when YouTube fails with nothing cached", async () => {
    const { fetch } = fakeNetwork({ club: { socials: { youtube: "https://www.youtube.com/@club" } }, youtube: "down" });
    vi.stubGlobal("fetch", fetch);
    const { data, unavailable } = await liveVideos(config(), { now, edge: null });
    expect(data.map((v) => v.title)).toEqual(["Pasted link"]);
    expect(unavailable).toBe(false);
  });

  it("never sends YouTube a request without a key", async () => {
    const { fetch, calls } = fakeNetwork({
      club: { youtubePlaylists: [{ url: "PLabcdefghijklmnop", label: "Friday hockey" }] },
    });
    vi.stubGlobal("fetch", fetch);
    await liveVideos(config({ youtubeKey: undefined }), { now, edge: null });
    expect(calls.youtube).toBe(0);
  });

  it("says it's unavailable when Sanity is down and there's nothing to show", async () => {
    vi.stubGlobal("fetch", fakeNetwork({ sanityUp: false }).fetch);
    expect(await liveVideos(config(), { now, edge: null })).toEqual({ data: [], unavailable: true });
  });

  it("shows the sample videos with demo content and nothing real", async () => {
    vi.stubGlobal("fetch", fakeNetwork({ videos: [] }).fetch);
    expect((await liveVideos(config({ demo: true }), { now, edge: null })).data).toEqual(DEMO_VIDEOS);
  });
});
