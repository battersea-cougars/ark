import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBreakers } from "@cougars/shared/breaker";
import fixtures from "./fixtures/youtube.json";
import type { Video, VideoOverride } from "./sanity/types";
import {
  fetchChannelVideos,
  fetchSourceVideos,
  mergeVideos,
  parseChannel,
  parsePlaylist,
  sourceKey,
  tidyTitle,
  toVideo,
  videoSource,
  youtubeId,
} from "./youtube";

beforeEach(() => resetBreakers());

describe("youtubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    [" https://youtu.be/dQw4w9WgXcQ ", "dQw4w9WgXcQ"],
  ])("%s", (url, id) => expect(youtubeId(url)).toBe(id));

  it.each(["", "not a url", "https://vimeo.com/123", "https://youtube.com/watch?v=short"])("rejects %s", (url) =>
    expect(youtubeId(url)).toBeNull(),
  );
});

describe("parseChannel", () => {
  it.each([
    ["https://www.youtube.com/@BatterseaCougars", { handle: "BatterseaCougars" }],
    ["https://youtube.com/@battersea.cougars/videos", { handle: "battersea.cougars" }],
    ["https://m.youtube.com/@cougars-hockey?si=x", { handle: "cougars-hockey" }],
    ["@BatterseaCougars", { handle: "BatterseaCougars" }],
    ["https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", { id: "UCabcdefghijklmnopqrstuv" }],
    ["https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/featured", { id: "UCabcdefghijklmnopqrstuv" }],
  ])("%s", (url, channel) => expect(parseChannel(url)).toEqual(channel));

  it.each([
    "",
    "https://www.youtube.com/c/Cougars", // legacy custom URL: the API can't look these up
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.instagram.com/@cougars",
    "https://www.youtube.com/channel/nope",
  ])("rejects %s", (url) => expect(parseChannel(url)).toBeNull());
});

describe("toVideo", () => {
  const [pub, priv, deleted, unlisted] = fixtures.playlistItems.items;

  it("maps a public upload, dated by the London day it went on YouTube", () => {
    expect(toVideo(pub)).toEqual({
      _id: "youtube-aaaaaaaaaaa",
      title: "Friday session, full game",
      recordedOn: "2026-10-03",
      youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      description: "Five a side, two goalies.",
    });
  });

  it("skips private, deleted and unlisted videos", () => {
    expect([priv, deleted, unlisted].map((i) => toVideo(i))).toEqual([null, null, null]);
  });

  it("keeps unlisted videos from a club playlist, but never private or deleted ones", () => {
    expect(toVideo(unlisted, { unlisted: true })?._id).toMatch(/^youtube-/);
    expect([priv, deleted].map((i) => toVideo(i, { unlisted: true }))).toEqual([null, null]);
  });
});

describe("tidyTitle", () => {
  const uploaded = "2026-10-05";

  it("drops the club's name and the date, which becomes the recorded date", () => {
    expect(tidyTitle("Battersea Cougars - 2nd October 2026", uploaded)).toEqual({
      title: "Friday session",
      recordedOn: "2026-10-02",
    });
    expect(tidyTitle("Battersea Cougars - Kumite final - 26 Sept 2026", uploaded)).toEqual({
      title: "Kumite final",
      recordedOn: "2026-09-26",
    });
    expect(tidyTitle("Cougars: October 2nd, 2026 (full game)", uploaded).recordedOn).toBe("2026-10-02");
  });

  it("reads the date in any common form, UK order", () => {
    for (const raw of ["Game 2026-10-02", "Game 02/10/2026", "Game 2.10.26", "Game 2 Oct 2026"]) {
      expect(tidyTitle(raw, uploaded)).toEqual({ title: "Game", recordedOn: "2026-10-02" });
    }
  });

  it("keeps the upload date when the title has none, or an impossible or future one", () => {
    expect(tidyTitle("Full game", uploaded)).toEqual({ title: "Full game", recordedOn: uploaded });
    expect(tidyTitle("Game 31/02/2026", uploaded).recordedOn).toBe(uploaded);
    expect(tidyTitle("Game 9 October 2026", uploaded).recordedOn).toBe(uploaded);
  });

  it("names a video with nothing left after its day", () => {
    expect(tidyTitle("Battersea Cougars - 4 Oct 2026", uploaded).title).toBe("Cougars video"); // a Sunday
    expect(tidyTitle("  ", uploaded).title).toBe("Cougars video");
  });

  it("keeps the club's name when it's part of the title", () => {
    expect(tidyTitle("Cougars v Lions", uploaded).title).toBe("Cougars v Lions");
    expect(tidyTitle("Battersea Cougars 25th anniversary", uploaded).title).toBe("Battersea Cougars 25th anniversary");
  });
});

