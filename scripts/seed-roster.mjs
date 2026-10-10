#!/usr/bin/env node
// Seed the team roster into D1 (db/seed/README.md). Adds players who aren't there yet; never changes or removes
// anyone, so it's safe on every deploy. The roster is personal data and never committed: it comes from
// TEAM_ROSTER (Bitwarden, loaded into CI) or, locally, db/seed/roster.local.json.
//   node scripts/seed-roster.mjs --local                              (local D1, from the local file)
//   node scripts/seed-roster.mjs --remote -c dist/server/wrangler.json (CI, from TEAM_ROSTER)
// --anonymous (dev and local): everyone but the admins under made-up names (scripts/lib/anonymize.mjs, ADR 0029)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anonymizeRoster } from "./lib/anonymize.mjs";
import { parseRoster, rosterSql } from "./lib/roster.mjs";

const argv = process.argv.slice(2);
const remote = argv.includes("--remote");
if (remote === argv.includes("--local")) {
  console.error("Usage: seed-roster.mjs --local | --remote -c <wrangler config>");
  process.exit(2);
}
const config = argv.includes("-c")
  ? argv[argv.indexOf("-c") + 1]
  : join(import.meta.dirname, "../apps/web/wrangler.jsonc");
const localFile = join(import.meta.dirname, "../db/seed/roster.local.json");

const text =
  process.env.TEAM_ROSTER ?? (remote ? null : existsSync(localFile) ? readFileSync(localFile, "utf8") : null);
if (!text) {
  console.log(
    `No roster (${remote ? "TEAM_ROSTER isn't in Secrets Manager" : "no db/seed/roster.local.json"}): skipped.`,
  );
  process.exit(0);
}

const parsed = parseRoster(text);
const players = argv.includes("--anonymous") ? anonymizeRoster(parsed) : parsed;
// The SQL holds names, so it goes in a private temp folder that's removed straight after.
const dir = mkdtempSync(join(tmpdir(), "roster-"));
const file = join(dir, "roster.sql");
try {
  writeFileSync(file, rosterSql(players), { mode: 0o600 });
  const res = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", remote ? "--remote" : "--local", "-c", config, "--file", file, "--yes"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
  console.log(`Roster checked: ${players.length} players (new ones added, existing ones left as they are).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
