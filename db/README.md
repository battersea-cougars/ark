# D1 database

One database, `cougars`, bound as `DB` in `apps/web/wrangler.jsonc`.

## Schema and seed (until launch)

Not live yet, so there are no migrations ([ADR 0050](../docs/adr/0050-schema-and-seed-until-launch.md)):

- `db/schema.sql` is the whole database: every table and index. Change it directly.
- `db/seed/club.sql` is what it starts with that isn't about anyone (roles, Friday Training, the Kumite series,
  quips): `INSERT OR IGNORE` by id, so it never overwrites what admins changed. People come from the roster
  ([seed/README.md](seed/README.md)).
- `scripts/db-rebuild.mjs` rebuilds a database from the schema **keeping its data**: rows are read out (and backed
  up to a private temp file), the tables are made again, the rows go back (new columns take their defaults), then
  the club seed tops up. Local: `npm run db:rebuild:local`. Dev: every deploy (`.github/workflows/deploy.yml`), or
  `node scripts/env-pull.mjs -- bash scripts/deploy-dev.sh`.
- `npm run seed:history` adds a made-up past to a local D1 (years of Kumites, a year of training, charges and payments,
  for its own members), marked so `npm run seed:history -- --remove` takes it all away; local only, main's shared D1
  only with `--shared` (docs/testing.md).
- Production starts fresh: schema, club seed, and a roster of just its admins, who bring the members in with Import
  members in the team app ([ADR 0050](../docs/adr/0050-schema-and-seed-until-launch.md)). It never rebuilds:
  `deploy.yml` refuses until launch.

## Launch: migrations from then on

In the change that first goes to `release`:

1. `node scripts/db-launch.mjs`: `schema.sql` and `seed/club.sql` become `migrations/0001_launch.sql` (identical:
   the same tables, indexes and seed rows), and the two files go.
2. Update this README and ADR 0050's History; commit; `git push origin main:release`. The deploy backs up, then
   applies the migrations (`scripts/db-migrate.mjs`): production's new database runs 0001; dev's, built before
   launch, already has its tables, so 0001 is marked as done there and only later ones run.
3. Your local database: `npm run db:migrate:local`, which does the same.

After that a change is a new file, `migrations/NNNN_what.sql`, additive only (new tables, new columns with a
default): `npx wrangler d1 migrations create DB what -c apps/web/wrangler.jsonc` makes it,
`npm run db:migrate:local` applies it locally, the tests pick it up, and the next deploy applies it.
`db-rebuild.mjs` refuses from then on.

## Backups

Every night (`.github/workflows/backup.yml`) and before a deploy changes the database (`deploy.yml`), it's exported,
sealed with the environment's `BACKUP_KEY` and kept 90 days as an artifact of that run
([ADR 0106](../docs/adr/0106-database-backups.md)). The team app's Usage page says when the last one was.

**Restore drill** (try it now and then): download the newest `d1-<environment>-…` artifact from Actions → Back up,
unzip it, then open it into a fresh SQLite file, which prints each table's rows:

    node scripts/env-pull.mjs -- node scripts/db-restore.mjs cougars-dev-….cgbk
    node scripts/env-pull.mjs --environment production -- node scripts/db-restore.mjs cougars-production-….cgbk

**Putting one back**: within 7 days, D1 Time Travel is quicker and exact (`wrangler d1 time-travel restore`, through
CI for production). Older than that, the restored file is the source: copy the rows you need back with SQL, or, to
replace the lot, `sqlite3 restored.sqlite .dump` into an empty database. Production is never touched by hand
([ADR 0010](../docs/adr/0010-environments-and-deploys.md)): do it from a workflow.

## Conventions

- `snake_case` tables and columns, plural table names.
- `INTEGER PRIMARY KEY AUTOINCREMENT` ids.
- Timestamps: ISO-8601 TEXT, `*_at` for instants (UTC, `Z`), `*_on` for dates (`YYYY-MM-DD`).
- Money: INTEGER pence, columns end in `_pence`.
- Booleans: INTEGER 0/1. Structured blobs: JSON in TEXT.
- Status columns are free TEXT documented in a comment (no CHECK constraints,
  so adding a status never needs a table rebuild).
- Index every column used in a WHERE or ORDER BY on a growing table.
- Free plan limits: 5 GB, 5M rows read/day, 100 bound parameters per query.
