# 0009. The look: a Friday night on carbon, hockey and the Kumite; one yellow main button; tokens for every colour; one icon for both apps

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-11-02
- **Merges:** 0011, 0083, 0084, 0101, 0114

## Context

The club is a tough, funny, friendly crowd: South London roller hockey meets a JCVD film, est. 1996, the pub
afterwards. Earlier designs were rejected as copied, gaudy, too busy, too sophisticated, or generic. The website began
as a video shop (VHS spines, VCR clocks); the team app dropped it for irreverent hockey and Bloodsport, and the two
stopped matching.

The team app's colours had grown one at a time: red meant the brand, live, danger and a team; the main button had
been a red fill (read as an error), a cream fill (glared), a cream edge (read as grey) and framework blue. Browser tabs
and home screens show an icon at 16 to 512 px, where the full logo can't be read.

## Decision

**One theme for both apps: irreverent hockey and the Kumite (Bloodsport).** No tape, rental or rewind words.

- **The website**: dark carbon-fibre background, bone-white woodtype headings (Anton), logo red; cream is an accent
  only. The home page runs as a Friday night (19:00 who we are, 19:30 Fridays, 21:30 the team, then the Kumite,
  events, videos and photos), and every menu item scrolls to its section of it; full pages are reached from each
  section's "see all". The scoreboard (the header clock, the countdown to the next face-off, the 404's penalty clock)
  is set in Anton. Buttons are strips of stick tape. Between pages, a body check (a view transition; with reduced
  motion, just the swap). Not found is two minutes in the penalty box, with no redirect. The Kumite goes underground:
  darker, with its 80s fight-film poster. There's no news section: nothing on the site goes stale on its own.
- **Voice**: irreverent but welcoming; jokes never state club facts that aren't true; new copy reaches for hockey and
  the Kumite.
- **The team app: the Sticker scheme**, one system the whole app follows:
  - **Carbon and bone**: one warm ramp (OKLCH hue 70) for surfaces and ink, so greys and words belong together.
  - **Cougar red** is the brand: the logo, the title slash, section titles, the switch, live and danger. Red fills
    only an armed "are you sure" and a count on the dock.
  - **One action colour, sticker yellow** (`--action`), with carbon words, for the main button only: one per group,
    nothing else, so it always means "tap here". No floating buttons.
  - **Three statuses, one job each, always with a word**: success green, heads-up orange (`--caution`), live/danger
    red. **Six tones at one lightness** for trainings, tournaments and teams: crests, chips and dots, never a card fill.
  - **A chosen pick is lit in the brand red** with an icon and the title's slash; tabs are the club's italic capitals
    with the slash under the one you're on. Never a grey tile on a sunken track.
  - Colours live in `app.css` tokens; a component doesn't type a colour of its own. The brand document (Cougars
    Brand) holds the same values; change both together.
- **One icon for both apps**: the logo's own C, traced as a vector path (no font has it), white with its black
  outline on logo red, written into both apps by `scripts/favicons.mjs`. Change it there and re-run it; never edit the
  PNGs by hand.

## Consequences

- One look across the website, the app and the brand document; a new screen picks from the tokens.
- Yellow is loud, so the one-per-group rule matters: two yellow buttons in a row is a bug.
- The website's colours are semantic tokens with `.night` and `.newsprint` scopes, so sections change palette; a new
  home section needs a `data-time` / `data-title` for the clock.
- If the club later finds someone to write, news comes back with a new decision.
- The two apps can't be told apart by their tab icon; their titles do that. A new logo means tracing its C again.
