// Links to the team app open the store app (ADR 0108): an email's "Open the app" lands on its page in the app, not
// in Safari. The phone checks the team app's own address for the app it trusts with those links.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker from "../index";
import { testWorld } from "../testing";

const open = async (path: string, vars: Record<string, string> = {}) => {
  const w = testWorld([]);
  return worker.fetch(
    new Request(`https://team.batterseacougars.com${path}`),
    { ...w.env, ...vars, ASSETS: { fetch: async () => new Response("<!doctype html>") } as unknown as Fetcher },
    { waitUntil: () => {} } as unknown as ExecutionContext,
  );
};

describe("the store app's links", () => {
  it("an iPhone finds the app it trusts with the team app's links, every path", async () => {
    const res = await open("/.well-known/apple-app-site-association", { APPLE_TEAM_ID: "ABCDE12345" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      applinks: { details: [{ appIDs: ["ABCDE12345.com.batterseacougars.team"], components: [{ "/": "/*" }] }] },
      webcredentials: { apps: ["ABCDE12345.com.batterseacougars.team"] },
    });
  });

  it("isn't there before the app is set up", async () => {
    expect((await open("/.well-known/apple-app-site-association")).status).toBe(404);
  });

  it("the app may use the team app's passkeys on both its domains, as it opens their links (ADR 0023)", () => {
    const entitlements = readFileSync(new URL("../../ios/App/App/App.entitlements", import.meta.url).pathname, "utf8");
    const domains = (service: string) =>
      [...entitlements.matchAll(new RegExp(`<string>${service}:([^<]+)</string>`, "g"))].map((m) => m[1]).sort();
    expect(domains("applinks")).toEqual(["team.batterseacougars.com", "team.cougars-dev.workers.dev"]);
    expect(domains("webcredentials")).toEqual(domains("applinks"));
  });
});
