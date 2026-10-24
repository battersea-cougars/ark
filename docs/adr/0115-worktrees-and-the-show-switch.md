# 0115. One task, one worktree; one switch holds the user's ports and shows a checkout

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Several agents work on the repo at once. Each needs its own checkout, and the user needs to look at any one of them
on the ports they already use: 4500 the website, 4510 the team app, 4520 the Studio.

On 2026-10-07 the repo dropped worktrees. Each had its own slot ports (4501-4503, 4521-4523, `scripts/worktree.sh`),
so the user's ports showed main while the change was elsewhere, every new stream needed a new port, CORS origin and
forwarded port, and servers started in the background were left running. One checkout made agents queue behind each
other instead.

The user's other repo, typesmiths/ledger, solved the same problem: a worktree per branch with main's `node_modules`
hard-linked, and one supervisor that owns the well-known ports and switches them between checkouts.

## Decision

- **The main checkout (`/src`) stays on `main`** and is used for merging. Each task is a branch in its own worktree:
  `npm run worktree -- add <area>/<topic>` makes `.worktrees/<area>-<topic>` off main, ready at once by hard-linking
  main's `node_modules` (root and workspaces) when `package-lock.json` matches, else `npm ci`. Caches that runs
  rewrite in place (`.vite`, `.vite-dev`, `.astro`, `.mf`, `.cache`, `.sanity`) are never linked: a hard-linked file
  written in place would change main's. `.env` (non-secret overrides only, ADR 0002) is copied.
  `npm run worktree -- remove <area>/<topic>` stops its apps, removes it only if clean, and deletes the branch if
  merged.
- **One supervisor (`scripts/app-supervisor.mjs`) holds 4500, 4510 and 4520 as a switch.** Every request, hot
  reload's websocket and SSE included, goes to the app of the checkout shown. Each app runs on a free private port,
  in its own session, so it's stopped whole; nothing the supervisor started outlives it, and a supervisor killed
  outright has its leftovers (marked by `COUGARS_APP_SUPERVISOR` in their environment) stopped by the next. A crashed
  app starts again, waiting longer each time; a branch's app idle for 3 hours stops (main's and the shown one's never).
  Logs: `.worktrees/.show/` (the supervisor's, and one per app).
- **`npm run app`** shows this checkout (website and team app; the Studio when named, or when 4520 is opened).
  `app main`, `app --private` (run, don't show: prints the private ports, for an agent's own checks), `app status`,
  `app restart|stop [service]`, `app logs <service>`, `app down`. While the shown app starts, its port answers with a
  page that says so and reloads; `/__app` on any of the ports lists every checkout with Show, Restart, Stop and logs.
- **`npm run dev`, `npm run team` and `npm run studio` go through the switch**: they show this checkout, start that
  app afresh and follow its log in the terminal (Ctrl-C stops following, not the app). So the habit still works,
  "running it again restarts it" still holds, and there is no second way to hold a port that could fight the switch.
  The workspaces' `dev` scripts do the same. The supervisor, when it starts, takes the ports over from a dev server
  started by hand, as starting one always did (ADR 0022).
- **Dev secrets** come through `scripts/env-pull.mjs` when the Bitwarden vault is unlocked (`bw-unlock`); the
  supervisor never asks for a password. Locked, the apps run without and `app status` says so; `app restart` looks
  again.
- **Local D1 is main's by default** (`COUGARS_LOCAL_STATE`, set by the supervisor, read by both apps' configs and the
  club snapshot): your data and your sign-in are there, whichever checkout is shown. A branch that changes
  `db/schema.sql` runs `npm run app -- --own-db`: a copy of main's state in the worktree, which its own
  `npm run db:rebuild:local` then changes; `--shared-db` goes back.
- **`npm run merge:check -- <area>/<topic>`**, in the main checkout: the branch must be on main's tip and clean. In its
  worktree (or a temporary one), never main's tree, it runs a tier picked from `git diff main...<branch>`
  (`scripts/lib/merge-check.mjs`): docs only, a format check; otherwise lint, knip and the whole test suite, then the checks
  and builds of the apps the diff reaches. A website change also checks and builds the team app (it imports the
  website's code); a change only in the team app or the Studio checks that one; anything outside the apps runs the
  full pre-push list. It prints "Safe to merge" or not.

## Consequences

- The user's ports always show one whole checkout, switched in a second; agents never need a port of their own.
- The Studio is always `http://localhost:4520` to Sanity, so CORS needs that origin only; a Studio on a private port
  (`--private`) can't sign in to Sanity.
- Agents start apps only through `npm run app`, never with `&`, `nohup` or `setsid`, and never stop anything on the
  three ports except through it.
- Killing a VS Code terminal no longer stops its app: `npm run app stop` or `/__app` does.
- A branch from before this change runs its own old configs: rebase it onto main first, or its team app tries 4510.
- Linux only (the devcontainer): processes are read from `/proc`.
- Worktrees share one local D1, so a migration-like change in one branch is seen by all unless it uses `--own-db`.

## History

- 2026-10-20: Worktrees again, the ledger way: hard-linked `node_modules`, one switch on 4500/4510/4520, and
  `merge:check`; replaces `scripts/worktree.sh` and its slot ports.
