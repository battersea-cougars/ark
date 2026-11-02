# The website

The rules for what the website shows, in plain words: its sections and switches, the Studio's facts, What's on,
results, photos and videos. Each one is checked by the use-case test it links; change the rule, the test and this
line together. Why a piece of code is the way it is stays in a comment beside it. The join form's rules are in
[lib/server/README.md](lib/server/README.md); rebuilding and refreshing from the team app in
[apps/team/worker/website/README.md](../../team/worker/website/README.md).

## Sections and switches

- The team and the Kumite are on the website only once the team manager ticks _Show on the website_ in the Studio;
  never ticked, they're off.
  [lib/sanity/sections.use-cases.test.ts › "the team and the Kumite are on only once they're switched on in the Studio"](lib/sanity/sections.use-cases.test.ts)
- A section that's off isn't on the website at all: its page isn't built, so its address is not found, and there's
  no home page section or menu link for it.
  [lib/sanity/sections.use-cases.test.ts › "a section that's off has no page, so its address is not found"](lib/sanity/sections.use-cases.test.ts)
- The results are on while the Kumite is (or while there are results to show).
  [lib/sanity/sections.use-cases.test.ts › "the results are on while the Kumite is"](lib/sanity/sections.use-cases.test.ts)
- On your machine every section is on, whatever the Studio says, so each can be looked at; dev and production
  follow the Studio.
  [lib/sanity/sections.use-cases.test.ts › "on your machine every section is on, whatever the Studio says, so each can be looked at"](lib/sanity/sections.use-cases.test.ts)
- There's no news: no page, home section or Studio type for it. Dates go in as events, footage as videos, pictures
  on Instagram, standing information in the club's details.
  [lib/sanity/sections.use-cases.test.ts › "there's no news: no page for it, nor a type in the Studio"](lib/sanity/sections.use-cases.test.ts)

## The Studio's facts

- A fact left out falls back to the club's default, field by field; an optional field the editor left empty stays
  empty.
  [lib/sanity/merge.test.ts › "leave optional fields empty once the document exists, rather than showing the default"](lib/sanity/merge.test.ts)
- Copy that depends on a fact reads it: "we lend you the kit" appears only while _Kit for first-timers_ is filled
  in.
  [lib/server/auto-reply.test.ts › "says nothing about lending kit unless the Studio has a line for first-timers"](lib/server/auto-reply.test.ts)
- Until launch the repo owns the words, and each deploy sends them to the Studio; the switches, the contact email,
  links, photos and awards stay the Studio's.
  [scripts/sanity-copy.test.mjs › "never touches what the Studio owns: switches, the contact email, links, photos, awards"](../../../scripts/sanity-copy.test.mjs)

## What's on and events

- The home page's What's on is the next 3 training sessions, the next 3 tournaments (each by its own name) and the
  next 4 one-off events, soonest first. A called-off one stays listed, marked, so nobody turns up to nothing.
  [lib/server/whats-on.test.ts › "lists the next few public trainings, tournaments and events, soonest first"](lib/server/whats-on.test.ts)
- The weekly trainings are one row, at the next one that's on, naming any week called off; a session at another
  rink is a row of its own.
  [lib/server/whats-on.test.ts › "are one row, at the next one, naming any week that's called off"](lib/server/whats-on.test.ts)
  [lib/server/whats-on.test.ts › "keep a session somewhere else as its own row, so nobody goes to the wrong rink"](lib/server/whats-on.test.ts)
- The events page shows the next four trainings and every public tournament and event coming up.
  [lib/server/whats-on.test.ts › "the events page shows the next four trainings, and every public tournament and event coming up"](lib/server/whats-on.test.ts)
- Only what's public reaches the website, whether or not the Kumite section is switched on.
  [lib/server/whats-on.test.ts › "leaves out what isn't public"](lib/server/whats-on.test.ts)
- A tournament's draft night and sign-up deadline are for the team app, not the website.
  [lib/server/whats-on.test.ts › "a tournament's draft night and sign-up deadline are the team app's, not the website's"](lib/server/whats-on.test.ts)
- A Kumite played early has been, whatever its date: it leaves What's on.
  [lib/server/whats-on.test.ts › "leaves out a Kumite played early, its day still ahead: it's been, whatever its date (ADR 0074, #182)"](lib/server/whats-on.test.ts)
- A change in the team app is on the website within a minute.
  [lib/server/whats-on.test.ts › "reads the calendar once a minute, however many people look"](lib/server/whats-on.test.ts)

## Results

- A tournament is on the website once it's public and done (marked finished, or every game played); one still to
  play, or kept off the website, isn't.
  [team/worker/website/website.results.use-cases.test.ts › "a tournament still to play, or one kept off the website, isn't there"](../../team/worker/website/website.results.use-cases.test.ts)
- Its page shows the champions, the table, every score and who scored.
  [team/worker/website/website.results.use-cases.test.ts › "once the last game's played, anyone sees the champions, the table, the score and who scored"](../../team/worker/website/website.results.use-cases.test.ts)
- The champions say how they won it: the final's score from their side, else top of the table with their points.
  [lib/results.test.ts › "the champions say how they won it: the final's score, from their side"](lib/results.test.ts)
