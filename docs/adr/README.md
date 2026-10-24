# Architecture decision records

Short records of the decisions that shape the project: what we decided, why, and what it costs us. There is **one
record per topic** ([0001](0001-record-decisions.md)). Read the relevant one before changing how something works.

- **Changing a decision:** update its topic's record in the same change as the code. Rewrite what no longer holds,
  add a dated line to its **History**, and bump _updated_.
- **A new topic:** copy [template.md](template.md) and take the next unused number (the next is **0127**). Numbers are
  never reused.
- **An old number** (from a commit, an issue or a chat) was merged into another record: since 2026-10-24 a merged
  record leaves a stub that says where it went; one with no file at all is on its record's _Merges_ line
  (`grep -l 0035 docs/adr/*.md`).

## Process and platform

| #                                             | Decision                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [0001](0001-record-decisions.md)              | Record decisions here, one record per topic                                                                       |
| [0002](0002-secrets-in-bitwarden.md)          | Secrets live in Bitwarden, in two projects shared by every app; `.env` is local overrides only                    |
| [0003](0003-free-tiers-only.md)               | Free tiers only                                                                                                   |
| [0004](0004-astro-workers-sanity-d1.md)       | Astro on Cloudflare Workers, content in Sanity rebuilt daily, data in D1                                          |
| [0006](0006-one-repo-two-projects.md)         | One repo: the apps in apps/, shared code in packages/; the team generator runs in the browser                     |
| [0115](0115-worktrees-and-the-show-switch.md) | One task, one worktree; one switch holds the user's ports and shows a checkout                                    |
| [0010](0010-environments-and-deploys.md)      | Two environments on two Cloudflare accounts and two Sanity projects; `main` deploys dev, `release` production     |
| [0112](0112-self-hosted-studio.md)            | The Studio is self-hosted on its own Worker, at studio.batterseacougars.com                                       |
| [0022](0022-team-app-svelte-pwa.md)           | The team app is a mobile-first Svelte 5 SPA on a Worker, as a PWA, with a dev server that bundles up front        |
| [0108](0108-store-apps.md)                    | The team app in the app stores: a native shell loading the live app, with notifications; iOS first, Android-ready |
| [0031](0031-use-case-tests.md)                | Tests describe what people do, against a fake world, at three levels: unit, use case, journey                     |
| [0110](0110-structured-logging.md)            | The apps log through scribe: one JSON line per event, nothing private in it, every error reported                 |

## Data, privacy and staying free

| #                                            | Decision                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [0029](0029-personal-data.md)                | Personal data stays out of the repo, the roster is seeded from Secrets Manager, and nothing is kept longer than needed |
| [0050](0050-schema-and-seed-until-launch.md) | Until launch, the database is a schema and a seed, not migrations                                                      |
| [0106](0106-database-backups.md)             | The database is backed up nightly and before every schema change, sealed, kept 90 days as GitHub artifacts             |
| [0107](0107-announcements.md)                | Admins post announcements to the top of Home, until their last day or until each member says "Got it"                  |
| [0053](0053-live-reads-are-cached.md)        | Live reads are cached the same way everywhere, and Sanity is read through its API CDN                                  |
| [0055](0055-degrade-instead-of-break.md)     | Degrade instead of break: circuit breakers, rate limits, the app's own brake and fallback content                      |
| [0059](0059-usage-page-and-check.md)         | Admins see the free Cloudflare allowance and CPU time, and are emailed at 80% or a stopped request                     |
| [0121](0121-load-and-concurrency.md)         | Requests at once are safe by statement, not luck; every invocation keeps to 50 subrequests; load: locally or on dev    |
| [0116](0116-sanity-requests-counted.md)      | We count our own Sanity requests, show and warn on them, and keep the last tenth of the CDN's for builds               |
| [0111](0111-errors-and-uptime.md)            | Errors and down alerts go to Sentry, with nothing about a person in them                                               |

## Security, sign-in and email

| #                                          | Decision                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [0023](0023-sign-in-and-sessions.md)       | Everyone signs in with a passkey or an emailed code that works only in the browser that asked for it       |
| [0024](0024-action-based-authorization.md) | Permissions are actions; roles are data built from actions; admins can view as a member or run as less     |
| [0036](0036-api-security.md)               | Every API response sends only what that caller may see, decided on the server, and every page is hardened  |
| [0095](0095-audit-log.md)                  | Each change declares what it puts on the audit log, on its route, and the log has a page in plain words    |
| [0027](0027-email-through-gmail-api.md)    | Email goes through the Gmail API; outside production it reaches only the safe inbox, admins and a dev list |
| [0028](0028-turnstile-and-auto-reply.md)   | Auto-replies only to people Turnstile verified, and capped                                                 |

