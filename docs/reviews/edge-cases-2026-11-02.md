# Edge cases, 2 November 2026

The pre-launch review's edge cases ([#148](https://github.com/battersea-cougars/ark/issues/148) section 3, and
section 8's accessibility pass again; [#181](https://github.com/battersea-cougars/ark/issues/181)'s "Edge cases"
line): the clocks changing in London, taps at once, empty and huge lists and long names on a phone, members who've
left, poor signal, reduced motion and screen readers. On `main` at `884b33d`, in the team app (the website's edges
were in the [security review](security-review-2026-11-02.md)). Each fix has a test that failed before it; what's
left is filed.

## How it was checked

- **Use cases** for what the Worker decides (the clocks, taps at once), in the fake world with seeded interleavings
  (ADR 0031, ADR 0121).
- **A new journey**, `apps/team/journeys/edge-cases.journey.ts`: a double tap, a 60-letter name on a 360-wide phone,
  and a tap with no signal, in a real browser (docs/testing.md).
- **A local club with years behind it** (`npm run seed:history`: four played Kumites, twenty weeks of Tuesday Skills,
  charged and part paid) on my own D1, with one member's name made 60 letters long and his email 79, one who'd scored
  made inactive and one erased; then every page walked at 320 and 375 wide (`scripts/small-screens.mjs`, as admin)
  and the history read as a plain member.
- **`npm run journeys -- --a11y`**: every journey, with axe over everyone's page at the end of each stage.

## Fixed

