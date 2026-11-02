#!/usr/bin/env node
// Open a database backup into a fresh SQLite file and say what's in it (ADR 0050): the restore drill, and the first
// step of a real restore. It never writes to a D1 database; see ADR 0050 for putting one back.
//   node scripts/env-pull.mjs -- node scripts/db-restore.mjs backups/cougars-dev-….cgbk          (dev's key)
//   node scripts/env-pull.mjs --environment production -- node scripts/db-restore.mjs FILE --out restored.sqlite
// The restored file is personal data: by default it goes in a private temp folder, never the repo.
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "./lib/backup.mjs";

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
if (!file) {
  console.error("Usage: db-restore.mjs <backup.cgbk> [--out restored.sqlite]");
  process.exit(2);
}
const out = argv.includes("--out")
  ? argv[argv.indexOf("--out") + 1]
  : join(mkdtempSync(join(tmpdir(), "d1-restore-")), "restored.sqlite");
if (existsSync(out)) throw new Error(`${out} is already there: a restore goes into a fresh database.`);

const sql = open(readFileSync(file), process.env.BACKUP_KEY);
const db = new Database(out);
// An export makes tables in its own order, rows and all, so a member can arrive before their role's table does. As a
// D1 import, keys are checked once everything's in (below), not row by row.
db.pragma("foreign_keys = OFF");
db.exec(sql);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
  .all()
  .map(({ name }) => [name, db.prepare(`SELECT count(*) n FROM "${name}"`).get().n]);
const check = db.prepare("PRAGMA foreign_key_check").all();
db.close();

for (const [name, n] of tables) console.log(`${String(n).padStart(7)}  ${name}`);
console.log(`\nRestored ${tables.length} tables into ${out}.`);
if (check.length) {
  console.error(`${check.length} rows point at something that isn't there (PRAGMA foreign_key_check).`);
  process.exit(1);
}
