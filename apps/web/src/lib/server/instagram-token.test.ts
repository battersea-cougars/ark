import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { instagramToken, renewInstagramToken, seal, type InstagramTokenEnv } from "./instagram-token";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const DAY = 24 * 60 * 60_000;
const START = Date.parse("2026-11-01T03:17:00Z");

// Instagram's token endpoint: hands back a fresh token for the current one, or refuses
function fakeInstagram(answer: "ok" | "refused" = "ok") {
  let n = 0;
  const seen: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    seen.push(url.searchParams.get("access_token") ?? "");
    if (answer === "refused")
      return Response.json({ error: { message: "Error validating access token", code: 190 } }, { status: 400 });
    return Response.json({ access_token: `renewed-${++n}`, token_type: "bearer", expires_in: 60 * 24 * 60 * 60 });
  });
  return { fetch, seen };
}

describe("the Instagram token", () => {
  let env: InstagramTokenEnv & { DB: ReturnType<typeof createTestD1> };
  beforeEach(() => {
    env = { DB: createTestD1(), INSTAGRAM_TOKEN: "from-bitwarden", INSTAGRAM_TOKEN_KEY: KEY };
  });
  afterEach(() => vi.restoreAllMocks());

  it("is the one from Bitwarden until the cron has renewed it", async () => {
    expect(await instagramToken(env)).toBe("from-bitwarden");
  });

  it("is renewed by the cron, kept sealed in the database, and used from then on", async () => {
    const instagram = fakeInstagram();
    expect(await renewInstagramToken(env, { now: START, fetch: instagram.fetch })).toBe("renewed");
    expect(instagram.seen).toEqual(["from-bitwarden"]);
    expect(await instagramToken(env)).toBe("renewed-1");

    const row = env.DB.raw.prepare("SELECT * FROM sealed_tokens").get() as Record<string, string>;
    expect(row.name).toBe("instagram");
    expect(row.sealed).not.toContain("renewed-1");
    expect(atob(row.sealed)).not.toContain("renewed-1");
    expect(row.expires_at).toBe(new Date(START + 60 * DAY).toISOString());
  });

  it("is renewed once a week, however often the cron runs, each time from the last one", async () => {
    const instagram = fakeInstagram();
    await renewInstagramToken(env, { now: START, fetch: instagram.fetch });
    expect(await renewInstagramToken(env, { now: START + 6 * DAY, fetch: instagram.fetch })).toBe("not-due");
    expect(await renewInstagramToken(env, { now: START + 7 * DAY, fetch: instagram.fetch })).toBe("renewed");
    expect(instagram.seen).toEqual(["from-bitwarden", "renewed-1"]);
    expect(await instagramToken(env)).toBe("renewed-2");
  });

  it("can't be read by anyone with the database but not the Worker's key", async () => {
    await renewInstagramToken(env, { now: START, fetch: fakeInstagram().fetch });
    const logs = captureLogs();
    expect(await instagramToken({ ...env, INSTAGRAM_TOKEN_KEY: OTHER_KEY })).toBe("from-bitwarden");
    expect(logs.entries.map((e) => e.msg)).toContain("instagram.token_unreadable");
  });

  it("is refused when its row has been tampered with or moved, and the Bitwarden one is used", async () => {
    await renewInstagramToken(env, { now: START, fetch: fakeInstagram().fetch });
    const { sealed } = env.DB.raw.prepare("SELECT sealed FROM sealed_tokens").get() as { sealed: string };
    const bytes = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 1;
    env.DB.raw.prepare("UPDATE sealed_tokens SET sealed = ?").run(btoa(String.fromCharCode(...bytes)));
    captureLogs();
    expect(await instagramToken(env)).toBe("from-bitwarden");

    // A good value sealed for another row doesn't open under this one: the row's name is sealed in
    env.DB.raw.prepare("UPDATE sealed_tokens SET sealed = ?").run(await seal("planted", KEY, "other"));
    expect(await instagramToken(env)).toBe("from-bitwarden");
  });

  it("raises an error when Instagram refuses to renew it, saying how long is left", async () => {
    await renewInstagramToken(env, { now: START, fetch: fakeInstagram().fetch });
    const logs = captureLogs();
    expect(await renewInstagramToken(env, { now: START + 50 * DAY, fetch: fakeInstagram("refused").fetch })).toBe(
      "failed",
    );
    const error = logs.entries.find((e) => e.level === "error");
    expect(error?.msg).toBe("instagram.token_renewal_failed");
    expect(error?.fields.daysLeft).toBe(10);
    expect(JSON.stringify(logs.entries)).not.toContain("renewed-1");
    expect(await instagramToken(env)).toBe("renewed-1");
  });

  it("is used as it is from Bitwarden, and never stored, without the Worker's key", async () => {
    const instagram = fakeInstagram();
    const keyless = { ...env, INSTAGRAM_TOKEN_KEY: undefined };
    expect(await renewInstagramToken(keyless, { now: START, fetch: instagram.fetch })).toBe("no-key");
    expect(instagram.fetch).not.toHaveBeenCalled();
    expect(await instagramToken(keyless)).toBe("from-bitwarden");
  });

  it("is nothing at all before the club has set one up", async () => {
    const none = { DB: env.DB, INSTAGRAM_TOKEN_KEY: KEY };
    expect(await instagramToken(none)).toBeNull();
    expect(await renewInstagramToken(none, { now: START, fetch: fakeInstagram().fetch })).toBe("no-token");
  });
});
