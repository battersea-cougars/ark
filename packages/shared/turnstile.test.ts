import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

// The network boundary: Cloudflare's siteverify endpoint.
const siteverify = (answer: object | Error) => {
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    if (answer instanceof Error) throw answer;
    return Response.json({ ...answer, sent: Object.fromEntries(new URLSearchParams(String(init?.body))) });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, mock: fetch };
};

describe("verifyTurnstile", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("doesn't ask Cloudflare without a token or a secret", async () => {
    const cf = siteverify({ success: true });
    expect(await verifyTurnstile(null, "secret", undefined, cf)).toBe(false);
    expect(await verifyTurnstile("", "secret", undefined, cf)).toBe(false);
    expect(await verifyTurnstile("tok", undefined, undefined, cf)).toBe(false);
    expect(cf.mock).not.toHaveBeenCalled();
  });
});
