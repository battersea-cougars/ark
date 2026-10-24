import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// One home for each look and word in the team app (#153, ADR 0065): a thing that's written once in lib/ isn't written
// again by hand in a page, or the copies drift (a "21th", a confirm with no red, a picker opening behind a sheet).
// Each rule is a cheap grep over the app's source; a hit names the file and where the one copy lives.
const src = new URL("../apps/team/src/", import.meta.url).pathname;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(svelte|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path] : [];
  });
}

const files = sourceFiles(src).map((path) => ({
  path: relative(src, path),
  code: readFileSync(path, "utf8"),
}));

const RULES = [
  {
    what: "an ordinal's suffix by hand (lib/dates.ts ordinal)",
    pattern: /["'](?:st|nd|rd)["']\s*[:,\]]|: ["']th["']/,
    home: "lib/dates.ts",
  },
  {
    what: 'a plural by hand, `n === 1 ? "" : "s"` (lib/dates.ts plural)',
    pattern: /===?\s*1\s*\?\s*["']["']\s*:\s*["']s["']/,
    home: "lib/dates.ts",
  },
  {
    what: "a portal of its own (lib/overlay.ts portal moves into an open dialog, not behind it)",
    pattern: /function portal\s*\(/,
    home: "lib/overlay.ts",
  },
  {
    what: "a red confirm of its own: `.delete` (app.css .btn.danger)",
    pattern: /^\s*\.delete\b[^(]*[{,]|class="btn[^"]*\bdelete\b/m,
    home: "app.css",
  },
  {
    what: "a date or time formatted in a component (lib/dates.ts)",
    pattern: /toLocaleDateString|toLocaleTimeString|new Intl\.DateTimeFormat/,
    only: /\.svelte$/,
    home: "lib/dates.ts",
  },
  {
    what: "a Sheet on a phone and a Drawer on a desktop by hand (lib/Drawer `short`, lib/ManageMenu)",
    pattern: /<Sheet[^>]*>\s*(?:<ManageList|\{@render (?:ask|body|toolList|manageTools|kindList)\(\)\})/,
    home: "lib/Drawer.svelte",
  },
];

describe("the team app keeps one home for each look and word", () => {
  for (const rule of RULES) {
    it(`has no ${rule.what}`, () => {
      const hits = files
        .filter((f) => f.path !== rule.home && (!rule.only || rule.only.test(f.path)))
        .filter((f) => rule.pattern.test(f.code))
        .map((f) => f.path);
      expect(hits, `use the one in ${rule.home}`).toEqual([]);
    });
  }
});
