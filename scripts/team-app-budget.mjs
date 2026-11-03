#!/usr/bin/env node
// The team app's first-paint budget (ADR 0053): the gzipped JavaScript a phone loads before Home can paint, which is
// the entry and everything it imports statically, as the build's manifest lists it. Run after every team build, so
// CI's build fails when it's over.
//
//   node scripts/team-app-budget.mjs
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

/** Gzipped kB, with room for a deploy's build, which comes out about 0.4 kB bigger than the same code built locally. */
const BUDGET_KB = 105;

const client = new URL("../apps/team/dist/client/", import.meta.url);
// Vite preloads exactly the static imports; later pages, Sentry and the sign-in screen are import()s, not counted
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
    `${line}: over. Load what Home doesn't need at once with import(), or raise the budget in scripts/team-app-budget.mjs (ADR 0053).`,
  );
  process.exit(1);
}
console.log(line);
