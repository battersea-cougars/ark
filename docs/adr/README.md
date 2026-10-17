# Architecture decision records

Short records of the decisions that shape the project: what we decided, why, and what it costs us. There is **one
record per topic** ([0001](0001-record-decisions.md)). Read the relevant one before changing how something works.

- **Changing a decision:** update its topic's record in the same change as the code. Rewrite what no longer holds,
  add a dated line to its **History**, and bump _updated_.
- **A new topic:** copy [template.md](template.md) and take the next unused number (the next is **0104**). Numbers are
  never reused.
- **An old number** (from a commit, an issue or a chat) that has no file any more was merged into another record.
  `grep -l 0035 docs/adr/*.md` finds it on that record's _Merges_ line.

## Process and platform

| #                                        | Decision                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [0001](0001-record-decisions.md)         | Record decisions here, one record per topic                                                                       |
| [0002](0002-secrets-in-bitwarden.md)     | Secrets live in Bitwarden, in two projects shared by every app; `.env` is local overrides only                    |
| [0003](0003-free-tiers-only.md)          | Free tiers only                                                                                                   |
| [0004](0004-astro-workers-sanity-d1.md)  | Astro on Cloudflare Workers, content in Sanity rebuilt daily, data in D1                                          |
| [0006](0006-one-repo-two-projects.md)    | One repo: the apps in apps/, shared code in packages/; the team generator runs in the browser                     |
| [0010](0010-environments-and-deploys.md) | Two environments on two Cloudflare accounts and two Sanity projects; `main` deploys dev, `release` production     |
| [0022](0022-team-app-svelte-pwa.md)      | The team app is a mobile-first Svelte 5 SPA on a Worker, as a PWA, with a dev server that bundles up front        |
| [0108](0108-store-apps.md)               | The team app in the app stores: a native shell loading the live app, with notifications; iOS first, Android-ready |
| [0031](0031-use-case-tests.md)           | Tests describe what people do, against a fake world                                                               |

## Data, privacy and staying free

| #                                            | Decision                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [0029](0029-personal-data.md)                | Personal data stays out of the repo, the roster is seeded from Secrets Manager, and nothing is kept longer than needed |
| [0050](0050-schema-and-seed-until-launch.md) | Until launch, the database is a schema and a seed, not migrations                                                      |
| [0106](0106-database-backups.md)             | The database is backed up nightly and before every schema change, sealed, kept 90 days as GitHub artifacts             |
| [0107](0107-announcements.md)                | Admins post announcements to the top of Home, until their last day or until each member dismisses them                 |
| [0053](0053-live-reads-are-cached.md)        | Live reads are cached the same way everywhere, and Sanity is read through its API CDN                                  |
| [0055](0055-degrade-instead-of-break.md)     | Degrade instead of break: circuit breakers, rate limits, the app's own brake and fallback content                      |
| [0059](0059-usage-page-and-check.md)         | Admins see the free Cloudflare allowance and CPU time, and are emailed at 80% or a stopped request                     |

## Security, sign-in and email

| #                                          | Decision                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [0023](0023-sign-in-and-sessions.md)       | Everyone signs in with an emailed code that works only in the browser that asked for it                    |
| [0024](0024-action-based-authorization.md) | Permissions are actions; roles are data built from actions; admins can view as a member or run as less     |
| [0036](0036-api-security.md)               | Every API response sends only what that caller may see, decided on the server, and every page is hardened  |
| [0095](0095-audit-log.md)                  | Each change declares what it puts on the audit log, on its route, and the log has a page in plain words    |
| [0027](0027-email-through-gmail-api.md)    | Email goes through the Gmail API; outside production it reaches only the safe inbox, admins and a dev list |
| [0028](0028-turnstile-and-auto-reply.md)   | Auto-replies only to people Turnstile verified, and capped                                                 |

## Website

| #                                                | Decision                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [0009](0009-site-design-direction.md)            | Site design: a Friday night, on carbon, one-page navigation, no news                                      |
| [0014](0014-sanity-public-content.md)            | Sanity holds the site's editable content; only club facts are editable                                    |
| [0016](0016-photos-and-videos-read-live.md)      | Photos and videos are read live on the Worker; videos are uploaded on YouTube, into labelled playlists    |
| [0020](0020-drawn-share-cards.md)                | Share pictures are drawn at build time                                                                    |
| [0042](0042-website-reads-the-club-agenda.md)    | The website's What's on and events page read one club agenda, live                                        |
| [0043](0043-roster-and-names.md)                 | The roster is a build-time snapshot of the club's members, and members go by their chosen name everywhere |
| [0100](0100-website-reads-tournament-results.md) | Tournament results are built into the website from D1; the team app rebuilds it when one changes          |
| [0101](0101-one-icon-for-both-apps.md)           | The website and the team app share one icon: the C of COUGARS, traced from the logo                       |
| [0109](0109-team-on-the-website-is-a-switch.md)  | The team's place on the website is a switch in the Studio, off until the team manager turns it on         |

## Team app: how it works

| #                                            | Decision                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [0057](0057-team-app-loading-and-changes.md) | Team app pages load when opened, the club is read in one statement, and a change replies with the parts it touched |
| [0072](0072-live-updates.md)                 | Live pages are pushed to over SSE from a Durable Object; polling at the admins' pace is the fallback               |
| [0065](0065-page-frame-and-admin-actions.md) | One page frame; admin actions live on the thing's own page, not under Settings                                     |
| [0084](0084-sticker-colour-scheme.md)        | The Sticker colour scheme: one yellow main button, red for the brand, tokens for everything                        |
| [0103](0103-drawers-sheets-and-panels.md)    | A side drawer for working beside the page, a sheet for a short job, a panel for a whole editor (proposed)          |
| [0104](0104-app-versions-and-updates.md)     | A version and a build id; when a newer build answers, the app offers a reload, never forces one                    |
| [0105](0105-code-grouped-by-feature.md)      | Code is grouped by feature; entry points read like a table of contents; files are `{domain}.{kind}.ts`             |

## Team app: the club

| #                                                | Decision                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [0069](0069-members.md)                          | Admins add members; the members table is in Settings; a member's details save with a button                      |
| [0030](0030-training-and-tournament-schedule.md) | The schedule lives in D1: training repeats as a series, tournaments are scheduled one by one and own their rules |
| [0076](0076-training-teams.md)                   | Training teams: a Session lead role, made by dragging, saved as you change them                                  |
| [0102](0102-balanced-teams-by-swap-search.md)    | Friday teams are balanced by a greedy deal and a swap search in the browser, not a linear programme              |
| [0007](0007-dues-and-payments.md)                | Dues are charges per session and tournament, paid by bank transfer with a name reference                         |

## Team app: tournaments

| #                                              | Decision                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [0074](0074-tournament-home-and-scheduling.md) | A tournament's home follows the day in three acts, and the next one is scheduled from it in a few questions |
| [0060](0060-the-draft.md)                      | A captains' draft is run by an admin, picked by its captains, and seen by members once it's closed          |
| [0061](0061-fixtures-games-and-scoring.md)     | The app makes a tournament's fixtures, and each game is scored live by one person on its own page           |
| [0044](0044-champions-and-awards.md)           | Awards are set in the team app; champions and winners come from the results, an admin confirms              |
