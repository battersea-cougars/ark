# Announcements

The rules for the club's announcements (the locker room, as people see it), in plain words. Each one is checked by the
use-case test it links; change the rule, the test and this line together. Why a piece of code is the way it is stays
in a comment beside it.

## Posting

- An announcement is a title, a line or two, an optional link and a last day. Whoever may post (admins, to start with)
  posts it from Home, and everyone sees it at the top of Home.
  [announcements.use-cases.test.ts › "an admin posts one and every member sees it at the top of Home"](announcements.use-cases.test.ts)
- Only someone allowed to post can post or take one down; it needs a title, and its last day can't be in the past.
  [announcements.use-cases.test.ts › "only someone allowed to post can post or take one down; it needs a title and a day in the future"](announcements.use-cases.test.ts)
- A link must be a plain `https://` address, as what an admin types is shown to everyone.
  [announcements.edge-cases.use-cases.test.ts › "a link that isn't a plain https address (%s) is refused"](announcements.edge-cases.use-cases.test.ts)
- A title is up to 80 characters, the line up to 280.
  [announcements.edge-cases.use-cases.test.ts › "a title or note one character too long is refused"](announcements.edge-cases.use-cases.test.ts)
- Posting one and taking one down are both on the record; taken down, it's gone, from looking back too.
  [announcements.use-cases.test.ts › "an admin takes one down early, and both changes are on the record"](announcements.use-cases.test.ts)

## On Home

- It shows until midnight in London on its last day.
  [announcements.edge-cases.use-cases.test.ts › "shows until midnight in London on its last day, in summer time (BST)"](announcements.edge-cases.use-cases.test.ts)
- Two at a time, newest first: a third pushes the oldest off. Not a feed.
  [announcements.use-cases.test.ts › "two at a time, newest first: a third pushes the oldest off"](announcements.use-cases.test.ts)
- Got it takes it off your Home only, and everyone else still sees it.
  [announcements.use-cases.test.ts › "a member dismisses it: gone for them, still there for everyone else"](announcements.use-cases.test.ts)
- Got it is a button in words on the note, and the note goes from your Home.
  [calendar.journey.test.ts › "says Got it, and it's gone from his Home"](../../tests/journeys/calendar.journey.test.ts)

## Looking back

- Everyone can look back over every announcement, newest first: who posted it, when it ran, and whether they got it or
  missed it.
  [announcements.use-cases.test.ts › "a member looks back over every announcement, newest first: who posted it, when it ran, whether they got it"](announcements.use-cases.test.ts)
- A long history comes a page at a time.
  [announcements.use-cases.test.ts › "a long history comes a page at a time; one taken down isn't in it"](announcements.use-cases.test.ts)