// YouTube's `videos` answer for the ids asked about: each one done processing unless `statuses` says otherwise
// ("uploaded" while it's still processing, "failed", "rejected", "deleted"). An id mapped to null isn't returned.
function videoStatuses(url: URL, statuses: Record<string, string | null> = {}) {
  const ids = url.searchParams.get("id")?.split(",") ?? [];
  const items = ids
    .filter((id) => statuses[id] !== null)
    .map((id) => ({ kind: "youtube#video", id, status: { uploadStatus: statuses[id] ?? "processed" } }));
  return Response.json({ kind: "youtube#videoListResponse", items });
}
const isVideos = (url: URL) => url.pathname === "/youtube/v3/videos";
const playlistCalls = (calls: URL[]) => calls.filter((c) => c.pathname.endsWith("/playlistItems"));

// The network boundary: a fake fetch that answers like the YouTube API and records what was asked.
function fakeYouTube(pages: number, perPage = 2, statuses: Record<string, string | null> = {}) {
  const calls: URL[] = [];
  const pub = fixtures.playlistItems.items[0];
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.endsWith("/channels")) return Response.json(fixtures.channels);
    if (isVideos(url)) return videoStatuses(url, statuses);
    const page = Number(url.searchParams.get("pageToken") ?? 0);
    const items = Array.from({ length: perPage }, (_, i) => {
      const id = `vid${page}x${i}`.padEnd(11, "0");
      return { ...pub, contentDetails: { videoId: id, videoPublishedAt: pub.contentDetails.videoPublishedAt } };
    });
    return Response.json({ items, ...(page + 1 < pages ? { nextPageToken: String(page + 1) } : {}) });
  });
  return { fetch, calls };
}

