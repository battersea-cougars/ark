# Accessibility and performance

The pre-launch pass (#148, section 8), 2026-10-23: both apps checked with axe (WCAG 2.1 AA plus axe's best practice)
and the keyboard, then measured for first load. What was found, what was fixed, what was left and why, and the
numbers before and after. Run it again before a release that changes how pages look or load.

## How to check

- **axe over the team app's whole Kumite night**: `npm run journeys -- --a11y` (in a worktree). The journey runs as
  usual, and at the end of each stage axe looks at every person's page (admin, player, member, captains);
  `.journeys/a11y.md` lists what it found, stage by stage. It never fails the run.
- **axe over single pages** (the rest of both apps): `@axe-core/playwright` is a root devDependency. Sign in with
  `node scripts/dev-sign-in.mjs [email] --port <team port>`, open the page with that storage state, and run
  `new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze()`.
  Check at a phone's width (390) and a desktop's (1366): the dock, the corners and the drawers differ.
- **First paint budget** (team app): `node scripts/team-app-budget.mjs` after a build (the build runs it).
- **Lighthouse** on a production build: `npm run build -w @cougars/web`, then
  `npx wrangler dev -c dist/server/wrangler.json --port <any free port>` in apps/web; for the team app,
  `npx wrangler dev -c dist/cougars_team/wrangler.json --port <port> --var TEAM_ENV:local --persist-to ../web/.wrangler/state`
  in apps/team, signed in with `dev-sign-in.mjs --url` and the cookie passed as `--extra-headers`. Then
  `CHROME_PATH=<Playwright's chromium> npx lighthouse <url> --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage"`.
  Lighthouse's mobile run (slow 4G, a mid phone): the times are simulated, so compare runs, not absolutes.

## Pages checked

- **Team app**, as an admin and as a member, phone and desktop: Home, Friday (Training), the Kumite at every stage
  (sign-up, the order drawn, the draft, teams and fixtures, the matches live, the vote, the reveal, done), its
  history and awards, Calendar, the club and a player's card, You, Your tab, Settings, Members, Fees, the Locker
  room; with sheets and drawers open (post a note, Manage on Friday and the Kumite, a player's card, Change on You).
- **Website**: home, Fridays, join, privacy, results, the Kumite, and the What's on piece the home page fetches.

## Fixed

### Team app

- **The quietest words on carbon** (`--fg-subtle`, `#75716b`, 3.7:1 on a panel) were used for real words, not only
  placeholders: the Kumite's stages ahead, a session's venue. Now `#8a857f`: 4.5:1 on a field, 4.9:1 on a panel,
  5.3:1 on carbon, still a step under `--fg-muted`. The brand book's token wants the same change.
- **Cancelled on Home** was the club's red on a grey badge (3.8:1): now the red ink badges use (`--red-ink`).
- **A cancelled session's Cancelled badge** was dimmed with the rest of its card (2.9:1): the details still step
  back, the badge saying why doesn't.
- **Take down in the Locker room** was a browser-default grey button (2.1:1): now words, as on Home.
- **Names that hid what a control shows**: a day field and a drop-down were named only by their label ("Last day"),
  not the day chosen; now "Last day: Fri 30 Oct 2026". A match's link was "Game 1", hiding the time or the score;
  now "Game 1: 2–1". Out, pressed, said "Take back your Out" over the words "I'm out"; now it says I'm out, pressed,
  with the hint as its title.
- **A team's record** (1-0-0 · 3 Pts) put a label on a plain span, which screen readers drop: the words are now
  screen-reader text.
- **Skip to the page**: the first thing the Tab key reaches (hidden till then), past the dock and the corners.
- **Focus kept across pages**: a link inside a page used to drop the keyboard back at the top of the document when
  its page left; now focus goes to the new page. Focus in the dock or the tabs stays where it is.
- **Choose, then Yes, in the draft**: chosen from the keyboard, focus goes on to Yes (the drawer's on a phone, the
  bar's on a desktop) instead of the long way round the rest of the pool. A pointer's tap is unchanged.
- **Reveal**: its button is made again for each award, and pressing it from the keyboard used to lose focus; now
  focus goes on to Next award, The champions, and the way back at the end.
- **The search field** showed almost no change when focused; now the app's fields' red edge and wash.

### Website

- **Fridays**: the first-night steps' headings (h3) sat straight under the page's h1; "Your first Friday" is now
  their h2, looking exactly as before.

### Checked and fine

Sheets and drawers are modal dialogs: focus moves in, stays in, and Escape returns it to the button that opened them
(checked on Home's note, Friday's and the Kumite's Manage, the draft's player drawer). Every page has its landmarks
and a page title; reduced motion turns off the animations in both apps (the team app's global rule and scripted
motion, the website's reveals, the Kumite egg and the cards); visible focus rings throughout, including the player
cards and the seal button, which ring their visible part.

## Left, and why

- **Decoration that axe reads as words**: the big 組手 behind "No Kumite yet" (surface-3 on carbon, on purpose a
  ghost), the hanko seals, a losing team's crest letters. All `aria-hidden` and decorative, which WCAG exempts.
- **A cancelled session's venue** (Calendar): dimmed with its card, as a called-off session is meant to read. The
  Cancelled badge carries the meaning at full contrast.
- **Label-in-name on cards and avatars**: a player card's button is named "Cal Jarvis: turn the card over" while the
  card shows the number, first name and position; the avatar's initials aren't in "You: Dan Scalamogna"; the
  website's What's on → is named "Ask about Friday Training". The name starts with what a speech user would say;
  axe's rule (experimental) compares all the card's text.
- **Heading order on desktop Friday**: the session card's h3 comes without an h2 between (on a phone there is one).
  Changing EventCard's heading level touches every page that uses it; not worth it for a moderate best-practice rule.
- **The simulator's chosen speed** (red on its bar, 4.0:1): a dev-only tool.
- **The stage track mid-stamp**: axe caught a badge during its stamp-in animation; at rest it's 5.3:1.

## Performance

### Team app

The first paint was already in shape (ADR 0120): the two faces preloaded, the club's data fetched beside the app's
files, a splash in the HTML, pages loaded on demand and warmed when the phone is idle, Members' grid only on
Members. The budget is 100 kB of JavaScript, gzipped.

What changed: **a tournament's editor panel left the Kumite's pages**. Games, Draft, the draft room, Awards, the
teams and the draft's status all imported the panel (and its wizard, date editor and quick questions) just to reach
`editTournament`. Which one is open now lives in `lib/tournament-panel.svelte.ts`; the panel is fetched only for
someone who can edit a tournament.

| What, gzipped                                  |         Before |          After |
| ---------------------------------------------- | -------------: | -------------: |
| First paint (JS, `team-app-budget.mjs`)        |        93.1 kB |        93.6 kB |
| The Kumite page on top of first paint, JS      |       108.7 kB |        79.8 kB |
| The Kumite page on top of first paint, CSS     |        35.8 kB |        29.4 kB |
| Awards on top of first paint, JS / CSS         | 71.2 / 19.5 kB | 42.2 / 13.2 kB |
| The draft room on top of first paint, JS / CSS | 71.3 / 21.8 kB | 36.1 / 14.3 kB |

Lighthouse, mobile, production build, as a member (performance, accessibility; LCP; bytes):

| Page       | Before                     | After                      |
| ---------- | -------------------------- | -------------------------- |
| Home       | 91, 96; LCP 3.4 s; 300 kB  | 90, 100; LCP 3.4 s; 300 kB |
| The Kumite | 79, 100; LCP 5.5 s; 498 kB | 81, 100; LCP 5.1 s; 454 kB |
| Calendar   | 85, 100; LCP 4.3 s; 386 kB | 85, 100; LCP 4.3 s; 391 kB |

As an admin (who still loads the editor): Home 90, Friday 92, the Kumite 78–79, Calendar 84–86, between runs.
CLS is 0 (Home 0.008) everywhere; total blocking time under 110 ms.

Left: the Kumite's LCP is the big 組手, painted once its 7 kB face arrives (`font-display: swap`; preloading it would
cost every other page). The Kumite page still carries the Draft (15 kB) outside the draft; loading it on demand
would show the draft a beat late when the page opens on it, which the no-layout-shift rule argues against.

### Website

Already fast: every page prerendered, the faces self-hosted and preloaded, images sized and lazy below the fold, the
hero logo eager with high priority. Lighthouse, mobile, production build (performance, accessibility; LCP; bytes):

| Page    | Score    | LCP   | Bytes  |
| ------- | -------- | ----- | ------ |
| Home    | 96, 100  | 2.7 s | 258 kB |
| Fridays | 99, 100  | 2.1 s | 170 kB |
| Join    | 91, 100  | 3.5 s | 314 kB |
| Privacy | 100, 100 | 1.7 s | 167 kB |
| Results | 99, 100  | 2.0 s | 170 kB |

What changed: the club's logo for search engines (the home page's structured data) pointed at the 1.3 MB original
PNG, shipped only for that; it's a 512px copy now (222 kB). No page loads it, so the scores don't move.

Left: Join's LCP is its heading's reveal (the page's entrance), not a download; Turnstile is most of its bytes.
Five small stylesheets block the first render (about 150 ms simulated); inlining them would repeat them in every
page. The hero logo is one 720px file; a smaller one would only reach phones under 2x, which few are.