| What                                                                                                                                                                                                                                                                                                                                                                     | Where                                                                                             | The test that failed first                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A double tap recorded money twice.** Record payment, Adjust and Charge on a member's Dues, and Post it on Home, sent a second request while the first was on its way: a slow signal and a second tap made two payments of £5, or two notes in the locker room. Each now waits for its first send; the button is disabled.                                              | `lib/MemberSheet.svelte`, `pages/Home.svelte`                                                     | `edge-cases.journey.ts` › 1: "sees one payment on Gwen's ledger, not two" (2 before), "sees it posted once" (2 before)                                                 |
| **A tap with no signal said "Failed to fetch"** (Safari: "Load failed"), the browser's words. Now: "No network: that didn't reach the club. Try again when you've a signal." Still known as offline, so never reported to Sentry.                                                                                                                                        | `app/api.ts`                                                                                      | `edge-cases.journey.ts` › 3: "taps In with no signal: told it didn't go, and In isn't shown as hers"                                                                   |
| **A tap with no signal still showed you in.** In and Out change the card at once and the server's word follows; with no signal the answer failed, and so did the refresh that would have put the card right, so it went on saying "You're in · number 2" with In pressed, a place the server never heard of. Now an answer that doesn't go puts the card back as it was. | `lib/EventCard.svelte`                                                                            | `edge-cases.journey.ts` › 3: "…and In isn't shown as hers" (after the calendar journey, In pressed)                                                                    |
| **A long name pushed a team off the screen.** On a game's page, a 60-letter name in a team's roster widened the whole list past a 320 phone's edge, the positions of everyone on that team with it (the roster's grid track grew to fit the name). Now one column that never grows past the page; the name ends in "…".                                                  | `pages/Game.svelte`                                                                               | `small-screens.mjs` at 320: `ol.squad-list` past the edge (right = 539)                                                                                                |
| **A member's ledger ran past a phone's card**: six columns (What, Charged, Paid, Owes, Take back) are 57 px too wide at 320 and 2 px at 375, so Take back sat half off. On a phone, Charged and Paid share one column, Amount (a payment's in green beside its £ chip, as before), and Take back comes in.                                                               | `lib/Ledger.svelte`                                                                               | `small-screens.mjs` at 320 and 375: the Dues tab's body scrolling sideways (377 > 320)                                                                                 |
| **Past midnight on the nights the clocks change**: a night that ends after midnight was ended 24 hours after its end time on the day before, an hour out on the night the clocks go back (25 hours) or forward (23): a clash question's window, and a one-off saved from the Calendar ending 2am, ended at 1am or 3am.                                                   | `@cougars/shared/london.ts` `londonNextDay`; lib and Worker `clashes.ts`; `pages/Calendar.svelte` | `london.test.ts` "is 25 hours across the clocks going back and 23 across them going forward"; `clashes.test.ts` "hours past midnight on the nights the clocks change…" |

Also: the journeys' listener now lets Chrome's own "net::ERR_INTERNET_DISCONNECTED" line through as harmless (only a
step that takes the signal away makes it).

## Checked and fine

### The clocks changing in London

Already covered before this pass, and read again: London's dates and times (`packages/shared/london.test.ts`),
training nights' recurrence across both changes, the register closing at 06:00 the morning the clocks go back, quiet
hours ending at 08:00 GMT and BST, the 10am plan reminder the morning they go forward, the hourly cron (keyed by UTC
hour, so London's 01:00–02:00 coming twice is two hours, each run once), announcements' last day, a fee from the
Sunday they go back, the Kumite's evening past midnight, and the journeys' clock stages (fridays › 4, 11; kumite
clock › 8, 9). Added:

- **Sign-up opening the Monday after each change** (`training.signup-opens.use-cases.test.ts`, "the Monday after the
  clocks change"): after they go back, 23:30 UTC on the Sunday is still Sunday, refused; 00:00 UTC is Monday, taken.
  After they go forward (28 March 2027), 22:59 UTC refused, 23:00 UTC (midnight BST) taken. Sign-up opens by London
  day (`londonToday`), so it can't drift.
- **The register closing the morning the clocks go forward** (`training.register-closes.use-cases.test.ts`): a
  Saturday night's register takes a tick at 04:59 UTC and refuses at 05:00 UTC, 06:00 BST.
- Nothing runs in London's missing hour (01:00–02:00 on the last Sunday of March): no job is set for it, and a time
  typed into it reads as the hour before (`londonISO`).

### Taps at once

The training night's rush was covered (30 for 20 places, keepers, Quarterly members bumping, a freed place, a double
tap, out twice). Added, each under five interleavings (`entries.concurrency.use-cases.test.ts`):

- **Two people tap the last place at once**: one has it, the other is first to wait, both answered 200, nobody twice.
- **A club event's one place**: two members and a double tap at once; and the one going drops out as another taps
  in: the one who was waiting gets it, the newcomer waits.

Double-submits elsewhere: every other form that creates something saves through the editor's Save bar, which is
disabled while it saves (the Calendar's one-off, venues, trainings, tournaments, a team's look, bank details, your
profile); Add a member already guarded itself; a quarterly rate from a date is an upsert; a quip clears its field
as it sends.

### Empty and huge lists, long names

`small-screens.mjs` over every page and its sheets at 320 and 375 as an admin, on the club with years behind it and
the 60-letter name: apart from the two fixed above, nothing past the edge. Names cut with "…" where a card or row has
no room (The club's card shows the first word, the draft and game rows end in "…"), which is the design; sideways
scrollers only where meant (the tab strips, Settings → Members' grid). A 60-letter name and a 79-character email fit on
The club, Friday, the member's card and Settings → Members (`edge-cases.journey.ts` › 2). The empty states (a club
with no Kumite yet, nothing on, nothing owed) are what the journeys' fresh database opens on (`pages.journey.ts`).
The Worker's limits with big lists were the load tests' (docs/load-testing.md).

### Members who've left

An erased member keeps the club's records ("Former member": the money, the nights, the goals) and their places to
come go to whoever's waiting (`members.erase`, `members.edge-cases` use cases). Read as a plain member on the seeded
history: the leaderboard and Unpaid fees say "Someone who's left"; past nights read well; the audit log says
"Someone" for an actor it can't name. **Not fine:** goals, assists, penalties and awards on a past Kumite leave a
blank where a member who's left was ("Goal" with no scorer, "Assist ·" with nothing after), and the game's rosters
drop them: filed as [#220](https://github.com/battersea-cougars/ark/issues/220) (the word belongs in one place,
`lib/names.ts`, which is #153's tidy-up). Admins see the name, or "Former member".

### Poor signal and offline

The service worker (#115, `app/service-worker.test.ts`) opens the kept shell after 1.5 s without signal and keeps the
network's when it comes; API calls are never cached. A tap with no signal: the save note says so and the card goes back
to what the server last said (both fixed above), and nothing retries by itself: the next
tap, or the page's own check once signal's back, catches up (`app/catch-up.test.ts`). With signal back the same tap
takes (`edge-cases.journey.ts` › 3).

### Reduced motion and screen readers

`npm run journeys -- --a11y` twice (`.journeys/a11y.md`), then axe again at rest on the pages it flagged, signed in on
a private app with reduced motion on:

- **Reduced motion**: with the phone's setting on, no animation is still running two and a half seconds after a page
  opens (Home, Friday, the Kumite and its history, Calendar, The club, Settings, Unpaid fees, Fees: none running), as
  the 23 October pass found.
- **Contrast**: at rest, the only failure left is the big 組手 behind "No Kumite yet" and on the Kumite's pages, a
  ghost on purpose and `aria-hidden` (left in the [23 October pass](accessibility-performance.md)). What else axe
  flagged during the journeys changes from run to run (Settings' side list on Unpaid fees and Fees, a sheet's
  checkboxes, a game card's venue): it caught them mid-animation, as a page or sheet arrives, and they pass once it's
  settled. Also as left before: a cancelled one-off's dimmed details, the simulator's chosen speed (dev only), a losing
  team's crest letters.
- **Screen readers**: label-in-name on the player cards and avatars (left before, on purpose: the name starts with
  what a speech user would say); `html-has-lang` and `document-title` are axe reading a person's tab before it's
  opened a page (`about:blank`), not the app. The failed save note is an `alert`, so a screen reader hears "No
  network…" as it appears; a done one is a `status`.
- Focus order, labels and the skip link were the 23 October pass's and haven't changed.

## Left, and filed

- [#220](https://github.com/battersea-cougars/ark/issues/220) Someone who's left reads as a blank on the Kumite's
  history (above).
- [#221](https://github.com/battersea-cougars/ark/issues/221) `scripts/small-screens.mjs` can't load the app's routes
  under Node (an extensionless import), and WebKit can't be installed in the devcontainer: this pass ran it through
  `npx jiti` with Chromium at phone sizes.
- **The journeys** (full run, with this branch): every journey but three passes. Fridays' register is the known
  failure on `main` ([#214](https://github.com/battersea-cougars/ark/issues/214)), unchanged. Fees and the Kumite on
  the clock each failed one step in some runs and not others, a different step each time (a page that didn't load in
  time, `net::ERR_ABORTED`), and Fees fails alone too, without this journey before it: timing on a busy machine, not
  this change.
