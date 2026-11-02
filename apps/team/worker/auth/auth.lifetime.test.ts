import { describe, expect, it } from "vitest";
import { lastMomentOf } from "./auth";

// A sign-in's last moment (ADR 0023): the start of the last quarter within a year of signing in, midnight in London.
describe("when a sign-in ends however much it's used", () => {
  it("as the last quarter within its year starts, at midnight in London (BST in October)", () => {
    expect(new Date(lastMomentOf("2026-10-06T11:00:00Z")).toISOString()).toBe("2027-09-30T23:00:00.000Z");
  });

  it("at midnight GMT on 1 January", () => {
    expect(new Date(lastMomentOf("2026-02-14T09:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("signed in on a quarter's first day: a year to the day, from its midnight", () => {
    expect(new Date(lastMomentOf("2026-04-01T10:00:00Z")).toISOString()).toBe("2027-03-31T23:00:00.000Z");
  });

  it("never more than a year, and at least nine months", () => {
    for (let day = 0; day < 366; day += 7) {
      const signedIn = Date.UTC(2026, 0, 1) + day * 86_400_000;
      const end = lastMomentOf(new Date(signedIn).toISOString());
      expect(end - signedIn).toBeLessThanOrEqual(365 * 86_400_000);
      expect(end - signedIn).toBeGreaterThan(270 * 86_400_000);
    }
  });
});
