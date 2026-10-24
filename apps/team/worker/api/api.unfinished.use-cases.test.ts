// Screens whose backend isn't built yet (Upload) run on demo data. They show on dev and
// locally, so they can be tried, and are hidden in production so members never see made-up amounts (#63).
// Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [{ name: "Mo Member", position: "F", rating: 55, email: "mo@example.com" }];

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

describe("unfinished screens", () => {
  it("a member on dev is told they're there to try", async () => {
    w.env.SITE_ENV = "dev";
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.club()).body.unfinished).toBe(true);
  });

  it("a member in production isn't", async () => {
    w.env.SITE_ENV = "production";
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.club()).body.unfinished).toBe(false);
  });
});
