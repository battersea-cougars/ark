# 0107. Admins post announcements to the top of Home, until their last day or until each member dismisses them

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The club needs to tell everyone something now and then ("No training on the 24th, the hall's booked", "Kit orders
close Friday"), where they'll see it. Home is where everyone lands. A feed would be one more thing to read; push
notifications aren't built yet (#24).

## Decision

- **An announcement** is a title, a line or two, an optional link and a last day (`announcements`). Who may post holds
  `post:Announcement` (Admin, through `manage:all`, by default). They post from Home, in a sheet over it
  ([0065](0065-page-frame-and-admin-actions.md)), and can take one down from its card. Both are on the record
  (`announcement.posted`, `announcement.removed`, [0095](0095-audit-log.md)).
- **Everyone sees it at the top of Home** until its last day (London), or until they dismiss it
  (`announcement_dismissals`, theirs alone, not on the record). **Two at a time, newest first**: the club read sends
  the two newest still on that this member hasn't dismissed. Not a feed.
- **A link must be `https://`**: what an admin types is shown to everyone, so it never runs a script. Title up to 80
  characters, the line up to 280.
- Announcements are glass like the tables, with a loudhailer icon in the brand's red. Email or push for them waits for
  #24.

## Consequences

- One small table pair and one club read part; the announcement routes live in `worker/announcements/`.
- An announcement nobody dismisses stays until its last day, so the last day is required and can't be in the past.

## History

- 2026-10-10: Announcements on Home, posted by admins, two at a time, dismissable, ending on their last day (#85).
