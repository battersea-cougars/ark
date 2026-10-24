// Dev tools (ADR 0027): outside production, an admin keeps a list of addresses that get their own email (a sign-in
// code, say), so they can sign in on dev without a deploy. Everyone else's email still goes to the safe inbox. In
// production there's no such thing. Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mailSetup } from "../auth/auth";
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

describe("who gets their own email outside production", () => {
  it("nobody to start with; the app knows Dev tools are there", async () => {
    const dana = await w.signedIn("dana@example.com");
    const boot = (await dana.call("GET", "/api/bootstrap")).body;
    expect(boot.devTools).toBe(true);
    expect((await dana.call("GET", "/api/dev/mail")).body).toEqual({ addresses: [] });
  });

  it("an admin adds and takes off addresses, and they're kept tidy", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/dev/mail", { email: " Mo@Example.com " })).status).toBe(200);
    expect((await dana.call("POST", "/api/dev/mail", { email: "mo@example.com" })).status).toBe(200);
    expect((await dana.call("GET", "/api/dev/mail")).body).toEqual({ addresses: ["mo@example.com"] });
    expect((await dana.call("POST", "/api/dev/mail", { email: "not an email" })).status).toBe(400);
    expect((await dana.call("DELETE", "/api/dev/mail", { email: "mo@example.com" })).status).toBe(200);
    expect((await dana.call("GET", "/api/dev/mail")).body).toEqual({ addresses: [] });
  });

  it("never the club's own inbox", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/dev/mail", { email: "club@example.com" })).status).toBe(400);
  });

  it("a member can't see or change it", async () => {
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("GET", "/api/bootstrap")).body.devTools).toBe(false);
    expect((await mo.call("POST", "/api/dev/mail", { email: "mo@example.com" })).status).toBe(403);
  });

  it("admins always get their own email here, so they can sign in and open Dev tools; the list adds anyone else", async () => {
    const dana = await w.signedIn("dana@example.com");
    const env = { ...w.env, SITE_ENV: "dev" };
    expect((await mailSetup(env)).allow).toEqual(["dana@example.com"]);
    await dana.call("POST", "/api/dev/mail", { email: "mo@example.com" });
    expect([...((await mailSetup(env)).allow ?? [])].sort()).toEqual(["dana@example.com", "mo@example.com"]);
    expect((await mailSetup({ ...w.env, SITE_ENV: "production" })).allow).toBeUndefined();
  });

  // The admins were found by the role's name, so a custom role that can do everything, or a renamed Admin, got
  // nothing here and couldn't sign in by email code (#44)
  it("anyone whose role can do everything gets their own email here, whatever the role is called (#44)", async () => {
    const dana = await w.signedIn("dana@example.com");
    const env = { ...w.env, SITE_ENV: "dev" };
    expect(
      (await dana.call("POST", "/api/roles", { name: "Boss", description: "", actions: ["manage:all"] })).status,
    ).toBe(201);
    const mo = (await dana.call("GET", "/api/bootstrap")).body.members.find(
      (m: { name: string }) => m.name === "Mo Member",
    );
    expect((await dana.call("PUT", `/api/members/${mo.id}`, { ...mo, roles: ["Boss", "Member"] })).status).toBe(200);
    expect([...((await mailSetup(env)).allow ?? [])].sort()).toEqual(["dana@example.com", "mo@example.com"]);
  });

  it("doesn't exist in production", async () => {
    const dana = await w.signedIn("dana@example.com");
    w.env.SITE_ENV = "production";
    expect((await dana.call("GET", "/api/bootstrap")).body.devTools).toBe(false);
    expect((await dana.call("GET", "/api/dev/mail")).status).toBe(404);
    expect((await dana.call("POST", "/api/dev/mail", { email: "mo@example.com" })).status).toBe(404);
  });

  // Dev tools were hidden only where SITE_ENV said production, which wrangler.jsonc doesn't set: a deploy that skipped
  // scripts/ci/target.mjs would have shown them (#81). Now they're there only where it says dev, or on your own machine.
  it("doesn't exist on a deploy that never said where it is", async () => {
    const dana = await w.signedIn("dana@example.com");
    w.env.TEAM_ENV = undefined;
    expect((await dana.call("GET", "/api/bootstrap")).body.devTools).toBe(false);
    expect((await dana.call("GET", "/api/dev/mail")).status).toBe(404);
    w.env.SITE_ENV = "dev";
    expect((await dana.call("GET", "/api/bootstrap")).body.devTools).toBe(true);
  });
});
