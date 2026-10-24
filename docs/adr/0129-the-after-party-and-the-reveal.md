# 0129. The after-party: the awards confirmed, then revealed one at a time on a stage of their own

- **Status:** Accepted
- **Date:** 2026-10-22 · updated 2026-10-24

## Context

"The evening a Kumite ends: the last step should be the after party. Something in theme with The Anchor in mind. The
admin reveals the award winners one at a time." (the user, 2026-10-22). Who wins each award, and how it's decided and
confirmed, is [0044](0044-champions-and-awards.md); the tournament's page and its statuses, of which the after-party is
the last, are [0074](0074-tournament-home-and-scheduling.md). This record is the evening itself: the after-party's view,
the awards' stage and the reveal. It was part of 0074 until 2026-10-24.

## Decision

- **The after-party** ("The evening a Kumite ends: the last step should be the after party", the user, 2026-10-22)
  starts when the last match is played (or an admin marks it finished) and lasts till 06:00 London the next morning
  (`atAfters` in `lib/edition.ts`, `londonEvening` in `lib/dates.ts`: before 06:00 it's still the night before's
  evening). All that time the series' page is still on it, even with the next one scheduled (`currentOf`); then it moves
  on to the next one or "No Kumite yet", and it's in History. Results typed in on another day, or a tournament with only
  a season, go straight to history. Home's hero is its card ("At The Anchor · awards", the awards so far), ahead of
  everything else, as it's on now (`lib/home-feed.ts`, lead kind `afters`).
- **The after-party's view** (`lib/AfterParty.svelte`) is the pub after the film's last match: brass on the carbon (a
  warm glow in place of the red, award names in brass), the motif kept (賞 beside the awards, 優勝 beside the final table).
  **Two steps** (ADR [0044](0044-champions-and-awards.md)). First the awards are confirmed: everyone who played sees
  **Cast your vote** (on the KUMITE! day too, once the last match is done) while voting's open; whoever runs it
  (`manage:Tournament`) confirms them. Then **the reveal**, on the awards' own page. The view has where everyone is,
  then **The awards**, one big card (`lib/AwardsEntry`): for whoever runs it, till they're confirmed, **Confirm the
  awards** (how many have voted for each voted award, what's still to choose, the judges' call; opening the drawer), for
  everyone else Waiting for the reveal; then where the reveal's at; and the way to the page. Then the final table
  (`lib/BoardTable`, with the stats we track: played, won, drawn, lost, goal difference, points; the champions first,
  with their ink stamp, then the final's loser, then the table: `finalOrder` in `lib/afters.ts`), and the day's results,
  a line a match. The page follows the live hub all evening, as it does a match (ADR [0072](0072-live-updates.md)).
- **The awards' page** (`/tournaments/:slug/awards`, `pages/Awards.svelte`; its way back the Kumite) is a stage ("lets
  do a full page for the awards", the user, 2026-10-23): **one card, centred, big** (`lib/AwardStage`), the award now,
  its size fixed, in a room the finale's size from the start, so nothing round it moves and nothing scrolls. Sealed: the
  award's confirmed name big in brass (the judges' call's name tonight included), what it's for, and over the winner's
  area the 封 ("sealed") hanko, big, red, worn ink, askew (a series without the motif: a "?"). Under the card, whoever
  runs it has one button (`cueOf` in `lib/afters.ts`): Confirm the awards (the same drawer) till they're confirmed, then
  **Reveal** (a tap on the sealed card too), **Next award** once it's out, nothing after the last; everyone else's place
  says **Waiting for the reveal**, with Cast your vote under it till they're confirmed. **The reveal:** the seal beats
  like a heart, twice, then its ink drains away, patchy, from the edges in (the "?" fades in its place); then the winner
  (a team's crest and name, or a player's name and their team) rolls into the winner's area alone, clipped to it, a
  short motor's roll (slow to start, quicker, a knock as it stops), the award's name staying put; then the 賞 hanko lands
  (`lib/HankoPress`, the draft's seal with its ink specks). **Next award** dissolves the card (fading, a touch of blur)
  as the next zooms in from small and faint, landing with a little overshoot, its name settling a beat after, sealed. A
  judges' call left out as they confirm (ADR [0044](0044-champions-and-awards.md)) isn't on the stage, nor counted: the
  reveal is the awards given, in order (`awardsToReveal`). **The champions** (the award the table decides, by
  `decidedBy`, wherever the admin lists it: the reveal keeps their order, the Kumite's champions last) are the finale: a
  bigger card, ringed in brass, the crest and name a size up; its button says **The champions**, and on it the page
  darkens round the card and one gong ring of brass goes out from it, a bigger, heavier seal beats twice and drains
  away, slower, "And your Kumite champions…" holds over the winner's area a moment longer, the crest and name roll in,
  heavier, 優勝 slams down, and the dark eases out to a warm brass glow. **After the last**, once its beat's landed (the
  button's place coming back says so), the end: the champions the hero, on the stage as their finale left them (wherever
  they're listed; the last out, if it wasn't them, dissolving as they come back up; no champions award, no hero); every
  other award under them a smaller card (`AwardStage` `small`, one card look) in a grid, face up, in the admin's order,
  a big tie's names in full; then the final table and the day's results, as the after-party has them
  (`lib/FinalResults`, shared). Live, these fade in after the beat, nothing scrolled to; opened late or reloaded, it's
  all there at once. The same for everyone. Every beat plays from the change of state (`beatOf`: sealed to face up is
  the reveal, face up to the next sealed is Next award), so every phone sees the same moments; opened late, reloaded, or
  a step missed, it's just where it is, nothing replayed; the button stays under the card, dimmed and untappable while
  the beat plays, lit once it's landed. Every beat's timing is one block (`lib/award-reveal.css`: keyframes and custom
  properties: the dissolve, the zoom, the heartbeat, the fade, the delay after it, the roll, the hanko, the champions'
  line, the spotlight), to tune or swap. Reduced motion: crossfades only, no heartbeat, ring, roll or zoom, the
  champions' line still shown.
- **Revealing is the server's** (`tournaments.awards_revealed`, how many are out, and `awards_next`, the stage moved on
  to the next, sealed; `drumOf` in `lib/afters.ts`, the card it shows): `POST /api/tournaments/:id/awards/reveal { next
}` names the award the tap saw sealed, by its place in the list; `POST /api/tournaments/:id/awards/next { at }` moves
  on, `at` how many were out. Only once the last match is played and the awards are confirmed (409 otherwise); each one
  `UPDATE` guarded on the count and the card where the tap saw them, so a double tap or two phones at once move it once,
  the second tap finding it moved and doing nothing (ADR [0121](0121-load-and-concurrency.md)); a tap from a page
  further behind is refused. On the record as `tournament.award_revealed` (how many out, which one) and
  `tournament.award_next`. **A member isn't sent an award's winner on its evening until it's revealed** (the club read's
  `viewer` has the evening and who runs tournaments, as the blind draft keeps its picks); from 06:00 every winner is
  history. The first one out tells everyone with the app, once ("Awards at The Anchor", topic `announcements`); the rest
  they see on the page.

