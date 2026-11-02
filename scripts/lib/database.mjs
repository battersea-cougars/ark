// Where a fresh database comes from (ADR 0050): db/schema.sql and the club's seed until launch, then db/migrations/,
// every file in order (0001 is the schema and seed as they were at launch). The tests' in-memory D1 picks its files
// the same way (packages/shared/testing/d1-sqlite.ts).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DB = join(import.meta.dirname, "../../db");

/** The migrations, in order: none until launch. */
function migrations(db = DB) {
  const dir = join(db, "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

/** Launched: db/migrations/ is the database, and db-rebuild.mjs refuses. */
function launched(db = DB) {
  return migrations(db).length > 0;
}

/** The SQL files that make a fresh database, in order. */
export function databaseFiles(db = DB) {
  return launched(db) ? migrations(db) : [join(db, "schema.sql"), join(db, "seed/club.sql")];
}

/** The script that brings the local D1 up to date: rebuilt from the schema until launch, migrated after. */
export function localDatabaseScript(db = DB) {
  return join(import.meta.dirname, "..", launched(db) ? "db-migrate.mjs" : "db-rebuild.mjs");
}
