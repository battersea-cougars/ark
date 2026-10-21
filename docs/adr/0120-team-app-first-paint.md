# 0120. Home's first paint: the data and every file it needs are asked for at once, under a JavaScript budget

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Chrome DevTools rated the team app's Largest Contentful Paint (LCP) on Home 5.51 s, poor, on 4510. That is the Vite
dev server ([0022](0022-team-app-svelte-pwa.md)): about two hundred unbundled modules, so it overstates. Measured
honestly (the build served by `wrangler dev` on its built Worker, signed in, Playwright, a 412 px phone, a cold cache,
Chrome's own presets with 4x CPU slowdown; median of five):

| Home's LCP                 | Unthrottled | Fast 4G | Slow 4G |
| -------------------------- | ----------- | ------- | ------- |
| Dev server (4510's kind)   | 0.57 s      | 5.0 s   |         |
| Built, before              | 1.67 s      | 2.72 s  | 4.36 s  |
| Built, after               | 0.45 s      | 1.20 s  | 2.31 s  |
| Built, repeat visit before |             | 1.85 s  | 2.05 s  |
| Built, repeat visit after  |             | 0.73 s  | 1.14 s  |

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

- **The data first**: `index.html` preloads `/api/bootstrap` (`as="fetch" crossorigin`, the same request
  `main.ts`'s `fetch` makes, which picks the reply up). A 401 is picked up the same way, for sign-in.
- **The first screen in one wave**: a build step (`firstScreen` in `vite.config.ts`) adds a `modulepreload` for every
  chunk Home's first paint needs (`FIRST_SCREEN`: Svelte's `mount`, `App`, the routes, the page loader, `Home`, and
  their imports) and a style preload for their CSS. Fetched and parsed beside the data, run only when `main.ts`
  imports them, after the data, as before. A name in the list that matches no chunk fails the build.
- **A budget**: the same step fails the build when the first screen's JavaScript passes **100 kB gzipped** (76 kB
  when set). Over it: load what Home doesn't need at once with `import()`, or raise it there with a reason.
- **The lead card lands from opacity 0.01**, not 0: it looks the same, and Chrome counts it from the frame it lands
  in.
- **Hashed files are kept a year**: `public/_headers` gives `/assets/*` `public, max-age=31536000, immutable`; the
  page keeps `max-age=0, must-revalidate`, so a deploy shows at once.

## Consequences

- Slow 4G with a cold cache is now about 2.3 s, under 2.5 s; Fast 4G 1.2 s; a repeat visit about 1 s. `wrangler dev`
  serves HTTP/1.1 (six connections, forty-odd small files queue), so a deploy on HTTP/2 should be a little faster.
- Every page opened from a link also fetches Home's files (about 20 kB gzipped); the sign-in screen fetches the
  app's. Cheap beside the trips saved.
- A repeat visit's splash paints about 0.15 s later (the service worker answers the forty-odd preloads first); the
  page itself is up sooner.
- The dev server is still slow (4 s on Fast 4G, unbundled modules); judge LCP on a build, not on 4510.
- Left: Home's live check (`checkForUpdates`) reads `/api/bootstrap` again as it starts, right after the app did
  (a 304, but a request); the variable Inter Tight face is 44 kB.

## History

- 2026-10-21: Measured and decided as above.
