# Testing

Why we test this way: [ADR 0031](adr/0031-use-case-tests.md). The approach comes from Gwenda ops
(`gwenda-hackney/ark`, `docs/testing.md`).

## Running tests

Every test runs with **Vitest** from the root `vitest.config.ts`. Tests are found by glob, so a new `*.test.ts`
next to the code runs without editing config.

| Command                        | Runs                                |
| ------------------------------ | ----------------------------------- |
| `npm test`                     | everything                          |
| `npx vitest run apps/team`     | one project (any path filter works) |
| `npx vitest run -t "walk-in"`  | tests whose name matches            |
| VS Code test explorer (Vitest) | any file or single test             |

Before pushing: `npm run lint && npm test && npm run check -w @cougars/web && npm run check -w @cougars/team && npm run build`.

## Signed in, in a real browser

For a headless browser (Playwright, an agent's screenshots) against your own dev server, sign in without a code:

```sh
node scripts/dev-sign-in.mjs                    # the first admin
node scripts/dev-sign-in.mjs reg@example.com    # any active member
```

It writes `.auth/team.json` (ignored by git): open the browser with `newContext({ storageState: ".auth/team.json" })`.
Each run is a fresh session of its own, with no code and no caps, so it never signs you out or locks anyone out. Only
a local server answers it ([ADR 0023](adr/0023-sign-in-and-sessions.md)). Don't change shared local data to stage a
screen; pick a member who already shows it.

### Small screens

`scripts/small-screens.mjs` visits every team-app page (the route tree from `nav-routes.ts`, a couple of each kind)
and its main sheets, drawers and editor tabs in WebKit at phone widths, and lists what doesn't fit: the page scrolling
sideways, anything past the right edge, words cut short by an ellipsis, and small tap targets. Screenshots go to
`<out>/<width>/<page>.png` (the system's temp folder unless `--out`). It only opens things (never Keep score, In or
Save); a state that isn't in the local data (a game nobody's scoring, or one you're scoring) is faked in the browser's
copy of `/api/bootstrap`.

```sh
npm run app -- --private                      # prints your team port
node scripts/dev-sign-in.mjs --port <port>
node scripts/small-screens.mjs --port <port> [--widths 320,360,375] [--only game,schedule] [--out dir]
```

Overflow fails it (exit 1); ellipses, sideways scrollers (fine for the tab strip, a ticker, a big table) and small
targets are listed to judge by eye.

## Use cases first

The most important tests describe **what someone does** and check what they'd see and what reached the outside
world:

- "a member says they're in, and sees their place in the sign-up order"
- "the door adds a walk-in, and closing the register charges them the session fee"
- "someone joins on the website, and the club gets an email but they don't get two auto-replies"

They drive the **real Worker handlers** with a real `Request`, end to end. Put them next to the feature as
`use-cases.test.ts` (for example `apps/team/src/schedule/use-cases.test.ts`), named in plain words.

Function-level unit tests are for tricky pure logic where covering every case in isolation is easier: recurrence
rules, the team solver, standings, slugs, permissions. Don't add them by default.

Don't mock our own code. If a test needs to stub one of our functions, it's testing at the wrong level.

Which level checks what, feature by feature, and the overlaps found: [testing-map.md](testing-map.md).

## The fake world

`packages/shared/testing/fake-world.ts` gives each test a fresh world:

| Service        | Faked as                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D1             | In-memory SQLite with every migration applied (`packages/shared/testing/d1-sqlite.ts`)                                                   |
| Gmail API      | An outbox: `world.mail.sent()`                                                                                                           |
| Sanity         | Documents in memory, queried with groq-js (the real GROQ engine)                                                                         |
| YouTube        | Upload sessions and playlist items                                                                                                       |
| Turnstile      | A token list: tokens the test marks as passed verify, everything else fails                                                              |
| Google sign-in | An OAuth server that signs in whichever verified email the test chooses                                                                  |
| Passkeys       | `w.authenticator()`: a device's real keys (ES256, or RS256 for Windows Hello) signing real WebAuthn answers (`testing.authenticator.ts`) |

It replaces global `fetch` while installed. Any outside call it doesn't know **throws with its URL**: a new
integration shows up as a failing test, not a silent network call. Every world has fresh random secrets, so
module-level caches never carry one test's data into another.

```ts
const world = await createFakeWorld();
world.install();
const alex = await world.signIn("alex@example.com", { roles: ["Admin"] });
const res = await world.call(alex, "POST", "/api/training", { name: "Sunday Skills", weekdays: ["sun"] });
expect(res.status).toBe(201);
expect(world.db.all("SELECT held_on FROM training_sessions")).toHaveLength(12);
world.restore();
```

Give each area a small helper for the person doing it (`admin(world)`, `member(world, "Jo")`) with the actions
they take and a `sees()` for what's on their screen, so the test reads like the use case.

## Requests at once, and load

Two requests' statements interleave on D1 between their awaits; the fake D1 does the same when asked
(`w.db.interleave(seed)`), and each feature's `*.concurrency.use-cases.test.ts` fires requests together under several
seeds. Load runs against a Worker of your own (`npm run load -- friday-rush`, never dev or production). How, and what
they found: [load-testing.md](load-testing.md) ([ADR 0121](adr/0121-load-and-concurrency.md)).

## Journeys

Use cases stop at the API; **journeys** drive the real team app in a browser (Playwright, Chromium) through a whole
workflow, as each person in it, and check that each can do what needs doing at each step, and can't do what they
mustn't ([ADR 0124](adr/0124-test-levels.md): which check goes at which level). They live in `apps/team/journeys/`,
one `{workflow}.journey.ts` each; the first is the Kumite night (`kumite.journey.ts`: an admin, a player and a member
who isn't in it, from sign-up to the last award).

```sh
npm run journeys                    # in a worktree: a fresh D1, the team app on a private port, the journeys, stopped
npm run journeys -- --file-issue    # and a run with failures files one GitHub issue (label regression)
npm run journeys -- --keep          # leave the app up after, to look around (npm run app stop team)
```

It takes the checkout's own local D1 (`--own-db`) and starts it afresh every run, so it refuses the main checkout.
Failures don't stop the run: each failing step is in `.journeys/summary.md` (stage, role, expected and what
happened), with traces in `.journeys/run/` (`npx playwright show-trace …`). In CI (`.github/workflows/journeys.yml`,
by hand and on a push to `release`) a failing run opens one issue. A step that fails because of a known bug is
`knownBug(…)`, as `it.fails` is below.

## Known bugs

A use case that finds a real bug stays in the suite, written as `it.fails("… (known bug #N)", …)` with a comment
linking the issue. It still runs and doesn't fail the build, and it starts failing the day the bug is fixed. The
PR that fixes the bug changes it back to `it`.

## Older tests

Tests written before ADR 0031 are function-level. They stay until they're rewritten as use cases (see the GitHub
issue "Rewrite existing tests as use cases"); don't block new work on it.
