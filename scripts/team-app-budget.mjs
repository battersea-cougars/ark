#!/usr/bin/env node
// The team app's first-paint budget (ADR 0120): the JavaScript a phone loads before Home can paint, gzipped. That is
// the entry and everything it imports statically, as the build's manifest lists it (apps/team/dist/client/.vite):
// Vite preloads exactly those files. Pages opened later, Sentry and the sign-in screen are import()s, so they're not
// counted. Run after every team build (apps/team package.json "build"), so CI's build fails when it's over.
//
//   node scripts/team-app-budget.mjs
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

/**
 * 76 kB when it was set (2026-10-21) at 100; 105 from 2026-10-28, when a deploy's build came out at 100.1 kB (about
 * 0.4 kB more than the same code built locally) and the user had settled on no more trimming before launch (#180).
 */
const BUDGET_KB = 105;

const client = new URL("../apps/team/dist/client/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL(".vite/manifest.json", client), "utf8"));

const files = new Set();
const follow = (key) => {
  const chunk = manifest[key];
  if (files.has(chunk.file)) return;
  files.add(chunk.file);
  for (const imported of chunk.imports ?? []) follow(imported);
};
for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) follow(key);

const kb = [...files].reduce((sum, file) => sum + gzipSync(readFileSync(new URL(file, client))).length, 0) / 1024;
const line = `team app first paint: ${files.size} files, ${kb.toFixed(1)} kB of JavaScript gzipped (budget ${BUDGET_KB} kB)`;
if (kb > BUDGET_KB) {
  console.error(
    `${line}: over. Load what Home doesn't need at once with import(), or raise the budget in scripts/team-app-budget.mjs (ADR 0120).`,
  );
  process.exit(1);
}
console.log(line);
