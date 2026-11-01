# 0009. Site design: a Friday night on carbon, hockey and the Kumite (not the video shop), one-page navigation, no news

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-23
- **Merges:** 0011, 0114

## Context

The club is a tough, funny, friendly crowd: South London roller hockey meets a JCVD film, est. 1996, the pub
afterwards. Earlier designs were rejected as copied, gaudy, too busy, too sophisticated, or generic.

The site once had a News section (Studio type `post`, `/news/` pages, a "back page" on the home page). Nobody at the
club will write posts regularly, and a news page whose last post is a year old makes the club look dead.

The website started as a video shop: buttons as VHS spine labels with an "SP" box and a tracking glitch on hover, a
header clock in VCR modes (PLAY, PAUSE, FF), a blue "no signal" 404, share cards as paused tape. The team app dropped
the video shop on 2026-10-09 for irreverent hockey with Bloodsport and Van Damme; the website kept it, so the two
didn't match.

## Decision

- **Look:** dark carbon-fibre background, bone-white woodtype headings (Anton), logo red. Cream is an accent only
  (trading cards, the beer mat, the newsprint back page). The Kumite section goes "underground": darker, with an 80s
  fight-film poster.
- **One theme for both apps:** irreverent hockey and the Kumite (Bloodsport). No tape, rental or rewind words.
- **Structure:** the home page runs as a Friday night: 19:00 who we are, 19:30 Fridays, 21:30 the team, then the
  Kumite, events, videos (mostly Friday sessions) and a photo gallery.
- **The scoreboard is set in the poster capitals (Anton), not a VCR font:** the header clock, the hero's countdown to
  the next face-off (`lib/next-session.ts`) and the 404's penalty clock. No LED window, no red "recording" dot. The
  header clock follows the Friday night down the home page (Kit up, Face-off, Final whistle, the Kumite's --:--) and
  fades out after it: the menu already says which section you're in, and a word there would only repeat it. VT323
  stays only where it's the Kumite film's own screen (the poster's cut-in, the egg).
- **Buttons** are strips of stick tape: cream, slanted like the wordmark, straightening on hover; the main one logo
  red with claw marks. No SP box, no glitch: on hover a glint sweeps across the tape, like rink lights on fresh ice.
- **Between pages, a body check:** the page takes a hit and blurs off, and the next one slams in (a view transition
  in `global.css`). Reduced motion: neither, just the swap.
- **Not found** is two minutes in the penalty box: the clock counts down once, then says SERVED. No redirect.
- **The Kumite page keeps its fight-film poster**, scan lines and all: it's the film, not the shop.
- **An easter egg:** ↑↑↓↓←→←→BA anywhere rings the Kumite's gong (made in the browser, nothing fetched) and slams
  組手 in. Reduced motion: no flash or shake.
- **Share cards** follow ([ADR 0020](0020-drawn-share-cards.md)).
- **No news.** There is no Studio type, page or home section for it. Things that would have been news go where they
  belong: dates as **Events**, footage as **Videos**, pictures as **Photos**, and standing information in
  **Club details**.
- **Navigation:** for now every nav item scrolls to its section of the home page, from any page. Full pages are
  reached from each section's "see all" link.
- **Voice:** irreverent but welcoming. Ethos line: "Hooking, slashing or refusing to pass may result in being drafted
  first." Jokes never state club facts that aren't true. New copy reaches for hockey (face-off, penalty, sent off)
  and the Kumite, never tape.

## Consequences

- Colours are semantic tokens (`--paper`, `--text`, ...) with `.night` and `.newsprint` scopes, so sections can change
  palette. New sections need a `data-time` / `data-title` for the clock.
- Nothing on the site goes stale on its own: every section is driven by dated content (events, videos, photos) or by
  details that rarely change.
- If the club later finds someone to write, news comes back with a new ADR.
- The countdown only knows the weekly slot until What's on loads; then it follows the club calendar, so a called-off
  week is skipped.

## History

- 2026-10-05: The Friday-night home page on carbon, one-page navigation and the club's voice (was 0009).
- 2026-10-05: News removed (Studio type, `/news/` pages, home section); its content goes to events, videos, photos
  and club details (was 0011).
- 2026-10-20: The video shop retired on the website too; the scoreboard, penalty-box 404 and Kumite egg added (was
  0114).
- 2026-10-20: The scoreboard moved from VT323 to Anton (VT323 read as a VCR display); the header clock's words after
  the night (NEXT, REPLAY, SNAP) dropped for a fade (was 0114).
- 2026-10-20: Buttons get the ice shine on hover and pages a body check between them (picked from a side-by-side
  trial: impact frame, ice shine, claw rip; broadcast stinger, slash cut, body check) (was 0114).
- 2026-10-23: 0114 (the website's look) merged in: one topic, the website's design (#148).
