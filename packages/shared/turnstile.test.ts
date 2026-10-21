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

  it("is true when Cloudflare confirms the token, sending the visitor's address", async () => {
    const cf = siteverify({ success: true });
    expect(await verifyTurnstile("tok", "secret", "1.2.3.4", cf)).toBe(true);
    const body = new URLSearchParams(String(cf.mock.mock.calls[0][1]?.body));
    expect(Object.fromEntries(body)).toEqual({ secret: "secret", response: "tok", remoteip: "1.2.3.4" });
  });

  it("is false when Cloudflare says no, or can't be reached", async () => {
    expect(await verifyTurnstile("tok", "secret", undefined, siteverify({ success: false }))).toBe(false);
    expect(await verifyTurnstile("tok", "secret", undefined, siteverify(new Error("timeout")))).toBe(false);
  });

  it("is false for a token made for another form, given which one it's for", async () => {
    const cf = siteverify({ success: true, action: "join" });
    expect(await verifyTurnstile("tok", "secret", undefined, { ...cf, action: "join" })).toBe(true);
    expect(await verifyTurnstile("tok", "secret", undefined, { ...cf, action: "sign-in" })).toBe(false);
  });

  it("doesn't ask Cloudflare without a token or a secret", async () => {
    const cf = siteverify({ success: true });
    expect(await verifyTurnstile(null, "secret", undefined, cf)).toBe(false);
    expect(await verifyTurnstile("", "secret", undefined, cf)).toBe(false);
    expect(await verifyTurnstile("tok", undefined, undefined, cf)).toBe(false);
    expect(cf.mock).not.toHaveBeenCalled();
  });
});
