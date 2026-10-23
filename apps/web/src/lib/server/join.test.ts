// The join form (pages/api/join.ts) without JavaScript (CLAUDE.md: forms work without it): a plain POST is answered
// with a 303 to a page that says what went wrong, rendered at build time, so a visitor with no script sees why they're
// back on the form.
import { describe, expect, it, vi } from "vitest";
import type { CacheLike } from "@cougars/shared/rate-limit";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("../sanity/content", () => ({ getSettings: async () => ({}) }));
vi.mock("./mail-env", () => ({
  clubInbox: () => "",
  mailConfig: () => null,
  smokeToken: () => undefined,
  turnstileSecret: () => undefined,
}));
const { POST } = await import("../../pages/api/join");
const { JOIN_REFUSED, refusedAt } = await import("../enquiry-form");

function memoryCache(): CacheLike {
  const store = new Map<string, string>();
  return {
    match: async (key) => (store.has(key) ? new Response(store.get(key)) : undefined),
    put: async (key, res) => void store.set(key, await res.text()),
  };
}

/** The form as a browser with no script sends it: urlencoded, no Accept: application/json. */
function sent(fields: Record<string, string>, address = "1.2.3.4") {
  const request = new Request("https://example.com/api/join", {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return POST({ request, redirect, clientAddress: address, locals: {} } as any) as Promise<Response>;
}

describe("the join form without JavaScript", () => {
  it("sent wrong, it goes back to the form saying so", async () => {
    const res = await sent({ name: "", email: "not an email", source: "/join/" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(refusedAt("invalid"));
    expect(JOIN_REFUSED.invalid).toMatch(/check the form/);
  });

  it("sent too often from one place, it goes back to the form saying to wait", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = memoryCache();
    vi.stubGlobal("caches", { open: async () => cache });
    const good = { name: "Pat Newcomer", email: "pat@example.com", source: "/join/", website: "" };
    // The limit's tries, refused later for want of what an enquiry needs here (D1): only the count matters
    for (let i = 0; i < 5; i++) await sent(good).catch(() => {});
    const res = await sent(good);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(refusedAt("rate"));
    expect(JOIN_REFUSED.rate).toMatch(/try again/);
    vi.unstubAllGlobals();
  });

  it("each refusal has a page of its own under /join/", () => {
    for (const why of Object.keys(JOIN_REFUSED) as (keyof typeof JOIN_REFUSED)[])
      expect(refusedAt(why)).toBe(`/join/${why}/`);
  });
});
