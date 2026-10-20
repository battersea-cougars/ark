# 0022. The team app is a mobile-first Svelte 5 SPA on a Worker, as a PWA, with a dev server that bundles up front

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-20
- **Merges:** 0047

## Context

The team app is used mostly on phones at the rink: a game clock that must keep running with no signal, a live draft,
drag-and-drop teams, a door register. It may become a store app later. The website's Astro setup
([ADR 0004](0004-astro-workers-sanity-d1.md)) is built for prerendered pages, not app screens. Gwenda's ops app is a
Svelte 5 + Vite SPA with a phone shell (bottom tabs derived from one route tree, a More page, a desktop rail) that
works well, and we know it.

In dev, Vite bundles the browser's libraries into `apps/team/node_modules/.vite/deps/` and serves them with a version
stamp in the URL. Two things kept changing that stamp under an open tab, which then got 504s ("Outdated Optimize Dep")
and a blank main screen: Vite found libraries lazily, so opening a screen the startup crawl hadn't reached made it
rebundle mid-session; and a second `vite` in the same checkout (another session, a `--force` restart) rebuilds that
folder **before** it tries the port, so it broke the running server's page even though `strictPort` then stopped it.
A third: Vite restarts itself in the same process (index.html or `wrangler.jsonc` edited, workerd restarted) and tells
the tab to reload at the same moment; the reload landed while the new server was being built, `main.ts` was stamped
with a throwaway hash, and the new server kept that transform, so every load 504'd until a full restart.

## Decision

- `apps/team` is a **Svelte 5 + Vite single-page app** with client-side routing, served as static assets by its own
  Cloudflare **Worker** (`team` in each account), which also answers `/api/*` with JSON. It deploys to
  dev from `main`, and to production only at launch ([ADR 0010](0010-environments-and-deploys.md)).
- It binds the same D1 database as the website (`DB`); the schema stays in `db/`.
- **Mobile first.** The shell follows Gwenda ops: one route tree, five bottom tabs at ≤900px with safe-area insets, a
  collapsible rail on desktop. The last tab is You (your avatar): it always opens your profile, one page for everything
  that isn't a tab. You first: your card (which opens your account: Profile, Dues, your everyday role, Sign out), your
  details, your everyday role and your data; then Dues and the club's pages; then, for whoever can set things up,
  every Settings page grouped as the desktop's list. The Settings gear sits in its bar, top right, as beside the
  desktop's badge ([0065](0065-page-frame-and-admin-actions.md)); it opens Settings (a phone's list of them) and in
  your everyday role switches you up on the way ([0024](0024-action-based-authorization.md)). Its bar is titled You.
  Every page that isn't a tab's own has Back, named for the page it was opened from (Home → Unpaid fees → ‹ Home);
  opened from outside, to the page it belongs under (a settings page to Settings, the rest to You). Teammates is also
  a row on Home, so a member reaches the squad in one tap. Phones keep chrome slim: a 40px top bar, an opaque tab bar,
  no page subtitles.
- **A PWA**: manifest, icons and a service worker that caches the app shell. Screens that must work offline (the game
  clock) keep their data in IndexedDB and sync when there's signal.
- A store app, if we want one, wraps the same build with Capacitor (#26).
- CLAUDE.md's Astro rules apply to the website only. Shared rules (D1 through `packages/shared/d1.ts`, Europe/London dates,
  tests) apply to both.
- **The dev server bundles every library up front** (`apps/team/vite.config.ts`):
  - `optimizeDeps.entries` crawls every source file at startup, not just what `index.html` reaches.
  - `optimizeDeps.include` is every package in apps/team `package.json` **dependencies**, read from the file, so adding
    a library configures dev with no config edit. Svelte's entry points come from the Svelte plugin.
  - A browser library goes in `dependencies`, never `devDependencies`. `scripts/team-app-deps.test.mjs` fails
    `npm test` if the app imports a package that isn't there.
- **One dev server per checkout, run by the show switch** ([ADR 0115](0115-worktrees-and-the-show-switch.md)).
  `npm run team` shows this checkout on 4510 and starts its team app afresh on a private port; the switch never runs
  two in one checkout, so two never share the cache. A `vite` started by hand still takes over 4510 from another dev
  server (`scripts/lib/dev-server.mjs`, a pid file in `node_modules/.cache`) and refuses when the switch holds it.
  Vite's own restart is the same process and is let through.
- **After Vite restarts itself, every cached transform is dropped**, and requests wait until the dependency optimizer
  has read its cache (`waitForDepsCache` in `vite.config.ts`), so a reload during the restart can't keep a dead stamp.

## Consequences

- Two front-end stacks in one repo (Astro and Svelte); shared code must stay framework-free.
- The SPA installs to the home screen; it can't rely on server-rendered pages, so every screen loads data from `/api`.
- Workers' free tier counts each API call; static assets are free.
- On iPhone, a link opened from an email goes to Safari, not the installed app ([ADR 0023](0023-sign-in-and-sessions.md)
  works around this for sign-in).
- In dev, hot reload is unchanged; editing code never rebundles libraries. Installing a new library while the server
  runs still makes Vite rebundle once and reload the open page itself; that's expected, not the stale-cache failure.
  Cold start crawls all of `src`, a second or so more.
- To restart a dev server, run it again (`npm run team`): it replaces the running one. Never `--force`.
- After an in-process restart the first page load re-transforms the app's modules, a second or so.

## History

- 2026-10-06: The team app is a Svelte 5 SPA and PWA on its own Worker, sharing the website's D1 (0022).
- 2026-10-07: The dev server pre-bundles every dependency at startup and refuses a second server in the same
  checkout, after stale-bundle 504s (0047).
- 2026-10-08: Deployed to dev from `main` now that sign-in exists, not held back until launch (ADR 0010).
- 2026-10-09: Starting a dev server takes over its port instead of being refused, so whoever runs it owns it; after
  Vite restarts itself, cached transforms are dropped, after the same stale-stamp 504s from a reload during the restart.
- 2026-10-10: On phones the More tab became You (your avatar, opening your profile with the lists under it), replacing
  the account badge on Home; the top bar slimmed and the tab bar went opaque, as Android barely blurred it.
- 2026-10-11: The store app wraps this app as planned, loading the live app rather than a bundled copy ([0108](0108-store-apps.md)).
- 2026-10-20: The show switch runs the dev server on a private port and holds 4510 ([0115](0115-worktrees-and-the-show-switch.md)); `npm run team` goes through it.
- 2026-10-20: On phones Settings are listed on the You page, above your details, not behind a gear and a sheet, and
  the switch to your full role sits in its bar: an admin in their everyday role had to tap their card, switch up, then
  the gear to reach Settings.
- 2026-10-20: The You page's bar says You and its hints fit one line; Teammates got a row on Home, as a member had to
  go You → Club → Teammates to see the squad.
- 2026-10-20: You first on the You page, then the lists and Settings; the Settings gear is back in its bar (the
  Admin switch goes), opening a phone Settings page and switching you up on the way. Back goes to where you came from
  on every page that isn't a tab's own: from Home, Unpaid fees went back to Profile.
