// Someone asks to try a session on the website's /join form (pages/api/join.ts), end to end: the enquiry is saved in
// D1, the club is emailed, and only someone Turnstile says is a person gets the automatic reply. The outside world is
// faked: Cloudflare's Turnstile check, the Studio's club facts on Sanity, and Gmail (unsent mail lands in the outbox).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outbox, type Mail } from "@cougars/shared/email";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import type { CacheLike } from "@cougars/shared/rate-limit";
import { resetBreakers } from "@cougars/shared/breaker";

const world = vi.hoisted(() => ({ env: { DB: null as unknown, SITE_ENV: "production" } }));
vi.mock("cloudflare:workers", () => world);
vi.mock("astro:env/server", () => ({
  SANITY_PROJECT_ID: "club",
  SANITY_DATASET: "production",
  DEMO_CONTENT: false,
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  // Not set up here: no Gmail (mail lands in the outbox), no smoke test, no Instagram or YouTube
  SANITY_API_TOKEN: undefined,
  GMAIL_REFRESH_TOKEN: undefined,
  GMAIL_TOKEN_KEY: undefined,
  GMAIL_WEB_CLIENT_ID: undefined,
  GMAIL_WEB_CLIENT_SECRET: undefined,
  MAIL_SAFE_TO: undefined,
  SMOKE_TOKEN: undefined,
  YOUTUBE_API_KEY: undefined,
}));
const { POST } = await import("../../pages/api/join");

const CLUB = "club@example.com";
/** The Turnstile token a person's browser gets; anything else, Cloudflare says isn't one. */
const PERSON = "a-person";

let db: ReturnType<typeof createTestD1>;
let inbox: Mail[];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetBreakers();
  db = createTestD1();
  world.env.DB = db;
  inbox = [];
  outbox.capture = (mail) => void inbox.push(mail);
  cached = new Map();
  vi.stubGlobal("caches", { open: async () => memoryCache() });
  vi.stubGlobal("fetch", outsideWorld);
});
afterEach(() => {
  outbox.capture = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Cloudflare's Turnstile and the Studio's club facts. */
async function outsideWorld(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input));
  if (url.hostname === "challenges.cloudflare.com") {
    const token = (init?.body as URLSearchParams).get("response");
    return Response.json({ success: token === PERSON, action: "enquiry" });
  }
  if (url.hostname.endsWith(".apicdn.sanity.io")) return Response.json({ result: { club: { contactEmail: CLUB } } });
  return new Response("not faked", { status: 500 });
}

/** Cloudflare's cache, which the form's limit counts in: empty for each test. */
let cached: Map<string, string>;
function memoryCache(): CacheLike {
  return {
    match: async (key) => (cached.has(key) ? new Response(cached.get(key)) : undefined),
    put: async (key, res) => void cached.set(key, await res.text()),
  };
}

/** The form as the enhanced page sends it, from one address; the emails after it go out before this returns. */
async function join(fields: Record<string, string>, address = "1.2.3.4") {
  const form = new URLSearchParams({ name: "Pat Newcomer", email: "pat@example.com", source: "/join/", ...fields });
  const request = new Request("https://batterseacougars.com/api/join", {
    method: "POST",
    body: form,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
  });
  const after: Promise<unknown>[] = [];
  const locals = { cfContext: { waitUntil: (p: Promise<unknown>) => void after.push(p) } };
  const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (await POST({ request, redirect, clientAddress: address, locals } as any)) as Response;
  await Promise.all(after);
  return res;
}

const enquiries = () =>
  db.raw.prepare("SELECT email, verified, auto_replied_at FROM enquiries ORDER BY id").all() as {
    email: string;
    verified: number;
    auto_replied_at: string | null;
  }[];
const to = (address: string) => inbox.filter((m) => m.to.includes(address));

describe("someone asks to try a session on the website", () => {
  it("a person gets the session details by email, and the club's email says they have", async () => {
    const res = await join({ "cf-turnstile-response": PERSON });
    expect(res.status).toBe(200);
    expect(enquiries()).toEqual([expect.objectContaining({ email: "pat@example.com", verified: 1 })]);
    expect(to("pat@example.com")).toEqual([expect.objectContaining({ replyTo: CLUB })]);
    expect(to(CLUB)[0].text).toContain("They've had the automatic reply");
  });

  it("without Turnstile's say-so (a bot, or no JavaScript), it's still saved and the club told, with no automatic reply", async () => {
    const res = await join({ "cf-turnstile-response": "a-script" });
    expect(res.status).toBe(200);
    expect(enquiries()).toEqual([expect.objectContaining({ verified: 0, auto_replied_at: null })]);
    expect(to("pat@example.com")).toEqual([]);
    expect(to(CLUB)[0].text).toContain("No automatic reply was sent: the form wasn't verified as sent by a person.");
  });

  it("asking again the same week, the club hears again but the person gets no second automatic reply", async () => {
    await join({ "cf-turnstile-response": PERSON });
    await join({ "cf-turnstile-response": PERSON }, "5.6.7.8");
    expect(enquiries()).toHaveLength(2);
    expect(to("pat@example.com")).toHaveLength(1);
    expect(to(CLUB)[1].text).toContain("already had one this week");
  });

  it("a form sent wrong uses up nobody's tries: five a quarter-hour from one place count only real enquiries", async () => {
    for (let i = 0; i < 5; i++) expect((await join({ email: "not an email" })).status).toBe(400);
    expect((await join({ "cf-turnstile-response": PERSON })).status).toBe(200);
    for (let i = 0; i < 4; i++) await join({ email: `pat${i}@example.com` });
    expect((await join({ email: "pat9@example.com" })).status).toBe(429);
  });
});
