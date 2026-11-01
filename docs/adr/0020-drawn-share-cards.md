# 0020. Share pictures are drawn at build time

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-20

## Context

A shared link (WhatsApp, Facebook, iMessage) showed the same picture for every page: the club logo on black. Events
without a cover photo, the Kumite and Fridays all looked identical in a chat. Hand-made images per page would go stale
as soon as a time, venue or event changes, and the team manager shouldn't have to make them.

## Decision

- Every page's `og:image` is a 1200×630 card drawn at build time like the rink's scoreboard: a red
  scoreboard line (the session time or event date), the page title in Anton, the red label and the cougar's head
  (`lib/og.ts`, served from the prerendered `pages/og/[...card].png.ts`).
- Cards use only facts the site already shows: the session day and time, the venue and the founding year from
  the Studio, and the event title, date and place. A page picks its card with `<Base card="…">`; the default is the
  home card.
- A page with its own photo (an event's or album's cover) shares that photo instead.
- `satori` lays the card out with the site's fonts (a TTF copy of Anton, which satori needs instead of
  WOFF2) and `sharp`, already used for images, makes the PNG. Both run only in the build (Node, ADR 0004's
  `prerenderEnvironment: "node"`); neither is in the Worker.

## Consequences

- A new event or a changed session time gets a matching card at the next build (ADR 0004), with nothing to upload.
- Server-rendered pages (/videos, /photos) use the prebuilt section cards, so they can't have per-request cards. We
  don't need those.
- About 1 second of build time per 10 cards, and roughly 80–100 KB per card in the static assets.
- The two TTF files (OFL, licences beside them in `src/assets/fonts/`) must stay in step with the WOFF2 files if a
  font ever changes.

## History

- 2026-10-06: Share pictures are drawn at build time.
- 2026-10-20: The VHS frame (PLAY ▶, SP, scan lines) became a scoreboard line ([ADR 0009](0009-site-design-direction.md)).
- 2026-10-20: The scoreboard line is in Anton, red, without the light; VT323 and its TTF copy dropped.
