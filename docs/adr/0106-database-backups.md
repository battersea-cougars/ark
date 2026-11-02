# 0106. The database is backed up nightly and before every schema change, sealed, kept 90 days as GitHub artifacts

- **Status:** Accepted
- **Date:** 2026-10-10 · updated 2026-11-02

## Context

The club's database (one D1, [ADR 0022](0022-team-app-svelte-pwa.md)) had no backup. D1's Time Travel goes back 7
days on the free plan and lives in the same account it would protect. Until launch, a deploy that changes the schema
rebuilds the database ([ADR 0050](0050-schema-and-seed-until-launch.md)), and the copy it took went to the CI runner's
temp folder and was lost with the runner.

Where to keep a backup, free ([ADR 0003](0003-free-tiers-only.md)):

- **R2** (10 GB free) needs a payment method on the Cloudflare account and a token that can write to it, and it's in
  the same account as the database.
- **GitHub Actions artifacts** cost nothing on a public repo, keep up to 90 days, and sit outside Cloudflare. But
  anyone signed in to GitHub can download a public repo's artifacts, and a backup is members' names and emails.

## Decision

- **Artifacts, sealed.** `scripts/db-backup.mjs` exports the database (`wrangler d1 export`), compresses it and
  encrypts it with the environment's `BACKUP_KEY` (AES-256-GCM, the key stretched with scrypt and a fresh salt each
  time: `scripts/lib/backup.mjs`), so the artifact is useless without the key, and a changed byte is refused. The plain
  export never leaves a private temp folder.
- **One key per environment**, random, in Bitwarden only ([docs/secrets.md#our-own-keys](../secrets.md#our-own-keys)): a dev key can't open production's
  backups.
- **When:** nightly, some time after 03:13 UTC (`.github/workflows/backup.yml`; production's run starts on `release`, as the
  website's rebuilds do), and in `deploy.yml`'s `database` job before every rebuild or migration. A backup that fails
  stops the deploy.
- **Kept** 90 days, the most GitHub allows, named `d1-<environment>-…` on the run.
- **Seen**: each backup notes when, why and how big in the database's `backups` table; the team app's Usage page shows
  the last one, flagged once it's more than a day and a half old.
- **Restore**: `scripts/db-restore.mjs` opens a backup into a fresh SQLite file and counts each table's rows (the
  drill, db/README.md#backups). Within 7 days, `.github/workflows/restore-db.yml` puts a database back exactly with
  Time Travel, after a backup, and names the bookmark that undoes it; it shares the deploys' concurrency group, so it
  never runs beside one. Older, the backup is read locally and the rows go back the way they were made: through the
  app, or a reviewed SQL file through a pull request with no personal data in it (the repo is public). Production is
  restored through CI, never by hand ([ADR 0010](0010-environments-and-deploys.md)).

## Consequences

- Backups survive a lost Cloudflare account and a bad deploy, at no cost, and stay unreadable to the public.
- Losing `BACKUP_KEY` loses every backup it sealed. Bitwarden is the one place it lives, as with every secret.
- 90 days is the furthest back we can go; an older mistake is past saving.
- A backup is taken before every schema change on dev too, so pushes that touch `db/` take a little longer.
- D1 refuses every other statement while it exports, for the half minute or so a backup takes ("Currently processing
  a long-running export"), and GitHub can start the nightly run hours late, so it can land at any time of day. The team
  app's crons treat that refusal as a warning, not an error: a minute it meets does nothing and the next one runs, and a
  job it meets is tried again with the hour's next try (cron/hourly.ts). A request in that half minute still fails.
- Loading a whole old backup into a database has no workflow: Time Travel covers the likely case (a bad deploy or
  import, noticed within the week), and past a week replacing the lot would lose every day since. If it's ever
  needed, it's a new mode of restore-db.yml, tried on dev first.
- A Time Travel restore puts back the schema too: gone back past a deploy that changed the database, the next deploy
  rebuilds (before launch) or migrates it again (after).

## History

- 2026-10-10: Nightly and before every schema change, sealed with a per-environment key, kept 90 days as GitHub
  artifacts; the last one on the Usage page (#31).
- 2026-10-24: The nightly run starts some time after 03:13 UTC, not at 03:15: GitHub runs schedules on the hour
  and the quarter hours late, or drops them (#148).
- 2026-11-01: The team app's crons wait out a backup's export instead of reporting it as an error, after the nightly
  run started at 10:28 UTC and met the run every minute (#197).
- 2026-11-02: Putting one back goes through CI: `restore-db.yml` restores to a moment in the last 7 days with Time
  Travel after a backup; older backups go back row by row, through the app or a reviewed SQL file without personal
  data (#218).
