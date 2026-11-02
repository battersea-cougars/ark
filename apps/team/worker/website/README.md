# The website, from the team app

The rules for the team app's side of the website, in plain words: rebuilding it when a result changes, Settings →
Website, and Refresh photos and videos. Each one is checked by the use-case test it links; change the rule, the test
and this line together. Why a piece of code is the way it is stays in a comment beside it. What the website shows of
a result is in [apps/web/src/README.md](../../../web/src/README.md#results).

## A result rebuilds the website

- Once a tournament's last game is played, the website is rebuilt after five quiet minutes, once.
  [website.rebuild.use-cases.test.ts › "once the last game's played and things are quiet for five minutes, GitHub is asked once to rebuild dev's site"](website.rebuild.use-cases.test.ts)
- Each change in a busy spell restarts the five minutes, so a results day is one rebuild.
  [website.rebuild.use-cases.test.ts › "each change in a busy spell restarts the five minutes, so a results day is one rebuild"](website.rebuild.use-cases.test.ts)
- A tournament still being set up or played doesn't ask; a finished one changed later asks again.
  [website.rebuild.use-cases.test.ts › "a tournament still being set up or played doesn't ask"](website.rebuild.use-cases.test.ts)
  [website.rebuild.use-cases.test.ts › "a finished tournament changed later asks again"](website.rebuild.use-cases.test.ts)
- If GitHub can't be reached, the next check tries again.
  [website.rebuild.use-cases.test.ts › "if GitHub can't be reached, the next check tries again"](website.rebuild.use-cases.test.ts)
- Each environment rebuilds its own site: dev's from `main`, production's from `release`.
  [website.rebuild.use-cases.test.ts › "production rebuilds production's site, from release"](website.rebuild.use-cases.test.ts)
- A laptop's server never asks.
  [website.rebuild.use-cases.test.ts › "a laptop's server never asks GitHub"](website.rebuild.use-cases.test.ts)

## Settings → Website

- Only members who can edit the website see the page.
  [website.manage.use-cases.test.ts › "a member who can't edit the website can't see it or rebuild it"](website.manage.use-cases.test.ts)
- It links to the Studio and the site (production's are the club's own addresses).
  [website.manage.use-cases.test.ts › "says the site has never been rebuilt from the app, and links to the Studio and the site"](website.manage.use-cases.test.ts)
  [website.manage.use-cases.test.ts › "production's links are the club's own addresses"](website.manage.use-cases.test.ts)
- Rebuild now (for a Studio change) rebuilds at once, and the page says when.
  [website.manage.use-cases.test.ts › "Rebuild now asks GitHub at once, not after five quiet minutes, and the page then says when"](website.manage.use-cases.test.ts)
- Pressed again while that rebuild is still building (five minutes), it doesn't start another.
  [website.manage.use-cases.test.ts › "pressed again while that rebuild is still building, it doesn't start another"](website.manage.use-cases.test.ts)
- If GitHub can't be reached it says so, and the five-minute check sends it later.
  [website.manage.use-cases.test.ts › "if GitHub can't be reached, it says so, and the five-minute check sends it when it can"](website.manage.use-cases.test.ts)
- A rebuild a result asked for shows as on its way, then its time once sent.
  [website.manage.use-cases.test.ts › "a rebuild a result asked for shows as on its way, and its time once it's sent"](website.manage.use-cases.test.ts)
- Each rebuild asked for is on the record, with who asked.
  [website.manage.use-cases.test.ts › "each rebuild asked for is on the record, with who asked"](website.manage.use-cases.test.ts)

## Refresh photos and videos

- A video just added to a playlist, or a post just made on Instagram, is on the website within a minute of the
  press.
  [website.media.use-cases.test.ts › "a video just added to a playlist is on the website within a minute of the press"](website.media.use-cases.test.ts)
  [website.media.use-cases.test.ts › "a post just made on Instagram too"](website.media.use-cases.test.ts)
- Nothing pressed, the website keeps its copy ten minutes.
  [website.media.use-cases.test.ts › "with nothing pressed, the website keeps its copy ten minutes, as it always has"](website.media.use-cases.test.ts)
- Pressed while YouTube is down, the website still shows the last good list.
  [website.media.use-cases.test.ts › "pressed while YouTube is down, the website still shows the last good list, not nothing"](website.media.use-cases.test.ts)
- The page says when it was last pressed, the press is on the record, and only members who can edit the website
  can press it.
  [website.media.use-cases.test.ts › "the page says when it was last pressed, and the press is on the record"](website.media.use-cases.test.ts)
  [website.media.use-cases.test.ts › "a member who can't edit the website can't press it"](website.media.use-cases.test.ts)

## The Kumite's awards on the website

- Before there's been any Kumite, the series' awards show; then the next public Kumite's own, else the last one
  held's. A members-only Kumite isn't on the website.
  [website.kumite.use-cases.test.ts › "before there's been any Kumite, the series' awards"](website.kumite.use-cases.test.ts)
  [website.kumite.use-cases.test.ts › "the next Kumite's own awards, changed in its editor: not the series'"](website.kumite.use-cases.test.ts)
  [website.kumite.use-cases.test.ts › "once it's been held and no other's coming up, the last one held's, not the series'"](website.kumite.use-cases.test.ts)
  [website.kumite.use-cases.test.ts › "a members-only Kumite coming up isn't on the website: the last public one's awards show"](website.kumite.use-cases.test.ts)
