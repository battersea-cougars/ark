# Working on the code

For developers: running the apps on your machine, the ports, one worktree per task, and getting an admin back in.
Conventions are in [CLAUDE.md](../CLAUDE.md), decisions in [adr/](adr/README.md).

## Running it

```sh
npm ci
npm run db:rebuild:local   # create the local D1 database (db/schema.sql + the club seed)
npm run db:seed:local      # a made-up club to work with (db/seed/roster.example.json), its admin Ada Admin
npm run dev                # the website, http://localhost:4500 (through the show switch, below)
npm run team               # the team app, http://localhost:4510 (sign in as admin@example.com: the code shows on screen)
npm run studio             # the Sanity Studio, http://localhost:4520
npm test
```

A clean clone needs nothing else: no private files. The website's `apps/web/src/data/*.local.json` are made from the
local database by every build, and `db/seed/roster.local.json` (your own roster) is optional
([db/seed/README.md](../db/seed/README.md)).

- To preview the design with sample events, videos, photos and players: `DEMO_CONTENT=true npm run dev`.
- The site builds and runs **without Sanity**: until a Sanity project is configured, it uses the club copy in
  `apps/web/src/lib/sanity/fallback.ts` and shows empty states for videos, photos and events.
- With secrets: `bw-unlock`, then `npm run app restart`; the apps pick up dev's ([secrets.md](secrets.md#how-secrets-work)).

Opening the devcontainer installs dependencies, rebuilds the local D1 database (seeding the made-up club if it's
empty) and starts **web** and the **team app** (VS Code tasks in `.vscode/tasks.json`, each in its own terminal).
Start the Studio with _Terminal → Run Task… → dev: studio_.

## Ports

Cougars owns ports **4500-4529** so it doesn't clash with other projects on the host: 4500 the website, 4510 the
team app, 4520 the Sanity Studio. They belong to the show switch (below), never to an app: each shows the checkout
last shown, and every app runs on a private port that's free when it starts (not forwarded).

## Worktrees

The main checkout stays on `main` and is for merging. Each task is a branch in its own worktree, so several agents
work at once ([ADR 0115](adr/0115-worktrees-and-the-show-switch.md)). A new one is ready at once: main's
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
private port: `node scripts/dev-sign-in.mjs --port <team app port>` ([testing.md](testing.md#signed-in-in-a-real-browser)).

## Locked out

Members sign in to the team app with a passkey or an emailed code ([ADR 0023](adr/0023-sign-in-and-sessions.md)).
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
