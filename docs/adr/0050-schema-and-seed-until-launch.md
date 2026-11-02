# 0050. The database: a schema and a seed until launch, migrations after; backed up nightly and before every change, sealed

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-11-02
- **Merges:** 0106

## Context

Every change to the database was a numbered migration: sixteen of them before anything went live, several only
adding one column, some fixing the one before. Nothing is live (there's no `release` branch; production has never
been deployed), so nobody's data needs migrating. What matters is the dev database: the club's members, schedule and
settings, entered in the app, which will become production.

## Decision

- Until launch, `db/schema.sql` is the database: every table and index, changed directly. `db/seed/club.sql` holds
  what it starts with that isn't personal (roles, Friday Training, the Kumite series, quips), `INSERT OR IGNORE` by
  id. The roster stays in Secrets Manager (ADR 0029).
- `scripts/db-rebuild.mjs` rebuilds a database from the schema and keeps its data: it reads every row out (backing
  them up to a private temp file), drops the tables, makes them again, puts the rows back (a new column takes its
  default; a column that's gone is dropped and said so), and tops up the club seed. Local runs it with
  `npm run db:rebuild:local`; dev runs it on every deploy, in place of `wrangler d1 migrations apply`.
- Tests build their database from the same schema and seed.
- **Production starts fresh, not as a copy of dev, and never rebuilds.** Launch is one command,
  `node scripts/db-launch.mjs`, in the change that first goes to `release`: `schema.sql` and the club seed become
  `db/migrations/0001_launch.sql`, and the two files go. Production's first deploy builds its database from that
  migration, and the roster (`TEAM_ROSTER__PRODUCTION`) holds only the admins. They bring the members in with Import
  members ([the members notes](../../apps/team/worker/members/README.md)). Dev keeps its data for trying things.
- **Before launch production is deployed behind Cloudflare Access** ([0010](0010-environments-and-deploys.md)) and
  rebuilds like dev, keeping its rows, until the `production` environment's variable `LAUNCHED` is `true`.
- **After launch, migrations only**, additive (the rule before this ADR): `deploy.yml` runs
  `wrangler d1 migrations apply` once `db/migrations/` has any, and refuses to rebuild production once launched;
  `db-rebuild.mjs` refuses once it has; the tests build their database from the migrations.
- **Backups are GitHub Actions artifacts, sealed.** D1's Time Travel goes back 7 days and lives in the account it
  would protect, and R2 needs a payment method. `scripts/db-backup.mjs` exports the database, compresses it and
  encrypts it with the environment's `BACKUP_KEY` (AES-256-GCM, scrypt with a fresh salt; `scripts/lib/backup.mjs`),
  one random key per environment, in Bitwarden only, so a public repo's artifact is useless without it. Nightly
  (`.github/workflows/backup.yml`) and in `deploy.yml` before every rebuild or migration; a failed backup stops the
  deploy. Kept 90 days, the most GitHub allows. Each one is noted in the `backups` table and the Usage page flags the
  last once it's more than a day and a half old.
- **Restore**: `scripts/db-restore.mjs` opens a backup into a fresh SQLite file and counts each table's rows (the
  drill, db/README.md). Within 7 days, `.github/workflows/restore-db.yml` puts a database back exactly with Time
  Travel, after a backup, and names the bookmark that undoes it; it shares the deploys' concurrency group, so it never
  runs beside one. Older, the backup is read locally and the rows go back the way they were made: through the app, or
  a reviewed SQL file through a pull request with no personal data in it (the repo is public). Production is restored
  through CI, never by hand ([ADR 0010](0010-environments-and-deploys.md)).

## Consequences

- A schema change is one edit; local and dev pick it up with their data intact.
- A rebuild rewrites every row, so it's for a small database: fine for one club before launch, not after.
- Renaming a column loses that column's data in a rebuild (it's read out under the old name): copy it across by hand
  in the same change, or don't rename before launch.
- The old migrations are gone from the tree; git history has them.
- Backups survive a lost Cloudflare account and a bad deploy, at no cost. Losing `BACKUP_KEY` loses every backup it
  sealed, and 90 days is the furthest back we can go.
- D1 refuses other statements for the half minute an export takes, so the crons treat that refusal as a warning and
  try again; a request in that half minute still fails.
- Loading a whole old backup into a database has no workflow: Time Travel covers the likely case (a bad deploy or
  import, noticed within the week), and past a week replacing the lot would lose every day since. If it's ever needed,
  it's a new mode of restore-db.yml, tried on dev first.
- A Time Travel restore puts back the schema too: gone back past a deploy that changed the database, the next deploy
  rebuilds (before launch) or migrates it again (after).
