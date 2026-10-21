import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A date's text in a locale's own order isn't the same in every browser: en-CA reads 2026-10-21 in Chrome and Node
// but 10/21/2026 in Safari's WebKit, so turning it back into a date broke Home on iPhones. Dates as data are built
// from their parts (packages/shared/london.ts londonDate); a locale is only for words people read.
const roots = ["apps/team/src", "apps/team/worker", "apps/web/src", "packages/shared"].map(
  (dir) => new URL(`../${dir}/`, import.meta.url).pathname,
);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(svelte|ts|astro)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("dates as data", () => {
  it("are never read out of a locale's own order (en-CA, sv-SE and the like)", () => {
    const offenders = roots
      .flatMap(sourceFiles)
      .filter((file) => /Intl\.DateTimeFormat\(\s*["'](en-CA|sv-SE|fr-CA|lt-LT)["']/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
