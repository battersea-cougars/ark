# D1 database

One database, `cougars`, bound as `DB` in `apps/web/wrangler.jsonc`.

## Schema and seed (until launch)

Not live yet, so there are no migrations ([ADR 0050](../docs/adr/0050-schema-and-seed-until-launch.md)):

- `db/schema.sql` is the whole database: every table and index, each table's comment saying what it's for, which
  code owns it and its ADR. Change it directly.
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
([ADR 0050](../docs/adr/0050-schema-and-seed-until-launch.md)). The team app's Usage page says when the last one was.

**Restore drill** (try it now and then): download the newest `d1-<environment>-…` artifact from Actions → Back up,
unzip it, then open it into a fresh SQLite file, which prints each table's rows:

    node scripts/env-pull.mjs -- node scripts/db-restore.mjs cougars-dev-….cgbk
    node scripts/env-pull.mjs --environment production -- node scripts/db-restore.mjs cougars-production-….cgbk

### Putting one back

Production is never touched by hand ([ADR 0010](../docs/adr/0010-environments-and-deploys.md)): a restore goes
through a workflow, with the owner's yes.

**Within 7 days** (D1 Time Travel on the free plan): Actions → _Restore the database_
(`.github/workflows/restore-db.yml`), on `release` for production, on `main` for dev:

    gh workflow run restore-db.yml --ref release -f to=2026-11-02T09:30:00Z -f reason="bad import"

- `to` is a moment in UTC (RFC 3339, or Unix seconds) or a Time Travel bookmark. A time outside the window stops the
  run before anything changes.
- It backs up first (artifact `d1-<environment>-before-restore-<run id>`, 90 days), then puts back the whole
  database, schema and all: everything written since that moment goes, the backup included.
- The summary says what it restored to, the bookmark it came from and the reason. Run it again with that bookmark to
  undo.
- It waits for a deploy of the same environment to finish, and a deploy waits for it.
- Gone back past a deploy that changed the database? The schema is the old one again. Before launch, re-run the
  deploy (`gh workflow run deploy.yml --ref <branch> -f apps=all`) to rebuild it; after launch, `d1_migrations` went
  back too, so the next deploy applies the migrations again. Or roll the code back as well (`rollback.yml`).

**Older than 7 days**, the backup is the source, read locally with the restore drill above, and nothing loads a whole
backup into a database: past a week, putting back the lot would throw away every day since, and the mistake is
almost always a few rows. Put them back the way they were made:

- **Members and what admins enter** (people, events, settings): in the team app, by an admin; members can come back
  by Import members from a CSV made from the restored file.
- **Anything the app can't re-enter**: a reviewed SQL file through a pull request (after launch, a migration,
  `migrations/NNNN_restore_what.sql`, `INSERT OR IGNORE` by id), which the next deploy applies after its backup. The
  repo is public, so the file holds ids, dates and amounts only, never names, emails or phone numbers; rows that need
  those go back through the app.
- Replacing the whole database from an old backup has no workflow. If it's ever needed, it's a new mode of
  `restore-db.yml`, built and tried on dev first: download the artifact, open it with `BACKUP_KEY`, empty the
  database, load the export with `wrangler d1 execute`.

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
