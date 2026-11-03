# Architecture decision records

Short records of the architecturally significant decisions: how the project is built, what it runs on, and the rules
that cut across all of it. One record per topic, saying what holds today ([0001](0001-record-decisions.md)). Read the
relevant one before changing how something is built.

- **Changing a decision:** rewrite its record in the same change as the code and bump _updated_. No History lines:
  git and the pull requests are the trail.
- **A new architectural topic:** copy [template.md](template.md) and take the next unused number (the next is
  **0135**). Numbers are never reused.
- **A product or behaviour rule** (who's charged, when sign-up opens, what a page shows) isn't an ADR: it's a use-case
  test, and a line in the feature folder's `README.md` linking it ([below](#feature-notes)).
- **The why of a piece of code** is a comment beside it.

## Process, structure and platform

| #                                                    | Decision                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [0001](0001-record-decisions.md)                     | Architecture decisions here, one record per topic; product rules live with their feature's tests                |
| [0006](0006-one-repo-two-projects.md)                | One repo: the apps in apps/, shared code in packages/; the team generator runs in the browser                   |
| [0105](0105-code-grouped-by-feature.md)              | Code is for people to read: by feature, entry points as tables of contents, `{domain}.{kind}.ts`, one job each  |
| [0031](0031-use-case-tests.md)                       | Tests describe what people do, against a fake world, at three levels: unit, use case, journey                   |
| [0115](0115-worktrees-and-the-show-switch.md)        | One task, one worktree; one switch holds the user's ports and shows a checkout                                  |
| [0134](0134-a-fresh-clone-runs-after-npm-install.md) | A fresh clone runs after npm install: no secrets, no magic environment variables, outside services faked or off |
| [0010](0010-environments-and-deploys.md)             | Two environments on two Cloudflare accounts and two Sanity projects; `main` deploys dev, `release` production   |
| [0002](0002-secrets-in-bitwarden.md)                 | Secrets live in Bitwarden, in two projects shared by every app; `.env` is local overrides only                  |
| [0003](0003-free-tiers-only.md)                      | Free tiers only: routes stay far under them, races are settled in the statement, admins hear before a limit     |
| [0055](0055-degrade-instead-of-break.md)             | Degrade instead of break: circuit breakers, rate limits, the app's own brake and fallback content               |
| [0110](0110-structured-logging.md)                   | The apps log through scribe, one JSON line per event; errors and down alerts go to Sentry; nothing private      |

## Data and privacy

| #                                              | Decision                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [0050](0050-schema-and-seed-until-launch.md)   | The database: a schema and a seed until launch, migrations after; backed up nightly and before every change        |
| [0029](0029-personal-data.md)                  | Personal data stays out of the repo, the roster is seeded from Secrets Manager, nothing is kept longer than needed |
| [0053](0053-how-the-team-app-gets-its-data.md) | Live reads cached the same way everywhere; the team app reads the club in parts, by version; live pages over SSE   |

## Security and sign-in

| #                                          | Decision                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [0023](0023-sign-in-and-sessions.md)       | Everyone signs in with a passkey or an emailed code that works only in the browser that asked for it         |
| [0024](0024-action-based-authorization.md) | Permissions are actions; each response sends only what its caller may see; every change declares its audit   |
| [0027](0027-email-through-gmail-api.md)    | Email goes through the Gmail API, only to the safe inbox outside production; Turnstile guards the open doors |

## The website

| #                                             | Decision                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [0004](0004-astro-workers-sanity-d1.md)       | Astro on a Worker; club facts in Sanity, rebuilt daily or on request; the Studio on its own Worker        |
| [0016](0016-how-the-website-gets-its-data.md) | Photos, videos and the agenda read live on the Worker; the roster and results built in from D1            |
| [0009](0009-site-design-direction.md)         | The look: a Friday night on carbon, hockey and the Kumite; one yellow main button; one icon for both apps |

## The team app

| #                                            | Decision                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [0022](0022-team-app-svelte-pwa.md)          | A mobile-first Svelte 5 SPA on a Worker, as a PWA, with a version and a build id and a dev server that bundles up front |
| [0108](0108-store-apps.md)                   | In the app stores: a native shell loading the live app, with notifications; iOS first, Android-ready                    |
| [0065](0065-page-frame-and-admin-actions.md) | One page frame; admin actions on the thing's own page, in a drawer, sheet or panel; wizards for multi-step creates      |

## Feature notes

Each feature's rules, in plain words, each linking the use-case test that proves it:

- Team app: [training](../../apps/team/worker/training/README.md), [the calendar](../../apps/team/worker/calendar/README.md),
  [dues](../../apps/team/worker/dues/README.md), [tournaments](../../apps/team/worker/tournaments/README.md) (the
  draft, awards, scoring), [members](../../apps/team/worker/members/README.md),
  [announcements](../../apps/team/worker/announcements/README.md), [Home](../../apps/team/src/pages/README.md),
  [Settings](../../apps/team/worker/settings/README.md) (Usage, the audit log, dev tools, errors, keeping data),
  [the website's side](../../apps/team/worker/website/README.md).
- The website: [its pages](../../apps/web/src/README.md), [the join form](../../apps/web/src/lib/server/README.md).

## Where old numbers went

A number from a commit, an issue or a chat that isn't a file here was merged into a record (its _Merges_ line lists
it) or its rules moved to a feature's notes:

| Old                                                                                                                                      | Now                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0059, 0063, 0116, 0121                                                                                                                   | [0003](0003-free-tiers-only.md); the Usage page's rules in the Settings notes                                                                                                       |
| 0014, 0018, 0020, 0109, 0112, 0132                                                                                                       | [0004](0004-astro-workers-sanity-d1.md); the switches' rules in the website notes                                                                                                   |
| 0102                                                                                                                                     | [0006](0006-one-repo-two-projects.md); what the team maker balances in the training notes                                                                                           |
| 0011, 0083, 0084, 0101, 0114                                                                                                             | [0009](0009-site-design-direction.md)                                                                                                                                               |
| 0123                                                                                                                                     | [0010](0010-environments-and-deploys.md); the simulator's rules in the Settings notes                                                                                               |
| 0015, 0019, 0039, 0040, 0042, 0043, 0045, 0062, 0085, 0100, 0113                                                                         | [0016](0016-how-the-website-gets-its-data.md); what the site shows in the website notes                                                                                             |
| 0104                                                                                                                                     | [0022](0022-team-app-svelte-pwa.md)                                                                                                                                                 |
| 0036, 0092, 0095, 0098, 0099                                                                                                             | [0024](0024-action-based-authorization.md); the audit log page in the Settings notes                                                                                                |
| 0028                                                                                                                                     | [0027](0027-email-through-gmail-api.md); the auto-reply's rules in the join form notes                                                                                              |
| 0106                                                                                                                                     | [0050](0050-schema-and-seed-until-launch.md)                                                                                                                                        |
| 0041, 0054, 0057, 0072, 0081, 0120                                                                                                       | [0053](0053-how-the-team-app-gets-its-data.md)                                                                                                                                      |
| 0078, 0103, 0117                                                                                                                         | [0065](0065-page-frame-and-admin-actions.md)                                                                                                                                        |
| 0125                                                                                                                                     | [0105](0105-code-grouped-by-feature.md)                                                                                                                                             |
| 0111                                                                                                                                     | [0110](0110-structured-logging.md)                                                                                                                                                  |
| 0124                                                                                                                                     | [0031](0031-use-case-tests.md)                                                                                                                                                      |
| 0007, 0026, 0032, 0034, 0038                                                                                                             | [the dues notes](../../apps/team/worker/dues/README.md)                                                                                                                             |
| 0030, 0025, 0046, 0048, 0049, 0051, 0052, 0076, 0079, 0131                                                                               | [the training notes](../../apps/team/worker/training/README.md) and [the calendar notes](../../apps/team/worker/calendar/README.md) (0030's tournament parts: the tournament notes) |
| 0122                                                                                                                                     | [the calendar notes](../../apps/team/worker/calendar/README.md) (clashes) and the training notes (nights off)                                                                       |
| 0044, 0060, 0061, 0064, 0066, 0067, 0068, 0070, 0071, 0073, 0074, 0086, 0087, 0088, 0089, 0090, 0091, 0119, 0126, 0127, 0128, 0129, 0130 | [the tournament notes](../../apps/team/worker/tournaments/README.md)                                                                                                                |
| 0069, 0080, 0082, 0133                                                                                                                   | [the members notes](../../apps/team/worker/members/README.md); photos kept in D1: [0003](0003-free-tiers-only.md)                                                                   |
| 0107                                                                                                                                     | [the announcements notes](../../apps/team/worker/announcements/README.md)                                                                                                           |
| 0118                                                                                                                                     | [the Home notes](../../apps/team/src/pages/README.md)                                                                                                                               |
