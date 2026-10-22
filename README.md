# Battersea Cougars

Website and team app for the Battersea Cougars inline hockey club: two projects in one repo
([ADR 0006](docs/adr/0006-one-repo-two-projects.md)). The website is live; the team app is next. What's planned is in
[GitHub milestones](https://github.com/battersea-cougars/ark/milestones).

| Part          | What                                                                      | Where                 |
| ------------- | ------------------------------------------------------------------------- | --------------------- |
| `apps/web`    | Public website: Astro, deployed as a Cloudflare Worker with static assets | http://localhost:4500 |
| `apps/studio` | Sanity Studio, where the club edits content                               | http://localhost:4520 |
| `db/`         | D1 (SQLite) migrations                                                    |                       |
| `shared/`     | Code used by more than one app (D1 helpers, test fixtures)                |                       |
| `scripts/`    | Secrets loading (Bitwarden) and CI helpers                                |                       |
| `apps/team`   | Team app: mobile-first Svelte PWA (clickable demo shell for now)          | http://localhost:4510 |

Running cost is £0: every service is on a free tier (see [ADR 0003](docs/adr/0003-free-tiers-only.md)).

## Quick start

```sh
npm ci
npm run db:rebuild:local   # create the local D1 database (db/schema.sql + the club seed)
npm run db:seed:local      # a made-up club to work with (db/seed/roster.example.json), its admin Ada Admin
npm run dev                # the website, http://localhost:4500 (through the show switch, see Worktrees)
npm run team               # the team app, http://localhost:4510 (sign in as admin@example.com: the code shows on screen)
npm test
```

A clean clone needs nothing else: no private files. The website's `apps/web/src/data/*.local.json` are made from the
local database by every build, and `db/seed/roster.local.json` (your own roster) is optional.

To preview the design with sample events, videos, photos and players: `DEMO_CONTENT=true npm run dev`.

The site builds and runs **without Sanity**: until a Sanity project is configured, it uses the club copy in
`apps/web/src/lib/sanity/fallback.ts` and shows empty states for videos, photos and events.

With secrets (run `bw-unlock` first, see [Bitwarden tokens](docs/secrets.md#bitwarden-tokens)):

```sh
npm run secrets                             # list secret names (never values)
npm run app restart                         # the apps pick up dev secrets once Bitwarden is unlocked
```

## Secrets

Passwords, keys and tokens the apps need: to deploy, send email, read YouTube and Instagram, send notifications, seal
backups. **Each one is described in [docs/secrets.md](docs/secrets.md)**: why it exists, whose account it comes from,
who reads it, how it gets there, and how to change it. Which outside service each comes from:
[docs/accounts.md](docs/accounts.md).

How they work ([ADR 0002](docs/adr/0002-secrets-in-bitwarden.md), [ADR 0010](docs/adr/0010-environments-and-deploys.md)):

- **They live in Bitwarden Secrets Manager, and nowhere else.** Not in files, not in GitHub (bar the two tokens that
  open Bitwarden), not in this public repo. `.env` is for your own non-secret settings only ([.env.example](.env.example)).
- **Two environments, two projects.** Production (Cloudflare account **Cougars**) reads the project `cougars`; dev
  (account **Cougars Dev**: your machine, PR previews, `main`, `scripts/deploy-dev.sh`) reads `cougars-dev`. The dev token can't see
  `cougars` at all.
- **One naming rule.** A plain `NAME` is shared by both environments (it sits in `cougars-dev`); `NAME__PRODUCTION`
  or `NAME__DEV` is that environment's own value. The code always reads plain `NAME`.
- **A token is named exactly like its secret** at the provider that issued it, so the two lists match.
- **Never in this repo:** a value, or anyone's email address or phone number; name accounts by role ("the club
  account", "the developer account"). What's safe to write: [docs/accounts.md](docs/accounts.md#writing-about-accounts-in-this-repo).

**On your machine:** run `bw-unlock` once per container start (your master password), and the scripts find their
token themselves ([Bitwarden tokens](docs/secrets.md#bitwarden-tokens)).

```sh
npm run secrets                                  # the names in dev (never values); add -- --environment production
node scripts/env-pull.mjs -- <command>           # run a command with dev's secrets, in memory only
npm run secret:set NAME                          # add or change one (hidden prompt; picks the project from the name)
```

**Adding one:** create the token with the secret's name, `npm run secret:set NAME`, and add its entry to
[docs/secrets.md](docs/secrets.md) in the same change.

By system: [Bitwarden](docs/secrets.md#bitwarden) · [Cloudflare](docs/secrets.md#cloudflare) ·
[Google](docs/secrets.md#google) (Gmail, YouTube, Firebase) · [Apple](docs/secrets.md#apple) ·
[Sanity](docs/secrets.md#sanity) · [GitHub](docs/secrets.md#github) · [Sentry](docs/secrets.md#sentry) ·
[Instagram](docs/secrets.md#instagram) · [Web Push](docs/secrets.md#web-push) ·
[Our own keys](docs/secrets.md#our-own-keys) · [Club data](docs/secrets.md#club-data) ·
[Plain settings](docs/secrets.md#plain-settings) · [Everything in one table](docs/secrets.md#overview)

## Locked out

Members sign in to the team app with a passkey or an emailed code ([ADR 0023](docs/adr/0023-sign-in-and-sessions.md)).
An admin with neither (Gmail down, every admin's passkeys lost, no admin signed in anywhere) gets in by **break
glass**, from a terminal with `bw-unlock` done and the environment's Cloudflare token in Bitwarden:

```sh
npm run admin:break-glass -- dana@example.com                    # dev
npm run admin:break-glass -- dana@example.com --env production   # asks for the email again
```

It refuses anyone but an active admin (`manage:all`), prints one six-digit code here and nowhere else, and that admin
types their email and the code on the usual sign-in page within 15 minutes. The first browser to ask for their code
takes it; it works once, with the usual five tries. It's on the record (Activity, `auth.break_glass`), every admin
hears of it (phone, and email if it's working), and each admin's Home shows it with **Sign it out**. Once in, add a
passkey on the You page, and let others in the usual ways.

## Docs

- [docs/accounts.md](docs/accounts.md): every outside service, who owns it, and which secrets come from it
- [docs/secrets.md](docs/secrets.md): every secret, by system: why, owner, used by, how to change it
- [docs/setup.md](docs/setup.md): one-time account setup (Cloudflare, Sanity, Bitwarden, GitHub)
- [docs/testing.md](docs/testing.md): how we test (use cases first, the fake world)
- [docs/editing.md](docs/editing.md): guide for club editors (no coding)
- [Milestones](https://github.com/battersea-cougars/ark/milestones): what's next, per project, as GitHub issues
- [docs/adr/](docs/adr/README.md): architecture decisions, and why
- [db/README.md](db/README.md): database conventions
- [docs/team-app-data-model.md](docs/team-app-data-model.md): the team app's tables
- [CLAUDE.md](CLAUDE.md): conventions for contributors and AI agents

## Ports (devcontainer)

Cougars owns ports **4500-4529** so it doesn't clash with other projects on the host: 4500 the website, 4510 the
team app, 4520 the Sanity Studio. They belong to the show switch (below), never to an app: each shows the checkout
last shown, and every app runs on a private port that's free when it starts (not forwarded).

## Worktrees (parallel work)

The main checkout stays on `main` and is for merging. Each task is a branch in its own worktree, so several agents
work at once ([ADR 0115](docs/adr/0115-worktrees-and-the-show-switch.md)). A new one is ready at once: main's
`node_modules` is hard-linked when the lockfile matches.

```sh
npm run worktree -- add web/gallery     # branch web/gallery off main, in .worktrees/web-gallery
npm run worktree -- remove web/gallery  # its apps stopped, the worktree removed if clean, the branch if merged
npm run merge:check -- web/gallery      # in the main checkout: the branch's checks, then "Safe to merge" or not
```

**Showing a checkout.** One supervisor holds 4500, 4510 and 4520 and forwards each (hot reload included) to the
apps of the checkout shown:

```sh
npm run app                  # show this checkout: its website on 4500, team app on 4510 (Studio: add studio)
npm run app main             # show the main checkout
npm run app -- --private     # run this checkout's apps without showing them: prints their own ports
npm run app -- --own-db      # this checkout's own copy of local D1 (a branch that changes db/schema.sql)
npm run app status           # what's shown, every app, its port and state
npm run app restart [web|team|studio]
npm run app stop [web|team|studio]
npm run app logs web --follow
npm run app down             # the supervisor and every app
npm run dev                  # show this checkout and start its website afresh, following its log (also team, studio)
```

**In a browser: http://localhost:4500/__app** (or 4510/__app) lists every checkout with Show, Restart and Stop and
each app's log. While a shown app starts, its port says so and opens it when it answers; the Studio starts when 4520
is opened. A branch's app nobody has looked at for 3 hours stops (main's never). Ctrl-C in `npm run dev` only stops
following the log. Logs live in `.worktrees/.show/`.

Every checkout's apps use **main's local D1** (your data and sign-in), unless started with `--own-db`. They get the
dev secrets when Bitwarden is unlocked (`bw-unlock`, then `npm run app restart`). To sign in headless against a
private port: `node scripts/dev-sign-in.mjs --port <team app port>`.

Opening the devcontainer installs dependencies, migrates the local D1 database and starts **web** and the **team app**
automatically (VS Code tasks in `.vscode/tasks.json`, each in its own terminal). Start the Studio with
_Terminal → Run Task… → dev: studio_.
