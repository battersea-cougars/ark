# 0114. The website's look is hockey and the Kumite, not the video shop

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The website started as a video shop: buttons as VHS spine labels with an "SP" box and a tracking glitch on hover, a
header clock in VCR modes (PLAY, PAUSE, FF), a blue "no signal" 404, share cards as paused tape. The team app dropped
the video shop on 2026-10-09 for irreverent hockey with Bloodsport and Van Damme; the website kept it, so the two
didn't match.

## Decision

- **One theme for both:** irreverent hockey and the Kumite (Bloodsport). No tape, rental or rewind words.
- **The scoreboard stays** (the VT323 font): the header clock, which follows the Friday night down the home page
  (Kit up, Face-off, Final whistle, then NEXT, REPLAY, SNAP), the hero's countdown to the next face-off
  (`lib/next-session.ts`), and the 404's penalty clock.
- **Buttons** are strips of stick tape: cream, slanted like the wordmark, straightening on hover; the main one logo
  red with claw marks. No SP box, no glitch.
- **Not found** is two minutes in the penalty box: the clock counts down once, then says SERVED. No redirect.
- **The Kumite page keeps its fight-film poster**, scan lines and all: it's the film, not the shop.
- **An easter egg:** ↑↑↓↓←→←→BA anywhere rings the Kumite's gong (made in the browser, nothing fetched) and slams
  組手 in. Reduced motion: no flash or shake.
- **Share cards** follow ([ADR 0020](0020-drawn-share-cards.md)).

## Consequences

- New copy reaches for hockey (face-off, penalty, sent off) and the Kumite, never tape.
- The countdown only knows the weekly slot until What's on loads; then it follows the club calendar, so a called-off
  week is skipped.

## History

- 2026-10-20: The video shop retired on the website too; the scoreboard, penalty-box 404 and Kumite egg added.
