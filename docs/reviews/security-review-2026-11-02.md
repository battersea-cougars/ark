# Security and edge-case review, 2 November 2026

The second pass of the pre-launch review's section 3 ([#201](https://github.com/battersea-cougars/ark/issues/201),
split from [#148](https://github.com/battersea-cougars/ark/issues/148)), on `main` at `05b020f`. The first pass,
[23 October](security-review.md), went through every route then; this one covers what's been added or changed since
(25 routes in the team Worker, the website's live routes and middleware), the first pass's open findings, secrets,
dependencies and edge cases. Code only, as before: nothing was sent to dev or production.

**Severity** as before: High, someone can do what their role shouldn't let them; Medium, a weakness that needs
something else to go wrong first; Low, a small gap or hardening; Info, worth knowing.

## Findings

| #   | Severity | Where                                           | What                                                                                                                                                                                                                                                                                                                                                 | State                                                                                           |
| --- | -------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | High     | `PUT /api/me/view-as`, `members/view-as.ts`     | View as a member (`impersonate:Member`, which ADR 0024 lets any role hold) let its holder view as anyone active, an admin included, and the API answers a view with the viewed member's actions: a role with only that action could read everything an admin may (every email and phone, payment references, ratings, the audit log, Sentry issues). | Fixed: the grant rule, at the start and on every request of the view (ADR 0024)                 |
| 2   | Low      | Website `/api/photos/:id` (first pass, 14)      | The edge cache was keyed on the whole URL, so `?x=1`, `?x=2` each fetched from Instagram.                                                                                                                                                                                                                                                            | Fixed: keyed on the path                                                                        |
| 3   | Low      | Website `astro.config.mjs` (first pass, 19)     | Astro's `checkOrigin` is the join form's only CSRF guard and was only Astro's default.                                                                                                                                                                                                                                                               | Fixed: said in the config                                                                       |
| 4   | Medium   | Dependencies (first pass, 3)                    | `npm audit`: 27 advisories reach what's installed for production (1 critical, 6 high), 46 with dev tooling. All are build or dev tools (Studio's dompurify, sharp and undici under miniflare, wrangler, js-yaml and smol-toml under the Sanity CLI, zod, eslint's minimatch); nothing a Worker runs.                                                 | Partly fixed in its own PR: `npm audit fix` (no breaking change) leaves 39, no critical, 3 high |
| 5   | Low      | `GET /api/members/:id/photo`                    | A photo is kept by the browser for a year (`immutable`, its address carries when it was set), so a member who's made inactive still shows on a phone that saw them, until its cache goes. The server stops sending it at once.                                                                                                                       | Open: fine as designed (ADR 0133); noted                                                        |
| 6   | Info     | View as a member's list (`pages/ViewAs.svelte`) | It lists everyone active; someone who isn't an admin, picking someone who can do more, is told no (finding 1) rather than not being offered them.                                                                                                                                                                                                    | Open: hide them, if a role other than Admin is ever given it                                    |

Each fix in the code has a test that failed before it.

### Still open from 23 October

Unchanged since the first pass, and still decisions rather than bugs: **2** (APNs and the retired Gmail client in
Bitwarden's dev project), **11** (a code guess checked against every live code), **12** (a team's look isn't
audited), **13** (error reports can spend the Sentry quota), **15** (`read:Audit` sees emails), **16** (a stolen
session can move the email; the old address is told) and **18** (ADR 0036's `quarterly` row).

## Checked and fine

- **The new routes** (the profile photo, view-as, the ledger, what nights and tournaments collected, the app link,
  past Kumites, Settings → Website, the tournament reads split from the bootstrap, the plan reminder, Sentry issues):
  each declares its action and is checked before the handler. The two-id and `:id` reads check the caller: a ledger is
  your own or needs to see everyone's dues; a tournament's reads are built for the caller (`editionOf(c, …)`), as the club
  read is. Every change declares its audit, or why not. Per-caller reads are tagged per member (and per viewer
  while viewing), never kept by the browser.
- **The photo upload** (`PUT /api/me/photo`): a body limit of its own (301 KB), only PNG, JPEG or WebP `data:` URLs
  up to 300 KB, no SVG; served with its own type and `nosniff`, so nothing in it can run; shown only to who may see
  the member; cleared when they're erased; refused while viewing as someone.
- **The email change** (`POST /api/me/email`): codes hashed, five tries counted before the check in one statement,
  five codes an hour and ten a day, the same reply whether the address is taken or not, other sign-ins ended, the
  old address told.
- **The dev clock** (`x-dev-now`): read only where the simulator is, and on dev only from an admin; production never
  reads it.
- **The website's live routes and middleware**: the headers come from one place for each environment; the join form,
  error and CSP reports keep their body limits and rate limits; Turnstile's action is checked.
- **Secrets**: none of the new routes returns or logs a token; Sentry issues are read with a read-only token kept server-side.
- **Clock changes** (London): the date code goes through `packages/shared` London conversions, and the training,
  sign-up, recurrence, calendar and Home tests already cross both changes; no code reads the machine's own zone.
- **Long names**: every name the API takes has a cap (members 200, a sign-up 80, a team 40 to 60).
- **Erased members**: become "Former member", with no email, phone, photo, bio or reference; their history stays by
  id. Putting one on a team is a 404 (first pass, 17).

## Not checked here

How long names and huge lists look on a phone, offline and poor signal, reduced motion and screen readers are
checked by eye or with the journeys' axe run (`npm run journeys -- --a11y`, docs/reviews/accessibility-performance.md);
they weren't run for this pass.

## Also found while here (navigation)

- On a phone, **Back didn't close what was open**: the member's sheet and a player's card couldn't hear it at all,
  and the native sheets only where the browser sends Back to a dialog. Back now closes the top overlay everywhere
  (`lib/back.ts`, ADR 0065).
- The Kumite wizard's **captain search opened its list behind the phone's keyboard**: it was placed by the window,
  which runs on behind the keyboard. It's placed by what's on screen now (`lib/menu-place.ts`).
