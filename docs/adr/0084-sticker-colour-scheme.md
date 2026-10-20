# 0084. The Sticker colour scheme: one yellow main button, red for the brand, tokens for everything

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-20
- **Merges:** 0083

## Context

The team app's colours had grown one at a time. Red was the brand, "live", danger, the focus ring and a team colour;
green was in, paid and a team colour; amber was heads-up and a team colour. The six schedule and team tones were picked
by eye at different weights, about thirty literal colours sat outside the tokens (the trading card, the Draft, Game),
and three calls to action were red fills.

The main button (`.btn.primary`) had been through a red fill (lost among the brand's red titles, read as an error), a
cream fill (glared on the dark page), a cream edge on a faint cream wash (read as grey, not prominent enough) and solid
VCR blue (stood out, but looked like a web framework's default). It needs a colour of its own that means nothing else.

Three whole schemes were compared on the same screen in the brand document (Cougars Brand): Sticker, Signal (indigo)
and One red.

## Decision

The **Sticker** scheme, one system the whole app follows:

- **Carbon and bone**: one warm ramp (OKLCH hue 70) for surfaces (`--bg`, `--surface-1..3`) and ink (`--fg`,
  `--fg-body`, `--fg-muted`, `--fg-subtle`), so greys and words belong together.
- **Cougar red** (`--red`, `--red-hot` for words) is the brand: the logo, the title slash, section titles, the switch,
  live, and danger. Red fills only an armed "are you sure" and a count on the dock.
- **One action colour**: the website's sticker yellow (`--action: #ffd60a`, `--action-hover: #ffe03d`) with carbon
  words (13.8:1), for the main button only: one per group, nothing else. It doesn't mark state, links or anything
  else, so it always means "tap here". Every main-button look uses it: `.btn.primary`, the one in a bar and the Draft's
  Pick when pointed at. No floating buttons: a page's add (+ Event, + Rate) sits in its bar on a phone as on a
  desktop, so the poster title stays the one loud thing and nothing covers the page. One exception, for one person:
  the team maker's Make teams on a training is a solid bar above the tabs on a phone, the page keeping room for it so
  it covers nothing ([0076](0076-training-teams.md)). The calls to action that were red fills (Watch a live game,
  Go to the draft on your turn, End turn) are main buttons.
- **A disabled main or outline button gives up its colours**: a faint edge and `--fg-subtle` words, so it never seems
  live (`.btn:disabled` alone sat above the kinds at the same weight).
- **Three statuses, one job each, always with a word**: success green (in, paid), heads-up orange (`--caution`, so
  yellow means only "tap here"), live/danger red.
- **Six tones at one lightness** (OKLCH 0.74) for trainings, tournaments and teams: crests, chips and dots, never a card
  fill. The red tone is coral, so a team never looks live.
- **A chosen pick is lit in the brand red, as the switch is**: one of a few (Position, Plan, How they paid) is
  separate solid tiles with icons, the chosen one a red wash with a `red-hot` icon and the title's red slash under it;
  tabs are the club's italic capitals with the slash under the one you're on. Never the old sunken track with a grey
  tile (black on black on grey, no icon, no accent), never a yellow or solid red chosen tile. The brand document's Pick
  and Tabs show them.
- `--primary` (cream, the logo's white half) is ink on red only: the kanji seal and the tournament stamp.
- **The trading card** keeps its printed colours as tokens (`--card-stock`, `--card-ink`, `--card-band`).
- Colours live in `app.css` tokens; a component doesn't type a colour of its own.

## Consequences

- One look across the app and the brand document; a new screen picks from the tokens.
- Yellow is loud, so the one-per-group rule matters: two yellow buttons in a row is a bug.
- `--amber*` is now `--caution*`.
- The brand document (Cougars Brand) holds the same values; change both together.

## History

- 2026-10-08: The main button became solid VCR blue (`--action: #1f5eff`, from the website's 404 screen), after red,
  cream and cream-edge versions; disabled main buttons lost their look; cream kept as ink on red (was 0083).
- 2026-10-08: The Sticker scheme replaced it: the main button became sticker yellow, the whole palette moved to one
  warm ramp, one red, three statuses and six tones as tokens, and amber became caution (was 0084).
- 2026-10-09: Pick (red-lit tiles with icons) and Tabs (italic capitals, the red slash) replaced the segmented control.
- 2026-10-10: The floating action button went: Calendar's + Event and Fees' + Rate moved into the phone bar, as on a
  desktop; a yellow button always over the page shouted on every scroll and covered cards.
- 2026-10-20: The team maker's Make teams docks above the tabs on a phone, in a bar with room kept for it, not over
  the page: the night's job for one person, where the thumb is.
