// A new worktree is ready at once: main's node_modules hard-linked, without the caches other runs rewrite in place
// (ADR 0115). Its apps run on ports free right then; the user's ports belong to the show switch.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freePorts, linkNodeModules, publicPorts, skipEntry } from "./worktrees.mjs";

const made = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrees-"));
  made.push(dir);
  return dir;
};
afterEach(() => made.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("linking main's node_modules", () => {
  it("leaves out the caches (Vite, Astro, miniflare, the dev server's pid file), keeps npm's own files", () => {
    for (const cache of [".vite", ".vite-dev", ".vite-temp", ".astro", ".mf", ".cache", ".sanity"])
      expect(skipEntry(cache), cache).toBe(true);
    for (const kept of [".bin", ".package-lock.json", "vite", "@cougars"]) expect(skipEntry(kept), kept).toBe(false);
  });

  it("links the root's and each workspace's packages, nothing else", () => {
    const main = temp();
    writeFileSync(join(main, "package.json"), JSON.stringify({ workspaces: ["apps/web", "apps/team"] }));
    for (const dir of [
      "node_modules/vite",
      "node_modules/.vite",
      "apps/web/node_modules/.vite-dev",
      "apps/web/node_modules/sharp",
    ])
      mkdirSync(join(main, dir), { recursive: true });
    const linked = [];
    linkNodeModules(main, temp(), (source) => linked.push(source.slice(main.length + 1)));
    expect(linked.sort()).toEqual(["apps/web/node_modules/sharp", "node_modules/vite"]);
  });

  it("tries an entry twice, then names every one that failed", () => {
    const main = temp();
    writeFileSync(join(main, "package.json"), "{}");
    mkdirSync(join(main, "node_modules", "astro"), { recursive: true });
    mkdirSync(join(main, "node_modules", "vite"), { recursive: true });
    let tries = 0;
    const flaky = (source) => {
      if (source.endsWith("vite") && tries++ === 0) throw new Error("busy");
      if (source.endsWith("astro")) throw new Error("gone");
    };
    expect(() => linkNodeModules(main, temp(), flaky)).toThrow(/node_modules\/astro: gone/);
    expect(tries).toBe(2);
  });
});

describe("ports", () => {
  it("are the user's well-known ones, unless a test supervisor asks for others", () => {
    expect(publicPorts({})).toEqual({ web: 4500, team: 4510, studio: 4520 });
    expect(publicPorts({ COUGARS_APP_PORTS: "4590,4591,4592" })).toEqual({ web: 4590, team: 4591, studio: 4592 });
    expect(() => publicPorts({ COUGARS_APP_PORTS: "4590" })).toThrow(/3 ports/);
  });

  it("for each app are free and distinct", async () => {
    const ports = await freePorts(3);
    expect(new Set(ports).size).toBe(3);
    for (const p of ports) expect(p).toBeGreaterThan(1024);
  });
});