## Website

| #                                                | Decision                                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [0009](0009-site-design-direction.md)            | Site design: a Friday night on carbon, hockey and the Kumite (not the video shop), one-page navigation, no news |
| [0014](0014-sanity-public-content.md)            | Sanity holds the site's editable content; only club facts are editable                                          |
| [0016](0016-photos-and-videos-read-live.md)      | Photos and videos are read live on the Worker: photos are the club's Instagram, videos its YouTube playlists    |
| [0020](0020-drawn-share-cards.md)                | Share pictures are drawn at build time                                                                          |
| [0042](0042-website-reads-the-club-agenda.md)    | The website's What's on and events page read one club agenda, live                                              |
| [0043](0043-roster-and-names.md)                 | The roster is a build-time snapshot of the club's members, and members go by their chosen name everywhere       |
| [0100](0100-website-reads-tournament-results.md) | Tournament results are built into the website from D1; the team app rebuilds it when one changes                |
| [0101](0101-one-icon-for-both-apps.md)           | The website and the team app share one icon: the C of COUGARS, traced from the logo                             |
| [0109](0109-website-sections-are-switches.md)    | The team and the Kumite are switches in the Studio, off until the team manager turns them on                    |

## Team app: how it works

| #                                              | Decision                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [0057](0057-team-app-loading-and-changes.md)   | Team app pages load when opened, the club is read in one statement, and a change replies with the parts it touched   |
| [0072](0072-live-updates.md)                   | Live pages are pushed to over SSE from a Durable Object; polling at the admins' pace is the fallback                 |
| [0065](0065-page-frame-and-admin-actions.md)   | One page frame; admin actions live on the thing's own page, not under Settings                                       |
| [0084](0084-sticker-colour-scheme.md)          | The Sticker colour scheme: one yellow main button, red for the brand, tokens for everything                          |
| [0103](0103-drawers-sheets-and-panels.md)      | A side drawer for working beside the page, a sheet for a short job, a panel for a whole editor; one sheet on a phone |
| [0117](0117-wizards-for-multi-step-creates.md) | A create that asks several questions is a wizard (lib/Wizard), a step at a time                                      |
| [0118](0118-home-calls-to-action-then-feed.md) | Home: a slim hello with what you owe, announcements, the calls to action, then a feed                                |
| [0104](0104-app-versions-and-updates.md)       | A version and a build id; when a newer build answers, the app offers a reload, never forces one                      |
| [0105](0105-code-grouped-by-feature.md)        | Code is grouped by feature; entry points read like a table of contents; files are `{domain}.{kind}.ts`               |
| [0125](0125-how-code-reads.md)                 | Code reads like the model: one job per file and function, early exits, domain names; warnings, never failures        |
| [0120](0120-team-app-first-paint.md)           | Home's first paint: the app imported up front beside the data, under a 100 kB JavaScript budget                      |

## Team app: the club

| #                                                | Decision                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [0069](0069-members.md)                          | Admins add members; the members table is in Settings; a member's details save with a button                      |
| [0030](0030-training-and-tournament-schedule.md) | The schedule lives in D1: training repeats as a series, tournaments are scheduled one by one and own their rules |
| [0076](0076-training-teams.md)                   | Training teams: a Session lead role, made by dragging, saved as you change them                                  |
| [0102](0102-balanced-teams-by-swap-search.md)    | Friday teams are balanced by a greedy deal and a swap search in the browser, not a linear programme              |
| [0007](0007-dues-and-payments.md)                | Dues are charges per session and tournament, paid by bank transfer with a name reference                         |
| [0122](0122-asked-about-clashes.md)              | Scheduling over something already on asks whether that's off; each is cancelled by its own cancel                |

## Team app: tournaments

| #                                              | Decision                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [0074](0074-tournament-home-and-scheduling.md) | A tournament's home follows the day in three acts, and the next one is scheduled from it in a few questions |
| [0060](0060-the-draft.md)                      | A captains' draft is run by an admin, picked by its captains, and seen by members once it's closed          |
| [0061](0061-fixtures-games-and-scoring.md)     | The app makes a tournament's fixtures, and each game is scored live by one person on its own page           |
| [0044](0044-champions-and-awards.md)           | Awards are set in the team app; champions and winners come from the results, an admin confirms              |
| [0119](0119-tournament-leaderboards.md)        | Leaderboards (points, goals, assists, PIM) are worked out in the app, a tab each, under the table           |
| [0123](0123-dev-only-tools.md)                 | A dev-only tool (the Kumite simulator) exists only where the environment says dev or local; else a 404      |
| [0126](0126-past-kumites-recorded.md)          | A Kumite from before the app is recorded in one go, done and in history, its awards out                     |
