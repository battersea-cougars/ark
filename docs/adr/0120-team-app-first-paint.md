# 0120. Home's first paint: the app is imported up front, beside the data, under a JavaScript budget

- **Status:** Accepted
- **Date:** 2026-10-21 · updated 2026-10-24

## Context

Chrome DevTools rated the team app's Largest Contentful Paint (LCP) on Home 5.51 s, poor, on 4510. That is the Vite
dev server ([0022](0022-team-app-svelte-pwa.md)): about two hundred unbundled modules, so it overstates. Measured
honestly (the build served by `wrangler dev` on its built Worker, signed in, Playwright, a 412 px phone, a cold cache,
Chrome's own presets with 4x CPU slowdown; median of five; the two builds served side by side, so under the same load):

| Home's LCP                  | Unthrottled | Fast 4G | Slow 4G |
| --------------------------- | ----------- | ------- | ------- |
| Dev server (4510's kind)    | 0.57 s      | 5.0 s   |         |
| Built, before               | 1.56 s      | 2.47 s  | 2.73 s  |
| Built, after                | 0.26 s      | 0.94 s  | 2.04 s  |
| Built, repeat visit, before |             | 1.85 s  | 2.05 s  |
| Built, repeat visit, after  |             | 0.32 s  | 0.36 s  |

(A busier machine earlier in the day had the build before at 2.72 s and 4.36 s on Fast and Slow 4G.)

Three things were in front of it:

- **A chain of three trips.** `main.ts` reads `/api/bootstrap` before it imports the app (the store reads the data as
  it loads), and the fetch only started once the entry and its imports had run. Only then did the browser learn of
  `App`; once that ran, of `pages.svelte.ts`; then of `Home` and its parts. On Slow 4G: data at 0.8 s, the app's files
  at 1.1–1.9 s, Home's at 2.0–2.5 s, the greeting painted at 2.7 s.
- **A subliminal that counted.** Home's lead card lands from opacity 0 (a composited animation), and Chrome never
  counts what first paints at opacity 0 there. In's "PRESS ME" band (`EventCard`, a mask animation, so a repaint)
  first repainted the card's button 1.3 s after landing, and that hidden text became the LCP: in most runs the
  metric was the page's real paint plus 1.3 s.
- **Hashed files revalidated on every visit**: the asset layer's default `max-age=0, must-revalidate` for
  `/assets/*` too (the service worker covers installed apps, not a browser's first visits).

The bundle was already split well: every page is its own chunk (`app/pages.svelte.ts`, [0057](0057-team-app-loading-and-changes.md)),
loaded in the background when idle; ag-grid (190 kB gzipped) only on Members; Sentry after the data. Fonts were
preloaded with `font-display: swap`. The splash paints before any script.

## Decision

- **The data first**: a one-line inline script at the top of `index.html` starts `fetch("/api/bootstrap")` and leaves
  the promise on `window.cougarsBootstrap`; the app's first `getBootstrap` (`app/api.ts`) takes it, once, and reads
  the reply through the same path as any other (the brake, the ETag, the version and build headers). If that read
  failed (no network), the app asks itself, so a failure reads as before. A 401 is picked up the same way, for
  sign-in. It matters: a module's body runs only once its static imports are in, so without it the fetch would wait
  for the app's files. Not a `<link rel="preload" as="fetch">`: Safari (WebKit, our members' phones) fetched the
  preload and then fetched again for the app, two reads of the whole club on every open. The policy allows exactly
  that script by its hash (`script-src 'self' 'sha256-…'`, in `worker/index.ts` and `public/_headers`);
  `api.security.test.ts` fails when the script changes and the hash doesn't. Vite leaves an inline classic script as
  it is, so the built page has the same hash.
- **The splash goes at once if it never painted**: when the data and the files are both quick, the app mounts before
  the splash's first frame, no fade runs and no `transitionend` comes; `main.ts` removes it straight away rather than
  leaving it, unseen, over the page until the 400 ms fallback. A fading splash lets taps through.
- **Importing the app reads no data.** The store (`demo/store.svelte.ts`) starts empty and the session
  (`demo/session.svelte.ts`) starts as nobody in particular; `start()` (`app/backend.svelte.ts`) fills both once the
  data's in: `hydrate`, then the store's copy of every slice (as after a reload), then `startSession` (who you're
  viewing as, your everyday role). So `main.ts` imports `mount`, `App` and the router statically and awaits the data
  before it mounts, not before it imports.
- **Home is part of the app**: a static import in `app/pages.svelte.ts`, where the app opens; every other page stays an
  `import()`. Vite's own `modulepreload` links (build.modulePreload) then fetch the whole first screen with the entry,
  in one wave, and its stylesheets are linked in the page. Nothing in our config lists files. The sign-in screen and
  Sentry stay `import()`s.
- **A budget**: `scripts/team-app-budget.mjs`, run by the team app's `build` script (so by `pr.yml` and the deploy's
  build), follows the build manifest (`build.manifest`) from the entry through its static imports and fails past
  **100 kB gzipped** (76 kB when set). Over it: load what Home doesn't need at once with `import()`, or raise it there
  with a reason. `public/.assetsignore` keeps the manifest off the site.
- **The lead card lands from opacity 0.01**, not 0: it looks the same, and Chrome counts it from the frame it lands
  in.
- **Hashed files are kept a year**: `public/_headers` gives `/assets/*` `public, max-age=31536000, immutable`; the
  page keeps `max-age=0, must-revalidate`, so a deploy shows at once.

## Consequences

- Slow 4G with a cold cache is now about 2.0 s, under 2.5 s; Fast 4G about 0.9 s; a repeat visit about 0.35 s.
  `wrangler dev` serves HTTP/1.1 (six connections; thirty-odd files queue), so a deploy on HTTP/2 should be a little
  faster.
- Every page opened from a link also fetches Home (about 20 kB gzipped). The sign-in screen fetches the whole app,
  once per device. Cheap beside the trips saved.
- Home's stylesheets block the splash's first paint now (about 13 kB in all, not 6): on Slow 4G the splash shows at
  about 1.1 s, not 0.9 s; the page itself is up sooner.
- A module that reads the club's data as it loads would see it empty: read it in a function, a `$derived` or a
  component, never at a module's top level. Only the store and the session did.
- A file missing after a deploy now fails the entry itself, not a later `import()` (`stale-code`'s reload covers only
  those); both come from the same page, which is never cached, so they match.
- The dev server is still slow (4 s on Fast 4G, unbundled modules); judge LCP on a build, not on 4510.
- Left: the variable Inter Tight face is 44 kB. Home's live check (`checkForUpdates`) no longer reads
  `/api/bootstrap` again as it starts, right after the app did: a page opening within 10 seconds of the club being
  read doesn't check ([0072](0072-live-updates.md)).

## History

- 2026-10-21: Measured and decided as above. First a build step in `vite.config.ts` listed the first screen's
  modules and added preloads for them; replaced the same day: a hand-kept list of paths breaks quietly when files
  move, and the cause was the app reading its data as it loaded, so that went instead, and Vite preloads on its own.
- 2026-10-21: Home's second read of `/api/bootstrap` as it opens is gone: a live page opening within 10 seconds of
  the club being read doesn't check again (#112, [0072](0072-live-updates.md)).
- 2026-10-21: The bootstrap is read by an inline script, not a preload link: in WebKit the preload was never reused,
  so every open read the whole club twice (Chromium reused it). Measured on the build (`wrangler dev`, signed in,
  Playwright, an iPhone 13 profile, cold cache, the two builds served side by side and opened in turn, on a busy
  machine): bootstrap reads on open, WebKit 2 -> 1, Chromium 1 -> 1; WebKit, the median of ten, LCP 770 -> 542 ms and
  the splash gone 632 -> 313 ms; Chromium with 4x CPU on Fast 4G, the median of six, LCP 1.98 -> 1.77 s (this machine
  runs slower than the table above's; compare the pairs). With the reply sooner, WebKit mounted before the splash
  painted, so the splash sat unseen over the page for 400 ms: it now goes at once when no fade runs, and lets taps
  through while fading. (The WebKit runs need the date fix of the same day, dates built from their parts: before it,
  Home showed "Can't reach the club's data" in WebKit.)
- 2026-10-24: The Kumite simulator (dev only, ADR 0123) is loaded only where it is: its floating control is an
  `import()` behind the bootstrap's `simulator`, and its store and runner moved out of the backend to
  `app/simulation.svelte.ts`. With opening the app reading its pages' parts (#178, ADR 0053), first paint is 99.8 kB
  (101.1 kB before the move).
