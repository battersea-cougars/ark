#!/usr/bin/env node
// Rebuild a D1 database from db/schema.sql, keeping its data (ADR 0050). Not live yet, so there are no migrations:
// change the schema, then run this on local and dev. Every row is read out, the tables are made again from the
// schema, the rows go back (a new column takes its default; a column that's gone is dropped, and said so), and the
// club's seed (db/seed/club.sql) fills in anything missing. The roster is separate: scripts/seed-roster.mjs.
//   node scripts/db-rebuild.mjs --local                                (local D1, apps/web/.wrangler)
//   node scripts/db-rebuild.mjs --remote -c dist/server/wrangler.json  (CI: the built config names the database)
//   node scripts/env-pull.mjs -- node scripts/db-rebuild.mjs --remote --name cougars-dev   (dev, by hand)
// The rows are personal data: the backup goes in a private temp folder, never the repo, and its path is printed.
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// After launch the database changes by migrations only, and a rebuild would rewrite live members' rows (ADR 0050)
const migrations = join(import.meta.dirname, "../db/migrations");
if (existsSync(migrations) && readdirSync(migrations).some((f) => f.endsWith(".sql"))) {
  console.error("Launched: db/migrations/ is the database now. Add a migration; don't rebuild (db/README.md).");
  process.exit(1);
}

const argv = process.argv.slice(2);
const remote = argv.includes("--remote");
if (remote === argv.includes("--local")) {
  console.error("Usage: db-rebuild.mjs --local | --remote -c <wrangler config>");
  process.exit(2);
}
const config = argv.includes("-c")
  ? argv[argv.indexOf("-c") + 1]
  : join(import.meta.dirname, "../apps/web/wrangler.jsonc");
// A database by name instead of the config's DB binding
const name = argv.includes("--name") ? argv[argv.indexOf("--name") + 1] : "DB";
const schema = readFileSync(join(import.meta.dirname, "../db/schema.sql"), "utf8");
const seed = readFileSync(join(import.meta.dirname, "../db/seed/club.sql"), "utf8");

function d1(args) {
  const res = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", name, remote ? "--remote" : "--local", "-c", config, "--yes", ...args],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
  return res.stdout;
}
const query = (sql) => JSON.parse(d1(["--json", "--command", sql]));

// The schema's tables and columns, from an empty copy of it, parents before the tables that point at them
const empty = new Database(":memory:");
empty.exec(schema);
const info = (name) => empty.prepare(`PRAGMA table_info("${name}")`).all();
const names = empty
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map(({ name }) => name);
const columns = new Map(names.map((name) => [name, info(name).map((c) => c.name)]));
// The columns a row must bring: NOT NULL with no default (a key it can't make up: not the rowid's)
const required = new Map(
  names.map((name) => [
    name,
    info(name)
      .filter((c) => c.notnull && c.dflt_value === null && !(c.pk && c.type.toUpperCase() === "INTEGER"))
      .map((c) => c.name),
  ]),
);
const order = [];
const visit = (table, seen = new Set()) => {
  if (order.includes(table) || seen.has(table)) return;
  seen.add(table);
  for (const fk of empty.prepare(`PRAGMA foreign_key_list("${table}")`).all())
    if (fk.table !== table) visit(fk.table, seen);
  order.push(table);
};
for (const table of columns.keys()) visit(table);

// What's there now: our tables, not SQLite's, D1's or the old migrations' bookkeeping
const [{ results: present }] = query(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
);
const tables = present.map((t) => t.name);
const ours = tables.filter((t) => t !== "d1_migrations");
const rows = Object.fromEntries(
  ours.length ? query(ours.map((t) => `SELECT * FROM "${t}"`).join("; ")).map((r, i) => [ours[i], r.results]) : [],
);

const dir = mkdtempSync(join(tmpdir(), "db-rebuild-"));
writeFileSync(join(dir, "backup.json"), JSON.stringify(rows), { mode: 0o600 });
console.log(`Backed up ${ours.length} tables to ${join(dir, "backup.json")}`);

const literal = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const sql = ["PRAGMA defer_foreign_keys = true;"];
// Children first, so nothing cascades into a table that's still to be read back
for (const t of [...tables].reverse()) sql.push(`DROP TABLE IF EXISTS "${t}";`);
sql.push(schema);
for (const table of order) {
  const list = rows[table] ?? [];
  if (!list.length) continue;
  const keep = Object.keys(list[0]).filter((c) => columns.get(table).includes(c));
  const gone = Object.keys(list[0]).filter((c) => !keep.includes(c));
  if (gone.length) console.log(`${table}: dropping ${gone.join(", ")} (not in the schema)`);
  // A column the schema now requires that the old rows don't have: they can't be read back (an outbox's pending rows
  // after its shape changed), so they go, said out loud, rather than the whole rebuild failing
  const missing = required.get(table).filter((c) => !keep.includes(c));
  if (missing.length) {
    console.log(`${table}: ${list.length} rows not kept (the schema now requires ${missing.join(", ")})`);
    continue;
  }
  for (const r of list)
    sql.push(`INSERT INTO "${table}" (${keep.join(", ")}) VALUES (${keep.map((c) => literal(r[c])).join(", ")});`);
}
for (const t of Object.keys(rows)) if (!columns.has(t)) console.log(`${t}: dropped (not in the schema)`);
sql.push(seed);

const file = join(dir, "rebuild.sql");
writeFileSync(file, sql.join("\n"), { mode: 0o600 });
d1(["--file", file]);
const kept = order
  .filter((t) => required.get(t).every((c) => !rows[t]?.length || c in rows[t][0]))
  .reduce((n, t) => n + (rows[t]?.length ?? 0), 0);
console.log(`Rebuilt from db/schema.sql: ${kept} rows kept, club seed topped up.`);
