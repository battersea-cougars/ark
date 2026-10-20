import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBreakers } from "@cougars/shared/breaker";
import { sanityQuery, type SanityConfig } from "./sanity-live";

const config: SanityConfig = { projectId: "abc123", dataset: "production" };

beforeEach(() => resetBreakers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reading Sanity from the Worker", () => {
  it("asks the API CDN for published content, with a token only when there is one", async () => {
    const fetch = vi.fn(async (_url: URL, _init?: RequestInit) => Response.json({ result: [] }));
    vi.stubGlobal("fetch", fetch);
    await sanityQuery(config, "*[_type == $t]", { t: "video" });
    const [url, init] = fetch.mock.calls[0];
    expect(url.hostname).toBe("abc123.apicdn.sanity.io");
    expect(url.searchParams.get("perspective")).toBe("published");
    expect(url.searchParams.get("$t")).toBe('"video"');
    expect(init?.headers).toEqual({});
    await sanityQuery({ ...config, token: "viewer" }, "*");
    expect(fetch.mock.calls[1][1]?.headers).toEqual({ Authorization: "Bearer viewer" });
  });

  it("stops asking for an hour once Sanity's quota is spent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spent = vi.fn(async () => Response.json({ error: "plan_limit_reached" }, { status: 402 }));
    vi.stubGlobal("fetch", spent);
    await expect(sanityQuery(config, "*")).rejects.toThrow();
    await expect(sanityQuery(config, "*")).rejects.toThrow();
    expect(spent).toHaveBeenCalledTimes(1);
  });

  it("drops a link that would run a script", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ result: { url: "javascript:alert(1)", title: "x" } }));
    expect(await sanityQuery(config, "*")).toEqual({ url: null, title: "x" });
  });
});
