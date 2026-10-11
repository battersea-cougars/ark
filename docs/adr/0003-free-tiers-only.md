# 0003. Free tiers only

- **Status:** Accepted
- **Date:** 2026-10-05 (decided at project start) · updated 2026-10-09

## Context

A volunteer-run club pays for this. The old team manager ran a Python solver on a paid server.

## Decision

Every service runs on a free tier: Cloudflare Workers, D1, Cron Triggers and SQLite-backed Durable Objects, Sanity
Free, Bitwarden Secrets Manager Free, GitHub Actions, YouTube for video. The only planned cost is a domain (about £10
a year). The budget and each service's limits are below.

A Durable Object is allowed when it stores nothing. Since April 2025 SQLite-backed classes are on the Workers Free
plan (100,000 requests and 13,000 GB-s of duration a day). The live hub, `LiveHub`, holds open streams in memory and
keeps no rows; D1 stays the only source of truth ([ADR 0072](0072-live-updates.md)).

## Budget

| Service                   | Free allowance                                                | Expected use                                                                       |
| ------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Cloudflare Workers        | 100k dynamic requests a day; static assets free and unlimited | Form posts, photo pages, team-app API, live Kumite                                 |
| Workers CPU               | 10 ms per request and per cron run; waiting on I/O is free    | 1–5 ms; watched on the Usage page (ADR 0059)                                       |
| Durable Objects           | 100k requests, 13,000 GB-s a day (SQLite classes only)        | One live hub (ADR 0072): a draft night ~900 GB-s                                   |
| D1                        | 5 GB storage, 5M rows read a day                              | Tiny                                                                               |
| Cron Triggers             | Free                                                          | Friday series, quarterly dues                                                      |
| Sanity                    | Free plan: 1M CDN, 250k API requests a month; see below       | A handful of editors; live photo reads                                             |
| Bitwarden Secrets Manager | Free plan, 3 machine accounts                                 | 1                                                                                  |
| GitHub Actions            | 2,000 minutes a month (private repo)                          | About 2 minutes per deploy, per project                                            |
| YouTube Data API          | 10,000 units a day per Google Cloud project                   | Video reads; an upload costs about 1,600 units                                     |
| Gmail API                 | Free, about 500 emails a day                                  | Sign-in codes, enquiries, dues reminders                                           |
| Web Push                  | Free (browser push services)                                  | Team-app notifications ([#24](https://github.com/battersea-cougars/ark/issues/24)) |
| Firebase Cloud Messaging  | Free, unlimited                                               | The store app's notifications (ADR 0108)                                           |
| GitHub Actions macOS      | Free on a public repo                                         | The store app's builds, when its shell changes (ADR 0108)                          |

Sanity Free, checked on [sanity.io/pricing](https://www.sanity.io/pricing) on 2026-10-05: 20 seats, 2 datasets
(public only), 10k documents, 1M API CDN requests and 250k API requests a month, 100 GB of assets, 100 GB of
bandwidth a month. Photo pages read the API CDN live ([ADR 0016](0016-photos-and-videos-read-live.md)).

YouTube uploads from an unverified Google Cloud project are locked to private until the project passes Google's
API compliance audit (free). The team app applied for it at the start.

Publishing the team app to the app stores adds Apple's developer fee (about $99 a year, on an existing account) and,
when the Android app comes, Google's ($25 once) ([#26](https://github.com/battersea-cougars/ark/issues/26),
[0108](0108-store-apps.md)).

## Consequences

No paid bindings (Cloudflare Images, Durable Objects that store rows), no card-payment provider, no always-on
server. Adding any paid service needs the club's agreement first. Durable Object requests and duration show on the
Usage page and count in its 80% check ([ADR 0059](0059-usage-page-and-check.md)).

## History

- 2026-10-05: Every service on a free tier; no paid bindings, including Durable Objects with storage (0003).
- 2026-10-09: A Durable Object that stores nothing is fine, since SQLite-backed classes became free; the rule now
  reads "Durable Objects that store rows" (0096).
- 2026-10-09: The free-tier budget moved here from `docs/roadmap.md`, which was deleted.
- 2026-10-11: The App Store's yearly fee accepted, on an existing Apple Developer account; Firebase Cloud Messaging
  and GitHub's macOS runners added, both free (0108).