describe("fetchChannelVideos", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.unstubAllGlobals());

  it("looks the channel up by handle, then reads its uploads playlist", async () => {
    const { fetch, calls } = fakeYouTube(1);
    vi.stubGlobal("fetch", fetch);
    const videos = await fetchChannelVideos({ handle: "BatterseaCougars" }, "k");
    expect(videos).toHaveLength(2);
    expect(calls[0].pathname).toBe("/youtube/v3/channels");
    expect(calls[0].searchParams.get("forHandle")).toBe("@BatterseaCougars");
    expect(calls[1].searchParams.get("playlistId")).toBe("UUabcdefghijklmnopqrstuv");
    expect(calls[1].searchParams.get("maxResults")).toBe("50");
  });

  it("looks a /channel/UC... link up by id", async () => {
    const { fetch, calls } = fakeYouTube(1);
    vi.stubGlobal("fetch", fetch);
    await fetchChannelVideos({ id: "UCabcdefghijklmnopqrstuv" }, "k");
    expect(calls[0].searchParams.get("id")).toBe("UCabcdefghijklmnopqrstuv");
  });

  it("follows page tokens to the end", async () => {
    const { fetch, calls } = fakeYouTube(3);
    vi.stubGlobal("fetch", fetch);
    const videos = await fetchChannelVideos({ handle: "c00" }, "k");
    expect(videos).toHaveLength(6);
    expect(playlistCalls(calls).map((c) => c.searchParams.get("pageToken"))).toEqual([null, "1", "2"]);
  });

  it("stops at the cap", async () => {
    const { fetch, calls } = fakeYouTube(10, 2);
    vi.stubGlobal("fetch", fetch);
    expect(await fetchChannelVideos({ handle: "c00" }, "k", { max: 5 })).toHaveLength(5);
    expect(calls).toHaveLength(1 + 3 + 3); // channels, then playlistItems and videos per page
  });

  it("leaves out a video still processing on YouTube, and shows it once it's done", async () => {
    const processing = fakeYouTube(1, 3, { vid0x100000: "uploaded" });
    vi.stubGlobal("fetch", processing.fetch);
    const before = await fetchChannelVideos({ handle: "c00" }, "k");
    expect(before.map((v) => v._id)).toEqual(["youtube-vid0x000000", "youtube-vid0x200000"]);
    const videosCall = processing.calls.find(isVideos)!;
    expect(videosCall.searchParams.get("part")).toBe("status");
    expect(videosCall.searchParams.get("id")).toBe("vid0x000000,vid0x100000,vid0x200000");

    vi.stubGlobal("fetch", fakeYouTube(1, 3).fetch);
    expect(await fetchChannelVideos({ handle: "c00" }, "k")).toHaveLength(3);
  });

  it("never shows a video whose upload failed, was rejected or is gone", async () => {
    const statuses = { vid0x000000: "failed", vid0x100000: "rejected", vid0x200000: "deleted", vid0x300000: null };
    vi.stubGlobal("fetch", fakeYouTube(1, 5, statuses).fetch);
    expect((await fetchChannelVideos({ handle: "c00" }, "k")).map((v) => v._id)).toEqual(["youtube-vid0x400000"]);
  });

  it("asks about at most 50 videos at a time, one call per page", async () => {
    const { fetch, calls } = fakeYouTube(3, 50);
    vi.stubGlobal("fetch", fetch);
    expect(await fetchChannelVideos({ handle: "c00" }, "k", { max: 120 })).toHaveLength(120);
    const asked = calls.filter(isVideos).map((c) => c.searchParams.get("id")!.split(","));
    expect(asked.map((ids) => ids.length)).toEqual([50, 50, 50]);
  });

  it("fills up to the cap past videos still processing", async () => {
    vi.stubGlobal("fetch", fakeYouTube(3, 2, { vid0x000000: "uploaded", vid1x000000: "uploaded" }).fetch);
    const videos = await fetchChannelVideos({ handle: "c00" }, "k", { max: 3 });
    expect(videos.map((v) => v._id)).toEqual(["youtube-vid0x100000", "youtube-vid1x100000", "youtube-vid2x000000"]);
  });

  it("throws when YouTube won't say which videos are ready", async () => {
    const { fetch } = fakeYouTube(1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => (isVideos(new URL(input)) ? new Response("{}", { status: 500 }) : fetch(input))),
    );
    await expect(fetchChannelVideos({ handle: "c00" }, "k")).rejects.toThrow(/YouTube videos: 500/);
  });

  it("drops private and deleted items from the real response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        isVideos(new URL(url))
          ? videoStatuses(new URL(url))
          : Response.json(url.includes("/channels") ? fixtures.channels : fixtures.playlistItems),
      ),
    );
    // The fixture's nextPageToken leads back to the same page; the cap ends it.
    const videos = await fetchChannelVideos({ handle: "c00" }, "k", { max: 2 });
    expect(videos.map((v) => v.title)).toEqual(["Friday session, full game", "Kumite final"]);
  });

  it("throws on an unknown channel or an API error, without the key in the message", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ items: [] }));
    await expect(fetchChannelVideos({ handle: "nobody" }, "SECRET")).rejects.toThrow(/not found/);
    vi.stubGlobal("fetch", async () => Response.json(fixtures.quotaExceeded, { status: 403 }));
    const err = await fetchChannelVideos({ handle: "c00" }, "SECRET").catch((e: Error) => e);
    expect(String(err)).toMatch(/403 The request cannot be completed/);
    expect(String(err)).not.toContain("SECRET");
  });
});

