#!/usr/bin/env node
// Launch day for the database (ADR 0050): the schema and the club's seed become migration 0001, and every change after
// is a new migration, additive only. Run once, by hand, in the change that goes live; databases built before launch
// move across with `npm run db:migrate:local` (scripts/db-migrate.mjs).
//   node scripts/db-launch.mjs            then commit db/ and push `release` (deploy.yml applies the migrations)
//   --dir <path>   a copy of db/ to work on instead (for trying it)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const dir = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1] : join(import.meta.dirname, "../db");
const migrations = join(dir, "migrations");
if (existsSync(migrations) && readdirSync(migrations).some((f) => f.endsWith(".sql"))) {
  console.error(`${migrations} already has migrations: launched already.`);
  process.exit(1);
}

const schema = join(dir, "schema.sql");
const seed = join(dir, "seed/club.sql");
const day = new Date().toISOString().slice(0, 10);
mkdirSync(migrations, { recursive: true });
writeFileSync(
  join(migrations, "0001_launch.sql"),
  `-- The database at launch, ${day} (ADR 0050): what db/schema.sql and db/seed/club.sql were until then.\n` +
    `-- Never edit this file: change the database with a new migration, additive only.\n\n` +
    `${readFileSync(schema, "utf8").trim()}\n\n-- The club's seed\n${readFileSync(seed, "utf8").trim()}\n`,
);
rmSync(schema);
rmSync(seed);
console.log(`Wrote ${join(migrations, "0001_launch.sql")}; ${schema} and ${seed} are in it now, and gone.`);
console.log("Next: update db/README.md and ADR 0050's History, commit, then push release.");
