import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clubContact, clubContactFake } from "./club-contact";

// The network boundary: Sanity's API CDN, answering for the club's contact email
const sanity = (result: unknown, ok = true) =>
  vi.fn(async () => (ok ? Response.json({ result }) : Promise.reject(new Error("down")))) as unknown as typeof fetch;

describe("clubContact", () => {
  let fake: string | null | undefined;
  beforeEach(() => ([fake, clubContactFake.value] = [clubContactFake.value, undefined]));
  afterEach(() => (clubContactFake.value = fake));

  it("reads the Studio's Club → Contact email from the environment's project, tidied", async () => {
    const fetch = sanity(" Club@Example.org ");
    expect(await clubContact("production", { fetch, now: 1 })).toBe("club@example.org");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/^https:\/\/ah165efl\.apicdn\.sanity\.io\//);
  });

  it("asks again only after five minutes, and keeps the last answer while Sanity is down", async () => {
    const t = 10_000_000;
    expect(await clubContact("dev", { fetch: sanity("a@example.org"), now: t })).toBe("a@example.org");
    const quiet = sanity("b@example.org");
    expect(await clubContact("dev", { fetch: quiet, now: t + 60_000 })).toBe("a@example.org");
    expect(quiet).not.toHaveBeenCalled();
    expect(await clubContact("dev", { fetch: sanity(null, false), now: t + 6 * 60_000 })).toBe("a@example.org");
  });

  it("is null when the Studio has no address", async () => {
    expect(await clubContact("production", { fetch: sanity(null), now: 99_000_000 })).toBeNull();
  });
});
