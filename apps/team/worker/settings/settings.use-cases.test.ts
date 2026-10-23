// How often live pages check for updates (ADR 0072): the game page while a game's on, the tournament's home, and the
// draft room. Each check is a request against the club's free daily allowance, so an admin sets it, and everyone's
// app follows. Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Mo Member", position: "G", rating: 55, email: "mo@example.com" },
];

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

describe("how often live pages check for updates", () => {
  it("is every 10 seconds to start with, and everyone's app is told", async () => {
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("GET", "/api/bootstrap")).body.settings).toEqual({ liveRefreshSeconds: 10, bank: null });
  });

  it("an admin changes it, and everyone's app follows", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("PUT", "/api/settings", { liveRefreshSeconds: 5 })).status).toBe(200);
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("GET", "/api/bootstrap")).body.settings).toEqual({ liveRefreshSeconds: 5, bank: null });
  });

  it("stays between 5 seconds and 2 minutes", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("PUT", "/api/settings", { liveRefreshSeconds: 1 })).status).toBe(400);
    expect((await dana.call("PUT", "/api/settings", { liveRefreshSeconds: 600 })).status).toBe(400);
  });
});
