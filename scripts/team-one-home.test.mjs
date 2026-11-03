import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// One home for each look and word in the team app (ADR 0065): a thing that's written once in lib/ isn't written
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

// The worker's emails greet members by name too, so it's read as well ("../worker/…" from src)
const files = [...sourceFiles(src), ...sourceFiles(join(src, "../worker"))].map((path) => ({
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
  {
    what: 'a first name by hand, `name.split(" ")[0]` (lib/names.ts shortName keeps a chosen name whole)',
    pattern: /(?:(?<![.\w])name|(?<!form)\.name|nameOf\([^)]*\)|goesBy\w*\([^)]*\)|webName[^\n]*\))\.split\((?:" "|\/\\s\+\/)\)\[0\]/,
    home: "lib/names.ts",
  },
  {
    what: "a Manage row of its own, `class=\"tool\"` (lib/ManageList: disabled, here, now, armed, notes)",
    pattern: /class="tool[\s"]/,
    home: "lib/ManageList.svelte",
  },
  {
    what: "a tap-twice of its own (lib/arm.svelte.ts Arm)",
    pattern: /let (?:arming|sure|confirming) = \$state<[^>]*(?:string|"|null)/,
    home: "lib/arm.svelte.ts",
  },
  {
    what: "a red yes by hand, `class=\"btn danger\"` (lib/Confirm; an editor's foot: SaveBar, the tournament's Delete)",
    pattern: /class="btn danger/,
    home: "lib/Confirm.svelte",
    allow: ["lib/SaveBar.svelte", "lib/TournamentEditorPanel.svelte"],
  },
  {
    what: "a red fill of its own for a button (app.css .btn.danger)",
    pattern: /background: var\(--red\);\s*color: var\(--on-red\);\s*\}\s*[^{}]*:hover[^{]*\{\s*background: var\(--red-hot\)/,
    home: "app.css",
  },
  {
    what: "a tournament's table, points or final worked out by hand (lib/fixtures.ts recordsOf, groupTableOf, finalOf)",
    pattern: /win: \w+\.pointsWin|b\.position > a\.position|seed \? ordinal\(seed\)/,
    home: "lib/fixtures.ts",
  },
  {
    what: "a member looked up by hand, `PLAYERS.find(…)` (demo/data.ts playerOf)",
    pattern: /PLAYERS\.find\(/,
    home: "demo/data.ts",
  },
  {
    what: "the worn-ink noise copied into a component (app.css --ink-worn)",
    pattern: /width='140' height='70'%3E%3Cfilter/,
    home: "app.css",
  },
  {
    what: "a component's own copy of one of app.css's keyframes (pulse, rise, menu-in, fade-in, fade-out)",
    pattern: /@keyframes (?:pulse|rise|menu-in|fade-in|fade-out) \{/,
    home: "app.css",
  },
];

describe("the team app keeps one home for each look and word", () => {
  for (const rule of RULES) {
    it(`has no ${rule.what}`, () => {
      const hits = files
        .filter((f) => f.path !== rule.home && !rule.allow?.includes(f.path) && (!rule.only || rule.only.test(f.path)))
        .filter((f) => rule.pattern.test(f.code))
        .map((f) => f.path);
      expect(hits, `use the one in ${rule.home}`).toEqual([]);
    });
  }
});
