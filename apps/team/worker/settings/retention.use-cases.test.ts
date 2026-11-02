// The club keeps sign-in records no longer than it needs them (ADR 0029): a sign-in code 30 days, a signed-out or
// expired session 30 days after it ended, the audit log 2 years. The hourly cron forgets the rest; the privacy notice
// says the same. Real handlers, the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { forgetOld } from "./retention";

const ROSTER = [{ name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] }];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const count = (table: string) => (w.db.raw.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;

describe("the hourly cron forgets what the club no longer needs", () => {
  it("sign-in codes after 30 days", async () => {
    await w.ask(w.browser(), "dana@example.com");
    await forgetOld(w.db, days(29));
    expect(count("login_challenges")).toBe(1);
    await forgetOld(w.db, days(31));
    expect(count("login_challenges")).toBe(0);
  });

  it("a session 30 days after it ended, never one still in use", async () => {
    const out = await w.signedIn("dana@example.com");
    await w.signedIn("dana@example.com");
    await out.call("POST", "/api/auth/sign-out");
    await forgetOld(w.db, days(31));
    // The signed-out one is gone; the other is still signed in, whatever its age
    expect(count("auth_sessions")).toBe(1);
    expect(w.db.raw.prepare("SELECT revoked_at FROM auth_sessions").get()).toEqual({ revoked_at: null });
  });

  it("an expired session 30 days after it expired", async () => {
    await w.signedIn("dana@example.com");
    const { expires_at } = w.db.raw.prepare("SELECT expires_at FROM auth_sessions").get() as { expires_at: string };
    const expired = new Date(Date.parse(expires_at));
    await forgetOld(w.db, new Date(expired.getTime() + 29 * 86_400_000));
    expect(count("auth_sessions")).toBe(1);
    await forgetOld(w.db, new Date(expired.getTime() + 31 * 86_400_000));
    expect(count("auth_sessions")).toBe(0);
  });

  it("audit entries after 2 years", async () => {
    await w.signedIn("dana@example.com");
    const before = count("audit_log");
    expect(before).toBeGreaterThan(0);
    await forgetOld(w.db, days(365 * 2 - 1));
    expect(count("audit_log")).toBe(before);
    await forgetOld(w.db, days(365 * 2 + 1));
    expect(count("audit_log")).toBe(0);
  });
});