## Consequences

- Every phone in the pub sees the same beat at the same moment, because each beat follows the server's state, not a tap;
  a phone that opens late or reloads is just where it is.
- The timings are one stylesheet (`lib/award-reveal.css`), so tuning the drama is one file, not a hunt.
- A winner can't leak on the night: the Worker holds each one back from members until it's revealed, until 06:00.

## History

- 2026-10-22: A sixth status, the after-party, from the last match till 06:00; its view in brass; revealing is the
  server's (`awards_revealed`), guarded and audited, the first out pushed once (was in 0074).
- 2026-10-23: The awards come up one at a time, the admin tapping the sealed card to reveal it.
- 2026-10-23: The after-party is two steps, confirm then reveal (ADR 0044); the reveal is one card, a drum, every phone
  following.
- 2026-10-23: The awards get a stage of their own (`/tournaments/:slug/awards`): the admin's button under one card, Next
  award dissolving it and zooming in the next, the champions a darkened finale; timings in `award-reveal.css`.
- 2026-10-23: The reveal keeps the admin's order; a judges' call left out isn't revealed (`awardsToReveal`).
- 2026-10-23: The stage's end: the champions the hero, the rest in a grid, then the final table and results.
- 2026-10-23: The button stays in place, dimmed, while a beat plays; after Next award it wakes once the card lands.
- 2026-10-23: A finished Kumite's page shows the awards won (`lib/AwardsWon`).
- 2026-10-23: The sealed card's "?" is the 封 hanko, its ink draining away after its heartbeat (a crack was too literal).
- 2026-10-23: The after-party is the evening its last match kicked off, not its date's (`playedOn`).
- 2026-10-23: The last award out, it's Done, and the page stays its results till the morning after.
- 2026-10-24: Split out of ADR 0074, which had grown to cover the whole tournament.