- The board counts the group games only: the final decides the champions, not the places.
  [lib/results.test.ts › "the board counts the group games only: the final decides the champions, not the places"](lib/results.test.ts)
- The leaders rank by points (goals and assists together), then goals.
  [lib/results.test.ts › "the leaders: most points (goals and assists together) first, then most goals"](lib/results.test.ts)
- Award winners show only once an admin confirms them.
  [team/worker/website/website.results.use-cases.test.ts › "award winners show once an admin confirms them, not before"](../../team/worker/website/website.results.use-cases.test.ts)
- Penalties show as each side's minutes on a game, and each player's beside their goals.
  [team/worker/website/website.results.use-cases.test.ts › "a played game's penalties show: each side's minutes, and each player's beside their goals"](../../team/worker/website/website.results.use-cases.test.ts)
- Players go by the name they chose, else first name and initial; a full name never reaches a page.
  [team/worker/website/website.results.use-cases.test.ts › "a player who changes the name they go by changes it on the results too"](../../team/worker/website/website.results.use-cases.test.ts)
- A team with no name of its own is "Team" and its captain's name.
  [team/worker/website/website.results.use-cases.test.ts › "a team with no name of its own goes by Team and its captain's name, never their full name"](../../team/worker/website/website.results.use-cases.test.ts)
- Results are listed newest first; the reigning champions on the home page and the Kumite page are the latest
  Kumite's.
  [team/worker/website/website.results.use-cases.test.ts › "is newest first, so the reigning champions are the latest tournament's"](../../team/worker/website/website.results.use-cases.test.ts)
- A team's crest is published only once its tournament is on the website.
  [team/worker/website/website.results.use-cases.test.ts › "a team's crest is published only once its tournament is on the website"](../../team/worker/website/website.results.use-cases.test.ts)
- An admin's correction after the day changes the website: the score, the table and the champions.
  [team/worker/website/website.edge-cases.use-cases.test.ts › "an admin's correction after the day changes the website: the score, the table and the champions"](../../team/worker/website/website.edge-cases.use-cases.test.ts)
- A cup called finished before its final shows the games played and no champions.
  [team/worker/website/website.edge-cases.use-cases.test.ts › "a cup an admin calls finished before its Final is on the website: the games played, and no champions"](../../team/worker/website/website.edge-cases.use-cases.test.ts)

## Photos

- The photos are the club's Instagram: admins post there, and there's nothing to do in the Studio or the team app.
  The home page's strip is the newest twelve, the photos page the newest 48.
  [lib/server/photos.use-cases.test.ts › "the home page's strip is the newest twelve"](lib/server/photos.use-cases.test.ts)
  [lib/server/photos.use-cases.test.ts › "the photos page is the newest 48; older ones are on Instagram"](lib/server/photos.use-cases.test.ts)
- Every photo is a tile of its own: a post with several gives one each, linking to the post.
  [lib/server/instagram.test.ts › "shows each photo of a post with several as a photo of its own, linking to the post"](lib/server/instagram.test.ts)
- Instagram videos are left out: the website can't play them.
  [lib/server/instagram.test.ts › "leaves out videos, which the website can't play"](lib/server/instagram.test.ts)
- "More on Instagram" shows only when Instagram has older photos than the page.
  [lib/server/instagram.test.ts › "says there are more on Instagram only when it has left some out"](lib/server/instagram.test.ts)
- A new post is on the site within ten minutes; while Instagram is down the last photos stay up.
  [lib/server/instagram.test.ts › "asks Instagram once every ten minutes, however many people look"](lib/server/instagram.test.ts)
  [lib/server/instagram.test.ts › "keeps showing the last posts it had while Instagram is down, and says so when it has none"](lib/server/instagram.test.ts)
- An old album's address (ours or Wix's) goes to the photos page for good.
  [lib/server/photos.use-cases.test.ts › "an old album's address, ours or Wix's, goes to the photos for good"](lib/server/photos.use-cases.test.ts)

## Videos

- The videos are the club's YouTube playlists, set in the Studio, unlisted videos included; each shows its
  playlist's label, and a video in two playlists is listed once.
  [lib/youtube.test.ts › "labels each video with its playlist, and lists a video in two playlists once"](lib/youtube.test.ts)
  [lib/youtube.test.ts › "keeps unlisted videos from a club playlist, but never private or deleted ones"](lib/youtube.test.ts)
- With no playlists set, they're the channel's public uploads.
  [lib/youtube.test.ts › "reads a channel's uploads, public only"](lib/youtube.test.ts)
- A new upload shows once YouTube has finished processing it, within ten minutes.
  [lib/server/videos.test.ts › "shows a new upload only once YouTube has finished processing it, within ten minutes"](lib/server/videos.test.ts)
- A video in the Studio can change its title, date or description, be hidden, or be shown first; shown-first ones
  lead, then newest.
  [lib/youtube.test.ts › "lets filled-in Sanity fields win, and keeps YouTube's for empty ones"](lib/youtube.test.ts)
  [lib/youtube.test.ts › "removes hidden videos"](lib/youtube.test.ts)
  [lib/youtube.test.ts › "puts pinned videos first, then newest"](lib/youtube.test.ts)
- While YouTube is down the last list stays up.
  [lib/server/videos.test.ts › "keeps showing the last YouTube list when YouTube fails"](lib/server/videos.test.ts)
