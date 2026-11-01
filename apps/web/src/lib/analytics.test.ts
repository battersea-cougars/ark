// Cloudflare Web Analytics on the website only (#92): the beacon is in the website's own pages, so turning off
// Cloudflare's automatic setup keeps it off the team app (team.batterseacougars.com), whose CSP refuses it.
import { describe, expect, it } from "vitest";
import { analyticsBeacon } from "./analytics";
import { csp } from "./server/headers";

/** A made-up token, the shape of Cloudflare's (32 hex). */
const TOKEN = "f".repeat(32);

describe("the website's page views are counted, and nothing else's", () => {
  it("a production page loads Cloudflare's beacon with the site's public token", () => {
    const beacon = analyticsBeacon("production", TOKEN);
    expect(beacon).toEqual({
      src: "https://static.cloudflareinsights.com/beacon.min.js",
      config: JSON.stringify({ token: TOKEN }),
    });
  });

  it("and the website's CSP lets it load and report", () => {
    const policy = csp("production");
    expect(policy).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
    expect(policy).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/);
  });

  it("dev, a laptop and PR previews count nothing: no beacon", () => {
    expect(analyticsBeacon("dev", TOKEN)).toBeNull();
  });

  it("before the token is set (automatic setup still on), the page adds none of its own, so nothing counts twice", () => {
    expect(analyticsBeacon("production", undefined)).toBeNull();
    expect(analyticsBeacon("production", "")).toBeNull();
  });

  it("a token that isn't one is left out, so nothing odd lands in the page", () => {
    expect(analyticsBeacon("production", `x"}'><script>`)).toBeNull();
  });
});