describe("parsePlaylist", () => {
  it.each([
    ["PLabcdefghijklmnop", "PLabcdefghijklmnop"],
    ["https://www.youtube.com/playlist?list=PLabcdefghijklmnop", "PLabcdefghijklmnop"],
    ["https://youtube.com/playlist?list=PLabcdefghijklmnop&si=xyz", "PLabcdefghijklmnop"],
    ["https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PLabcdefghijklmnop", "PLabcdefghijklmnop"],
    // Newer playlists have shorter IDs
    ["https://www.youtube.com/playlist?list=PLfSJFMlRG9fY", "PLfSJFMlRG9fY"],
    ["https://www.youtube.com/@club", null],
    ["not a playlist", null],
  ])("%s", (input, expected) => expect(parsePlaylist(input)).toBe(expected));
});

describe("videoSource", () => {
  it("prefers the playlists, then the channel ID, then the channel link", () => {
    const socials = { youtube: "https://www.youtube.com/@club" };
    const youtubePlaylists = [
      { url: "https://www.youtube.com/playlist?list=PLabcdefghijklmnop", label: " Friday hockey " },
      { url: "https://www.youtube.com/playlist?list=PLqrstuvwxyz", label: "" },
      { url: "not a playlist", label: "Broken" },
    ];
    const id = "UCabcdefghijklmnopqrstuv";
    expect(videoSource({ youtubePlaylists, youtubeChannelId: id, socials })).toEqual({
      playlists: [
        { id: "PLabcdefghijklmnop", label: "Friday hockey" },
        { id: "PLqrstuvwxyz", label: null },
      ],
    });
    expect(videoSource({ youtubePlaylists: [], youtubeChannelId: id, socials })).toEqual({ channel: { id } });
    expect(videoSource({ youtubeChannelId: id, socials })).toEqual({ channel: { id } });
    expect(videoSource({ socials })).toEqual({ channel: { handle: "club" } });
    expect(videoSource({ socials: { youtube: null } })).toBeNull();
  });

  it("names each source for the cache", () => {
    const playlists = [
      { id: "PLx", label: "Kumite" },
      { id: "PLy", label: null },
    ];
    expect(sourceKey({ playlists })).toBe("playlists:PLx=Kumite,PLy=");
    expect(sourceKey({ channel: { handle: "club" } })).toBe("handle:club");
    expect(sourceKey({ channel: { id: "UCx" } })).toBe("channel:UCx");
  });
});

describe("fetchSourceVideos", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a playlist directly, including its unlisted videos", async () => {
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        calls.push(new URL(input));
        if (isVideos(new URL(input))) return videoStatuses(new URL(input));
        return Response.json({ items: fixtures.playlistItems.items });
      }),
    );
    const videos = await fetchSourceVideos({ playlists: [{ id: "PLabcdefghijklmnop", label: null }] }, "k");
    expect(calls).toHaveLength(2); // playlistItems, then videos for which are ready
    expect(calls[0].pathname).toBe("/youtube/v3/playlistItems");
    expect(calls[0].searchParams.get("playlistId")).toBe("PLabcdefghijklmnop");
    // public, private, deleted, unlisted, ...: the public and the unlisted ones
    expect(videos.length).toBe(
      fixtures.playlistItems.items.filter((i) => ["public", "unlisted"].includes(i.status?.privacyStatus ?? "")).length,
    );
  });

  it("labels each video with its playlist, and lists a video in two playlists once", async () => {
    const items = fixtures.playlistItems.items.filter((i) => i.status?.privacyStatus === "public");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        isVideos(new URL(input))
          ? videoStatuses(new URL(input))
          : // The Kumite playlist holds the first public video again, plus nothing else.
            Response.json({
              items: new URL(input).searchParams.get("playlistId") === "PLkumite00000" ? items.slice(0, 1) : items,
            }),
      ),
    );
    const playlists = [
      { id: "PLfriday00000", label: "Friday hockey" },
      { id: "PLkumite00000", label: "Kumite" },
    ];
    const videos = await fetchSourceVideos({ playlists }, "k");
    expect(videos).toHaveLength(items.length);
    expect(new Set(videos.map((v) => v.label))).toEqual(new Set(["Friday hockey"]));
  });

  it("reads a channel's uploads, public only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        isVideos(new URL(url))
          ? videoStatuses(new URL(url))
          : Response.json(url.includes("/channels") ? fixtures.channels : { items: fixtures.playlistItems.items }),
      ),
    );
    const videos = await fetchSourceVideos({ channel: { handle: "club" } }, "k");
    expect(videos.map((v) => v.title)).toEqual(["Friday session, full game", "Kumite final"]);
  });
});

