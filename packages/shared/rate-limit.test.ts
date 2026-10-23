import { describe, expect, it } from "vitest";
import { rateLimit, type CacheLike } from "./rate-limit";

function memoryCache(): CacheLike {
  const store = new Map<string, string>();
  return {
    async match(key) {
      return store.has(key) ? new Response(store.get(key)) : undefined;
    },
    async put(key, res) {
      store.set(key, await res.text());
    },
  };
}

describe("rateLimit", () => {
  const opts = { limit: 2, windowSeconds: 60, now: 1_000_000 };

  it("allows up to the limit, then blocks", async () => {
    const cache = memoryCache();
    expect((await rateLimit(cache, "join", "1.1.1.1", opts)).allowed).toBe(true);
    expect((await rateLimit(cache, "join", "1.1.1.1", opts)).allowed).toBe(true);
    expect((await rateLimit(cache, "join", "1.1.1.1", opts)).allowed).toBe(false);
  });

  it("counts per IP and resets in the next window", async () => {
    const cache = memoryCache();
    await rateLimit(cache, "join", "1.1.1.1", opts);
    await rateLimit(cache, "join", "1.1.1.1", opts);
    expect((await rateLimit(cache, "join", "2.2.2.2", opts)).allowed).toBe(true);
    expect((await rateLimit(cache, "join", "1.1.1.1", { ...opts, now: opts.now + 60_000 })).allowed).toBe(true);
  });

  it("can only look, without counting", async () => {
    const cache = memoryCache();
    for (let i = 0; i < 5; i++)
      expect((await rateLimit(cache, "api", "1.1.1.1", { ...opts, spend: false })).allowed).toBe(true);
    await rateLimit(cache, "api", "1.1.1.1", opts);
    await rateLimit(cache, "api", "1.1.1.1", opts);
    expect((await rateLimit(cache, "api", "1.1.1.1", { ...opts, spend: false })).allowed).toBe(false);
  });
});
