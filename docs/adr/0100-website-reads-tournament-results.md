# 0100. Tournament results are built into the website from D1, and the team app rebuilds it when one changes

- **Status:** Accepted
- **Date:** 2026-10-09 · updated 2026-10-24

## Context

The team app records a tournament from start to finish: its teams, every game and goal, who scored and assisted, the
champions and the awards an admin confirms ([0061](0061-fixtures-games-and-scoring.md),
[0044](0044-champions-and-awards.md)). The website showed only its date (the agenda,
[0042](0042-website-reads-the-club-agenda.md)). Its champions board read Sanity `kumiteResult` documents, which
someone would type in by hand after each Kumite; neither Sanity project had any.

Three ways were open:

- **Write results to Sanity** and rebuild. Two copies of every result, a Sanity write token on the Worker, and names
  that stop following what each player chose (a player who renames themself, or leaves, stays in Sanity as they were).
- **Read D1 live** on every visit, like What's on. One copy, but every view is a Worker request, and the website and
  the team app share one account's 100,000 a day: a bot on the website could stop the team app.
- **Build the results into the pages from D1**, and rebuild when one changes. One copy, and a page view costs
  nothing. Results change a few times a year.

## Decision

- **D1 is the record; the website's build reads it.** The build's club snapshot (`scripts/club-snapshot.mjs`, as for
  the roster, [0043](0043-roster-and-names.md)) reads every public tournament's rows (`scripts/lib/results-sql.mjs`)
  into the gitignored `results.local.json`. `apps/web/src/lib/results.ts` works the results out from them. Nothing is
  written to Sanity.
- **What's published:** a tournament that's public (`tournaments.public`) and done. Done is the app's rule, in
  `@cougars/shared/results`: marked finished, or every game played. One being played isn't shown; that's the live
  page (#48).
- **One rule set.** The table, the champion and "done" live in `@cougars/shared/results`, used by the Worker, the app
  and the website, so they can't disagree.
- **Static pages.** `/results/` lists every published tournament, newest first; `/results/<id>/` shows it as the team
  app shows a past one (`lib/EditionResults`, [0074](0074-tournament-home-and-scheduling.md)), in its order and look
  (`apps/web/src/components/results/`): the champions (crest big, how they won it: "Beat Ants 3–1 in the final", or
  "Top of the table, 9 points from 4"), the final (big), the fight card (every game in the order played, crests,
  the winner bright and the loser faded), the board (the group games' table, as the app's: the playoffs decide the
  champions, not places; the champions stamped), the leaders (most points, goals and assists together, then goals;
  one table with every column, as the app's tabs need JavaScript), the awards (a team's with its crest), then who
  played. A Kumite's is underground (`.night`) and in its motif: kanji by the titles (決勝, 試合, 賞) and the 優勝
  seal on the champions' crest, in the team app's own kanji font (Noto Serif JP Black, cut to its characters). A team
  without a logo shows its initials, worked out by the same rule as the app (`@cougars/shared/team-initials`). Where there were penalties, each
  game says its penalty minutes a side ("PIM 4–2") and the scorers become Players, with a PIM column (who and how
  long only: what for and when stay in the app). The champions board on the home page
  and `/kumite/` is built in. Crests are written as files (`/crests/<team id>.webp`), only for published teams, never
  SVG. Award winners show only once an admin has confirmed them; with no confirmed Champions, the champions are worked
  out from the games.
- **A changed result rebuilds the website.** Any change through the team app's API to a tournament that's done before
  or after it (the last game scored, a goal corrected, awards confirmed, renamed, made private, deleted) marks a
  rebuild wanted (`website_rebuild`, `apps/team/worker/website/website.ts`). A cron every five minutes sends it once there's
  been no change for five minutes, so a results day is one rebuild. As the club's GitHub App, **Cougars rebuilds**,
  owned by the organisation so it outlives any maintainer ([docs/secrets.md#github_app_private_key](../secrets.md#github_app_private_key)), it runs `deploy.yml` for
  the website (`workflow_dispatch`, `apps: web`) from its environment's branch: `main` for dev, `release` for
  production. The App can start workflows and nothing else, and each token it takes asks for only that: a leaked key
  can't push code (#71). If GitHub can't be reached, the next check tries again. A laptop's server never asks.
- **Rebuild now.** Settings → Website (`edit:Content`, #107) sends the same rebuild at once, for Studio changes
  ([ADR 0004](0004-astro-workers-sanity-d1.md)); within five minutes of the last one sent it says that one's still
  building and asks for nothing. The time of each one sent is kept (`website_times.rebuild_sent`) and shown there; a
  press is on the record (`website.rebuilt`).
- **Names.** Every player is shown by the name they chose on their profile (`members.web_name`), else first name and
  initial (`@cougars/shared/names`, as on the roster). That includes members who aren't Cougars, and players from
  outside the club, who have no profile. A team with no name of its own is "Team" and its captain's chosen name, else
  their first name. A full name never reaches a page.
- **Player stats** on `/team/` and the back of a card add goals, assists, penalty minutes (PIM) and titles, from published tournaments only,
  in the roster snapshot (`scripts/lib/roster-sql.mjs`, #65). Goals, assists and penalty minutes count from played
  games, as on a result. A title is a tournament whose Champions an admin confirmed, on that team as captain or player.
- Sanity's `kumiteResult` type, its query and the Studio schema are gone.

## Consequences

- Results cost nothing per view and can't use up the account's Worker requests; if D1 is down, the pages still show
  the last build.
- A result is on the website about ten minutes after the last change: five quiet minutes, then the build.
- A player's renamed or a tournament's series renamed shows at the next build: the daily one, or the next result.
- One more secret (the App's key) on the team Worker, and one more cron (free). The Worker's settings name the App
  (`wrangler.jsonc` vars).
- Each rebuild is a few GitHub Actions minutes; the repo is public, so they're free.
- A past Kumite played before the app has no record on the website. If the club wants one, it goes in the app as a
  tournament.
- The privacy notice says that results and stats show each player's chosen name.

## History

- 2026-10-09: Results are read from D1 live instead of written to Sanity; `kumiteResult` retired.
- 2026-10-09: Results are built into the pages from the snapshot instead of read live, so visits can't spend the
  account's Worker requests; the team app rebuilds the website through the club's GitHub App when a result changes.
- 2026-10-10: The rebuild runs `deploy.yml` directly (`workflow_dispatch`) instead of a `repository_dispatch`, so the
  App needs Actions: write, not Contents: write (#71).
- 2026-10-21: Penalties reach the website: each game's penalty minutes a side, a player's PIM beside their goals on
  a result, and PIM in the `/team/` stats and on a card.
- 2026-10-24: Rebuild now in Settings → Website sends the rebuild at once (#107); each one sent is timed, so the page
  says when, and a second press within five minutes asks for nothing.
- 2026-10-30: A result's page follows the team app's past-Kumite view: champions with how they won it, the final,
  the fight card, the board, the leaders, the awards, in the app's order, look and Kumite motif (kanji, the 優勝
  seal); the board counts the group games only, as the app's; the leaders rank by points; crests without a logo show
  the app's initials (moved to `@cougars/shared/team-initials`). The champions board on the home page and `/kumite/`
  wears the same crest and seal.
