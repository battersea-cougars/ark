# 0043. The roster is a build-time snapshot of the club's members, and members go by their chosen name everywhere

- **Status:** Accepted
- **Date:** 2026-10-07 · updated 2026-10-23
- **Merges:** 0085

## Context

The website's squad cards (home page and `/team/`) read Sanity `player` documents, and there were none, so they
showed samples. The real roster is the team app's `members` in D1, which is personal data and never in the repo
([ADR 0029](0029-personal-data.md)). It changes rarely, so a rebuild is fine, but a player who changes their details
in the app shouldn't have to wait for one to see them.

A member also chooses how their name shows. When only the website used that choice, a player known as "The Wall" on
the website was "Sam Jones" in the app.

## Decision

- **Snapshot at build.** `scripts/club-snapshot.mjs` runs before `astro dev` and `astro build` (apps/web's
  `predev`/`prebuild`). It reads the active Cougars (the `cougar` flag) from the environment's D1 (local D1 on a
  laptop; in CI, the D1 API with `CLUB_SNAPSHOT_ENV`) into `apps/web/src/data/roster.local.json`, gitignored. The same
  script writes the Kumite's awards to `kumite.local.json` ([ADR 0044](0044-champions-and-awards.md)). If it can't
  read the database, the site falls back to Sanity players or the samples; a build never fails on it.
- **Only what the website shows leaves the database:** the member's chosen name, position and bio.
- **Player stats** under the cards on `/team/`: training sessions played this year and in all, and tournaments
  played, counted as the team app counts them (signed up, not marked a no-show, not cancelled); goals, assists and
  titles from the tournaments on the website ([0100](0100-website-reads-tournament-results.md)); as of the last build
  (`scripts/lib/roster-sql.mjs`).
- **Picked up, as in the app.** Pressing a card lifts a copy to the middle of the screen, turning to its back on the
  way; Close, the scrim or Escape put it back. Picking it up fetches `/api/players/<id>` (live from D1, active Cougars
  only, cached a minute, [ADR 0053](0053-live-reads-are-cached.md)) and changes whatever differs: name, position, bio.
- **One chosen name.** On their profile ("The name you go by: in the app, and on the website's roster") a member
  picks first name and initial (the default), full name, first name, or a nickname, stored in `members.web_name`.
  It's the name they go by everywhere the app shows them: cards, lists, teams, the Draft, scores, awards, greetings,
  the account menu. One helper says it (`apps/team/src/lib/names.ts`): `goesBy` (the chosen name, else the full name)
  and `shortName` (the chosen name whole, else the first name, wherever the app said just a first name).
- With nothing chosen, the app shows the full name (it's members only); the public website keeps first name and
  initial.
- **The full name stays** where it's needed: sign-in, payment references (which match bank statements), Unpaid fees,
  Dev tools, and an admin's views, where it's shown with "Goes by …" beside it (the Members table, the member sheet).
  Search finds a member by either name.

## Consequences

- A new or departed Cougar shows after the next build (daily in production,
  [ADR 0004](0004-astro-workers-sanity-d1.md)); a changed name, bio or position shows as soon as someone picks up
  that card. Locally, re-run the snapshot.
- Each Cougar decides how their name appears; nobody's full name is published unless they choose it. A nickname
  reads the same in the app and on the website.
- New screens show a person with `goesBy` or `shortName`, never `player.name`, unless it's one of the full-name
  places above.
- A long nickname on a trading card shrinks to fit the name band.
- Shirt numbers aren't in D1 yet, so roster cards show no number. Members' photos are, in the team app only
  ([0123](0123-member-photos.md)): the website's cards keep the club logo until members can choose to show theirs.

## History

- 2026-10-07: The roster becomes a build-time snapshot of active Cougars from D1, with a name each member chooses,
  stats, and a live refresh when a card is picked up (was 0043).
- 2026-10-08: The chosen name is used everywhere in the team app too, with the full name kept for sign-in, payments
  and admins (was 0085).
- 2026-10-09: Goals, assists and titles join the stats, from published tournaments (0100).
- 2026-10-23: Members' photos are in D1 for the team app ([0123](0123-member-photos.md)); the website still shows the
  logo.