describe("mergeVideos", () => {
  const yt = (id: string, recordedOn: string, title = `YouTube ${id}`): Video => ({
    _id: `youtube-${id}`,
    title,
    recordedOn,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    description: `About ${id}`,
  });
  const doc = (id: string, fields: Partial<VideoOverride> = {}): VideoOverride => ({
    _id: `doc-${id}`,
    youtubeUrl: `https://youtu.be/${id}`,
    ...fields,
  });
  const channel = [yt("aaaaaaaaaaa", "2026-10-02"), yt("bbbbbbbbbbb", "2026-09-25"), yt("ccccccccccc", "2026-09-18")];
  const ids = (vs: Video[]) => vs.map((v) => youtubeId(v.youtubeUrl)![0]);

  it("lists the channel newest first with no overrides", () => {
    expect(ids(mergeVideos([...channel].reverse(), []))).toEqual(["a", "b", "c"]);
  });

  it("lets filled-in Sanity fields win, and keeps YouTube's for empty ones", () => {
    const [b] = mergeVideos(channel, [
      doc("bbbbbbbbbbb", { title: "Kumite final", recordedOn: "2026-09-26", description: null }),
    ]).filter((v) => v.title === "Kumite final");
    expect(b).toMatchObject({ _id: "doc-bbbbbbbbbbb", recordedOn: "2026-09-26", description: "About bbbbbbbbbbb" });
    expect(b.youtubeUrl).toBe("https://www.youtube.com/watch?v=bbbbbbbbbbb");
  });

  it("removes hidden videos", () => {
    expect(ids(mergeVideos(channel, [doc("aaaaaaaaaaa", { hidden: true })]))).toEqual(["b", "c"]);
  });

  it("puts pinned videos first, then newest", () => {
    const merged = mergeVideos(channel, [doc("ccccccccccc", { pinned: true }), doc("bbbbbbbbbbb", { pinned: true })]);
    expect(ids(merged)).toEqual(["b", "c", "a"]);
  });

  it("adds videos that are only in Sanity, including old timestamped ones", () => {
    const merged = mergeVideos(channel, [
      doc("ddddddddddd", { title: "Away game", recordedOn: "2026-09-30" }),
      doc("eeeeeeeeeee", { title: "Demo clip", recordedOn: "2026-10-09T20:30:00.000Z" }),
      doc("fffffffffff", { _createdAt: "2026-01-01T12:00:00Z" }),
      { _id: "broken", youtubeUrl: "https://vimeo.com/1", title: "Not YouTube" },
    ]);
    expect(ids(merged)).toEqual(["e", "a", "d", "b", "c", "f"]);
    expect(merged.at(-1)).toMatchObject({ title: "Cougars video", recordedOn: "2026-01-01" });
  });

  it("is Sanity videos only when the channel gave nothing", () => {
    expect(mergeVideos([], [doc("aaaaaaaaaaa", { title: "T", recordedOn: "2026-01-01" })])).toHaveLength(1);
  });
});
