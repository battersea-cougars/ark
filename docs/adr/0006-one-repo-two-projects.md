# 0006. One repo: the apps in apps/, shared code in packages/; the team generator runs in the browser

- **Status:** Accepted
- **Date:** 2026-10-05 (decided at project start) · updated 2026-10-24
- **Merges:** 0021, 0102

## Context

The old team manager (Next.js, Airtable, a Python optimiser on a paid server) picked balanced Friday teams. We are
rebuilding it alongside the new website, as the team app: a mobile-first app for every member, with its own stack
([ADR 0022](0022-team-app-svelte-pwa.md)), plan and release rhythm. Mixing it with the website blurs which rules
apply where (CLAUDE.md's Astro rules don't fit a Svelte SPA).

A separate repo would keep them apart, but the two share a D1 database and its schema, the Bitwarden and CI scripts,
the Sanity helpers and the Europe/London date code. Gwenda's ark repo solves the same problem with top-level
`marketing/` and `ops/` folders; most monorepos use `apps/` for what deploys and `packages/` for what they share.

## Decision

- **One repo, `battersea-cougars/ark`**, owned by the club's GitHub organisation rather than a person, so it
  outlives any one maintainer. npm workspaces, laid out the usual way:
  - `apps/` holds what deploys, each its own workspace: `apps/web` (the Astro site, `@cougars/web`, port 4500),
    `apps/studio` (Sanity Studio, `@cougars/studio`, port 4520) and `apps/team` (the team app, `@cougars/team`, port
    4510).
  - `packages/shared` (`@cougars/shared`) is the framework-free code both use, imported by name
    (`@cougars/shared/d1`), never by a relative path.
- `db/` and `scripts/` stay at the root and serve both.
- **An app never imports another app's files.** Anything both need moves to `packages/shared`, which stays
  framework-free. (Use-case tests are the exception: the team app's may read through the website's modules, to show
  what a visitor sees.)
- **London's dates as data are one copy, `packages/shared/london.ts`**: London's date of a moment (`londonDate`,
  `londonDay`, `londonToday`), its wall clock (`londonTime`), the instant of a wall-clock time (`londonISO`) and the
  evening a moment belongs to (`londonEvening`). The website, the team app and its Worker all use it; the Worker imports
  it from there, and each app's `lib/dates.ts` passes it on beside its own display formats, which stay per app
  ("Fri 4 Dec 2026" on the site, "Fri 9 Oct · 7:30pm" in the app) (#35).
- Each project has its own Worker and deploy step
  ([ADR 0010](0010-environments-and-deploys.md)). Rules in CLAUDE.md say which project they apply to.
- **The roadmap is GitHub milestones**, not a doc: each milestone is prefixed with its project (`Website:` or
  `Team app:`; `Housekeeping` is for both), and every piece of work is an issue in one. A checklist in a doc went stale as soon as work moved
  faster than it was ticked. Issues are written from `.github/ISSUE_TEMPLATE/task.md` (modelled on typesmiths/ledger's), and a PR from
  `.github/pull_request_template.md`, starting with the issue it closes.
- The old app is not in the tree; it's in git history (`archive/team-manager/`, before 2026-10-09).
- **The team generator runs in the browser**, on the main thread (`apps/team/src/lib/balance.ts`), so there is no
  server to pay for ([ADR 0003](0003-free-tiers-only.md)): not a linear programme but a greedy deal and a swap search
  with a dozen seeded restarts, comparing a list of measures in order rather than weights. What it balances is in
  [the training notes](../../apps/team/worker/training/README.md).

## Consequences

- One PR can change the schema and both projects that use it.
- Large drafts are solved on the organiser's phone or laptop, so solver speed on a phone matters.
- A new app goes in `apps/`; code a second app needs moves to `packages/`, as a package of its own if it grows.
