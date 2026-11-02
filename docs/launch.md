# Launch day

How the website and the team app go live together, from `release`, and how to undo it. For whoever runs the day: the
owner, with Claude. The order and the ticks are in the go-live plan,
[#181](https://github.com/battersea-cougars/ark/issues/181); this is how to do each step.

The website has been open since 2026-10-30. "Launch" is the rest:

| Before launch                                                               | After launch                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| The database is `db/schema.sql` + `db/seed/club.sql`; deploys rebuild it    | It's `db/migrations/`; deploys only migrate, never rebuild (ADR 0050) |
| The `production` environment has no `LAUNCHED` variable                     | `LAUNCHED` is `true`, so a production rebuild is refused              |
| `team.batterseacougars.com` is behind Cloudflare Access (the admins only)   | The gate is gone; the team app's own sign-in keeps it members-only    |
| Production's club is its admins (`TEAM_ROSTER__PRODUCTION`)                 | The admins have imported the members                                  |
| Every website deploy copies the words in `fallback.ts` to Sanity (ADR 0004) | The step is gone; the Studio owns the words                           |
| The team app is 0.x                                                         | It's 1.0.0 (ADR 0022)                                                 |

Who does what: **Claude** makes the changes and runs the commands; the **owner** says yes to each push and merge,
does the account steps, and checks the apps as a member would. Nothing touches production by hand: every change goes
through a pull request and `deploy.yml` ([ADR 0010](adr/0010-environments-and-deploys.md)).

## Before the day

### Green

- [ ] **The pre-push list on `main`**, as `pr.yml` runs it (CLAUDE.md, Tests):
      `npm run secrets:scan -- --since main && npm run lint && npm run knip && npm test && npm run check -w @cougars/web && npm run check -w @cougars/team && npm run build && npm run build -w @cougars/team && npm run build -w @cougars/studio`.
      Done: exit code 0.
- [ ] **The journeys** in full: Actions → _Journeys_ → Run workflow on `main`, `full`
      (`gh workflow run journeys.yml --ref main -f run=full`). Done: the run is green and no `regression` issue is
      open.
- [ ] **Dev's last deploy** (Actions → _Deploy_, the newest run on `main`) is green, smoke tests included.
- [ ] **Sentry**: no unresolved production issue you don't understand; the uptime monitors for the website's
      `/health` and the team app's `/api/health` are green; the `team-hourly` cron monitor checked in within the
      hour ([ADR 0110](adr/0110-structured-logging.md)).
- [ ] **A recent production backup**: the team app's Settings → Usage shows the last backup under a day and a half
      old, and the newest `d1-production-…` artifact under Actions → _Back up_ opens
      ([restore drill](../db/README.md#backups)).
- [ ] **The gaps below are closed**, or the owner has decided to launch without them.

### The owner's account steps (#181, section 2)

- [ ] Sign-in email on one Gmail client (#147): add `http://localhost:4590/` to the Web client's redirect URIs, then
      `node scripts/gmail-auth.mjs` as the developer account. Claude does the rest.
- [ ] Google verification (#156): publishing status _In production_, the domain verified, Branding filled in, the
      `gmail.send` justification and demo video sent. Google's review takes days.
- [ ] Domain contact (#102): the club on the registrant contact.
- [ ] Sanity editor (#93): the team manager invited as Editor (Cougars, and Cougars Dev to practise).
- [ ] Web Analytics (#92): the token in `deploy.yml`, then automatic setup off ([accounts.md](accounts.md#the-domain)).
- [ ] Secrets tidied (#234): Bitwarden's old copies deleted, CI's Sentry token narrowed, Workers Editor off
      production's Cloudflare token.

### Gaps (to close before the day)

Found while writing this runbook:

- **Putting production's database back through CI** ([#218](https://github.com/battersea-cougars/ark/issues/218)):
  `restore-db.yml` exists; try it once on dev (`gh workflow run restore-db.yml --ref main -f to=<an hour ago> -f
reason="restore drill"`) before the day.
- **Production doesn't quite start fresh** (the same issue). It has been deployed and rebuilt before launch, keeping
  its rows. At launch `scripts/db-migrate.mjs` sees its tables and marks `0001_launch.sql` as already applied, so
  whatever the admins tried behind Access stays. Look before the day (signed in on `team.batterseacougars.com`:
  Members, the schedule, payments) and delete try-outs in the app, or decide in #218 to empty it.
- **Local tools still build from `db/schema.sql`** ([#219](https://github.com/battersea-cougars/ark/issues/219)): the
  journeys (which also run on the launch push to `release`), the load server and the container's start-up break once
  `db-launch.mjs` has run. Fix first, or the launch push files a `regression` issue straight away.

## Launch day, in order

Pick a quiet time, not a Friday: nobody signing up for training while it happens.

### 1. A backup by hand

**Claude**, with the owner's yes: `gh workflow run backup.yml --ref release -f why="before launch"`.

**Done:** the run is green and has an artifact `d1-production-<run id>`; Usage shows a backup "before launch".

### 2. The launch change, into `main`

**Claude**, in its own worktree: `npm run worktree -- add repo/launch`, then:

1. `node scripts/db-launch.mjs`. It writes `db/migrations/0001_launch.sql` (the schema and the club seed, identical)
   and deletes `db/schema.sql` and `db/seed/club.sql`. It refuses if there are migrations already.
2. db/README.md: "Schema and seed (until launch)" goes, "Launch" says it happened. ADR 0050 is rewritten for
   migrations and its _updated_ date bumped.
3. `.github/workflows/deploy.yml`: the web job's "Words to Sanity" step goes; ADR 0004 says so.
4. `apps/team/package.json`: `"version": "1.0.0"` (ADR 0022).
5. `npm run db:migrate:local`, then the pre-push list. Done: exit code 0.
6. A pull request into `main`; the owner says yes; merged.

**Done:** Actions → _Deploy_ on `main` is green. Its `database` job backed up dev, then "Migrate, or rebuild before
launch" ran `db-migrate.mjs`: dev's tables were there, so 0001 was marked as applied and nothing else ran. Dev's
team app works as before.

### 3. `LAUNCHED` on the production environment

**The owner** (or Claude with the owner's yes): `gh variable set LAUNCHED --env production --body true`.

**Check:** `gh variable list --env production` lists `LAUNCHED  true`. From now on `deploy.yml` refuses to rebuild
production even if the migrations went missing.

### 4. The release pull request, `main` into `release`

**Claude**: `gh pr create --base release --head main --title "Release: launch" --body "…"` (say what goes live).
`pr.yml` runs its `check` job; the ruleset (`scripts/branch-rules.mjs`) lets it merge only when that passes, and only
as a merge commit. **The owner** says yes; `gh pr merge <number> --merge`.

**Watch:** `gh run list --workflow deploy.yml --branch release --limit 1`, then `gh run watch <run id> --exit-status`.
In order:

- `database`: "Back up before changing it" (artifact `d1-production-before-deploy-<run id>`, kept 90 days); "Migrate,
  or rebuild before launch" runs `db-migrate.mjs` (production's tables are there, so 0001 is marked as applied, see
  [Gaps](#gaps-to-close-before-the-day)); "Seed the team roster" adds the admins from `TEAM_ROSTER__PRODUCTION` who
  aren't there yet and changes no one.
- `web`, `team`, `studio`: each deploys and passes its smoke test (the website's checks the build and sends the
  "Try a session" form's two emails to the sending account; the team app's checks health, 401 without a session, no
  local sign-in, framing headers).
- _Journeys_ also runs on the push to `release`, in full, on the runner; it never blocks the deploy.

**Done:** every job green; the Deployments page lists `web (production)`, `team (production)` and
`studio (production)` at this commit.

### 5. Check production

**The owner**, on a phone and a laptop, in a private window:

- [ ] `https://batterseacougars.com` loads, with no `DEV` or `LOCAL` ribbon.
- [ ] **Sign-in**, on `https://team.batterseacougars.com` (still behind Access: get past it with your email and its
      code first): ask for a sign-in code; it arrives from the club's address. Sign in, add a passkey when offered,
      sign out, and sign in again with the passkey. Profile's foot says 1.0.0.
- [ ] **The enquiry form**: on the website, "Try a session" with your own details. Done: the club inbox gets the
      enquiry, and you get the auto-reply.
- [ ] **Sentry**: no new production issue; both uptime monitors green; the hourly cron checked in on the next hour.
- [ ] **Usage** (Settings → Usage): today's backup is listed.

If any fails, stop here: [roll back](#rolling-back) or fix forward before the members come in.

### 6. The members come in

**The admins**, in the team app: Members → Manage → **Import members**, with the club's spreadsheet (CSV) or roster
JSON ([the members notes](../apps/team/worker/members/README.md)). The first step only checks the file and says who'd be added and which rows are
wrong; fix the file until it's clean, then import. Nobody is emailed.

**Done:** Members lists everyone; the imported count matches the spreadsheet; anyone without an email is known (they
can't sign in until an admin adds one).

### 7. Open the team app (Access off)

The team app is members-only always, by its own sign-in. Access only stood in front of it until launch, and it lets
in only the admins, so members (and the store app, ADR 0108) can't reach it while it's there.

**Claude**, with the owner's yes:
`node scripts/env-pull.mjs --environment production -- node scripts/access-setup.mjs --remove`. It deletes the
"Cougars before launch" app, the health-check bypass, their policies and CI's service token, and prints each one.
Then **the owner** deletes `CF_ACCESS_CLIENT_ID__PRODUCTION` and `CF_ACCESS_CLIENT_SECRET__PRODUCTION` in Bitwarden
Secrets Manager (project `cougars`).

**Check:** in a private window `https://team.batterseacougars.com` shows the team app's own sign-in, not
Cloudflare's; `/api/bootstrap` answers 401 without a session; Sentry's uptime monitor for the team app stays green.
The website and the Studio are unchanged (the Studio is behind Sanity's own sign-in, never Access).

**Then** a docs change (Claude): secrets.md (the two Access secrets and `SANITY_CONTENT_TOKEN__*` gone, Overview
table), setup.md's "Before launch, behind Cloudflare Access", accounts.md's Access row, ADR 0010's History. The owner
deletes `SANITY_CONTENT_TOKEN__PRODUCTION` and `__DEV` in Sanity and Bitwarden.

### 8. Tell the club

**The admins**: the address (`team.batterseacougars.com`), "sign in with the email the club has for you", and who to
ask if it doesn't work. Then tick #181's release-day items.

## Rolling back

First decide what's broken: the code (roll the Worker back), the data (see the database), or an outside service
(Gmail, Sentry: no rollback, fix the service).

### An app

Actions → _Roll back_ (`.github/workflows/rollback.yml`), run on `release`:

    gh workflow run rollback.yml --ref release -f app=team -f reason="what broke"
    gh workflow run rollback.yml --ref release -f app=web -f version=<version id> -f reason="what broke"

- Blank `version`: the version before the last deploy. That's the right one straight after a bad release.
- Otherwise a version id. Every version's message is its build, `YYYY.MM.DD+<commit>`: pick the one whose commit
  is the last good release (the run's log lists the recent deployments first; or Cloudflare, the **Cougars** account →
  Workers & Pages → the worker → Deployments).
- It's code only. Rolling the launch release back is safe for the data: `0001_launch.sql` is the schema the earlier
  code ran on.
- The Studio isn't in it: revert on `main` and release again.
- The next deploy from `release` (the daily rebuild after 04:37 UTC too) puts the bad code back. Revert the commit on
  `main`, then a release pull request, the same day.

**Done:** the run's summary says what was rolled back; the app's Profile foot (team) or the page source's `generator` meta tag (website)
shows the old build.

### The database

Backups: every night (`backup.yml`) and before every deploy that changes the database (`deploy.yml`), sealed with
`BACKUP_KEY__PRODUCTION`, kept 90 days as artifacts ([ADR 0050](adr/0050-schema-and-seed-until-launch.md)).

**Reading one back** (exists, safe, local only):

    gh run download <run id> -n d1-production-before-deploy-<run id> -D <a private temp folder>
    node scripts/env-pull.mjs --environment production -- node scripts/db-restore.mjs <folder>/<file>.cgbk

`db-restore.mjs` opens it into a fresh SQLite file in a private temp folder (or `--out <path>`, which must not exist),
prints each table's row count, and fails if any row points at something missing. It never writes to D1. The file is
the club's personal data: never in the repo, deleted when done.

**Putting it back, within 7 days**: Actions → _Restore the database_ (`.github/workflows/restore-db.yml`), run on
`release`, with the owner's yes:

    gh workflow run restore-db.yml --ref release -f to=2026-11-02T09:30:00Z -f reason="what broke"

- `to` is a moment in UTC (RFC 3339 or Unix seconds) in the last 7 days, or a Time Travel bookmark. A time outside the
  window stops the run before anything changes.
- It backs up first (artifact `d1-production-before-restore-<run id>`, 90 days), then D1 Time Travel puts all of
  `cougars` back to that moment, schema included: everything written since is gone.
- It waits for a running deploy to production and the deploy waits for it; don't queue both at once.
- Gone back past the launch release? `d1_migrations` went back too, so the next deploy applies the migrations again
  (or roll the code back as well with `rollback.yml`).

**Done:** the run's summary says what it restored to, the bookmark it came from and the reason. To undo it, run it
again with that bookmark: `gh workflow run restore-db.yml --ref release -f to=<that bookmark> -f reason="undo"`.

**Older than 7 days**: the backup is read locally (above) and the rows go back the way they were made: in the app by
an admin (members by Import members), or a reviewed SQL file through a pull request, with ids, dates and amounts only,
never names or emails (db/README.md, Putting one back). Nothing loads a whole old backup into production.

- Straight after launch, before the import, there is nothing to put back: the database is the admins and the seed.
- A bad import is undone in the app (delete the members it added), by importing again, or with the workflow to just
  before it.

### What can't be rolled back

- **Emails sent**: sign-in codes, enquiry auto-replies, dues reminders. They're out.
- **Notifications** pushed to phones.
- **Passkeys** members made on `team.batterseacougars.com`: they stay on their phones (harmless).
- **Access off**: it can go back on (`access-setup.mjs` without `--remove` makes the gate and a new service token),
  but only the admins on its policy get in then.
- **`LAUNCHED`** can be deleted, but once `db/migrations/` exists production migrates anyway: it never rebuilds again.

## After launch

- **Migrations only.** A change is a new `db/migrations/NNNN_what.sql`, additive (new tables, new columns with a
  default): `npx wrangler d1 migrations create DB what -c apps/web/wrangler.jsonc`, `npm run db:migrate:local`, the
  tests pick it up, the next deploy applies it after its backup. `db-rebuild.mjs` refuses; never work round it
  ([db/README.md](../db/README.md)).
- **Watch the Usage page** on the first busy Friday and the first draft night: rows read is the line to watch, not
  requests ([ADR 0003](adr/0003-free-tiers-only.md)).
- **Restore drill** now and then ([db/README.md](../db/README.md#backups)); #148 section 8.
- **Search Console and Google branding** (#108): the Domain property, the sitemap, and the Gmail app's home page and
  privacy addresses on `batterseacougars.com`.
- **The store apps** ([ADR 0108](adr/0108-store-apps.md)): the shell loads production's team app, which needs Access
  off (step 7); account setup and the first TestFlight build (#98), Android with #26.
- **The Apple membership's owner** (#103), before the store app is public.
- The rest of milestones 3 to 5.

## Where things live

By service; who owns each and which secrets it issues is in [accounts.md](accounts.md), the secrets themselves in
[secrets.md](secrets.md).

| What                           | Where                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Code, deploys, rollbacks       | GitHub, `battersea-cougars/ark`: Actions (_Deploy_, _Roll back_, _Back up_, _Journeys_), Deployments      |
| The `LAUNCHED` variable        | GitHub → Settings → Environments → `production`                                                           |
| Workers, D1, domain, Access    | Cloudflare: **Cougars** (production) and **Cougars Dev** (dev); Access under Zero Trust on Cougars        |
| Errors, uptime, the cron check | Sentry, organisation `battersea-cougars` (EU): projects `web` and `team`; its alerts go to email          |
| Secrets                        | Bitwarden Secrets Manager: projects `cougars` (production) and `cougars-dev`; names via `npm run secrets` |
| The website's words and photos | Sanity: **Cougars** (production) and **Cougars Dev**; the Studio at `studio.batterseacougars.com`         |
| Email                          | Gmail: the developer account sends, the club account receives (ADR 0027)                                  |
| Locked out of the team app     | `npm run admin:break-glass -- <admin's email> --env production` ([development.md](development.md))        |
