// The website's security headers per environment (ADR 0036): production's policy lets in no placeholder photos,
// dev's does, and the _headers file the build writes for prerendered pages says exactly what the live routes send.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHeadersFile } from "@cougars/shared/testing/headers-file";
import { csp, siteHeaders } from "./headers";
import { securityHeaders } from "./headers.integration";

const images = (policy: string) => policy.split("; ").find((d) => d.startsWith("img-src ")) ?? "";

/** The build's last step for this SITE_ENV, into a fresh folder: the _headers it wrote, read as Cloudflare does. */
function built(siteEnv: string | undefined, already?: string) {
  const dir = mkdtempSync(join(tmpdir(), "headers-"));
  try {
    if (already) writeFileSync(join(dir, "_headers"), already);
    vi.stubEnv("SITE_ENV", siteEnv);
    const hook = securityHeaders().hooks["astro:build:done"] as (o: object) => void;
    hook({ dir: pathToFileURL(`${dir}/`), logger: { info() {} } });
    return parseHeadersFile(readFileSync(join(dir, "_headers"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("the website's security headers", () => {
  it("in production let in no placeholder photos (picsum is dev's demo content)", () => {
    expect(csp("production")).not.toContain("picsum");
    expect(images(csp("production"))).toBe("img-src 'self' data: https://cdn.sanity.io https://i.ytimg.com");
  });

  it("on dev, PR previews and a laptop let in picsum's photos for the demo content", () => {
    expect(images(csp("dev"))).toContain("https://picsum.photos");
    expect(images(csp("dev"))).toContain("https://fastly.picsum.photos");
  });

  it("give no page, nor anything it frames, the camera, microphone or location (#81)", () => {
    for (const env of ["production", "dev"] as const)
      expect(siteHeaders(env)["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("differ between the two only in that", () => {
    expect(csp("dev").replace(" https://picsum.photos https://fastly.picsum.photos", "")).toBe(csp("production"));
  });

  it("are written into the build's _headers for production on release, for every page and file", () => {
    expect(built("production")).toEqual({ "/*": siteHeaders("production") });
  });

  it("are dev's in any other build (no SITE_ENV: a laptop)", () => {
    expect(built("dev")).toEqual({ "/*": siteHeaders("dev") });
    expect(built(undefined)).toEqual({ "/*": siteHeaders("dev") });
  });

  it("keep what the adapter wrote there first (the long Cache-Control on /_astro/*)", () => {
    const adapters = "/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n";
    expect(built("production", adapters)).toEqual({
      "/*": siteHeaders("production"),
      "/_astro/*": { "cache-control": "public, max-age=31536000, immutable" },
    });
  });
});
