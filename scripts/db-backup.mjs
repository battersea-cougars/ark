#!/usr/bin/env node
// Back up a D1 database (ADR 0050): export it, seal it with the environment's BACKUP_KEY (scripts/lib/backup.mjs), and
// note when in the database itself, for the team app's Usage page. CI runs it nightly (.github/workflows/backup.yml)
// and before anything changes the schema (deploy.yml's `database` job), and keeps the file as an artifact.
//   node scripts/db-backup.mjs --remote -c dist/d1/wrangler.json --why nightly --out backups   (CI)
//   node scripts/env-pull.mjs -- node scripts/db-backup.mjs --local --why drill                (your local D1)
// The plain export is personal data: it's written to a private temp folder and deleted once sealed.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "./lib/backup.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const remote = argv.includes("--remote");
if (remote === argv.includes("--local")) {
  console.error("Usage: db-backup.mjs --local | --remote -c <wrangler config> [--why nightly] [--out dir]");
  process.exit(2);
}
const config = opt("-c", join(import.meta.dirname, "../apps/web/wrangler.jsonc"));
const why = opt("--why", "by hand");
const out = opt("--out", "backups");
const environment = process.env.SITE_ENV ?? (remote ? "dev" : "local");

function wrangler(args) {
  const res = spawnSync("npx", ["wrangler", "d1", ...args, "DB", remote ? "--remote" : "--local", "-c", config], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
  return res.stdout;
}

const takenAt = new Date().toISOString();
const temp = mkdtempSync(join(tmpdir(), "d1-backup-"));
try {
  const plain = join(temp, "export.sql");
  wrangler(["export", "--output", plain]);
  const sealed = seal(readFileSync(plain, "utf8"), process.env.BACKUP_KEY);
  mkdirSync(out, { recursive: true });
  const file = join(out, `cougars-${environment}-${takenAt.replace(/[:.]/g, "-")}.cgbk`);
  writeFileSync(file, sealed);
  console.log(`Backed up ${environment} (${why}): ${file}, ${Math.round(sealed.length / 1024)} KB sealed.`);
  // When, and why, for the Usage page; after the export, so it's in the next one. A brand-new database has no table
  // for it yet: the first deploy makes it.
  const has = JSON.parse(
    wrangler([
      "execute",
      "--json",
      "--command",
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'backups'",
    ]),
  );
  if (has[0]?.results?.length) {
    const quoted = why.replace(/'/g, "''");
    const sql = `INSERT INTO backups (taken_at, why, bytes) VALUES ('${takenAt}', '${quoted}', ${sealed.length})`;
    wrangler(["execute", "--yes", "--command", sql]);
  } else console.log("Not noted in the database: it has no backups table yet.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
