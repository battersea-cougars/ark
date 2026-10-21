# 0107. Admins post announcements to the top of Home, until their last day or until each member says "Got it"

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
- **Everyone sees it at the top of Home** until its last day (London), or until they say **"Got it"**
  (`announcement_dismissals`, theirs alone, not on the record). **Two at a time, newest first**: the club read sends
  the two newest still on that this member hasn't got. Not a feed.
- **"Got it" is a button in words**, the main (sticker yellow) button on the note, bottom right under a thumb on a
  phone, beside the words on a desktop. Pressed, it turns to a green tick for a moment, then the note folds away (the
  page closes up behind it smoothly; nothing jumps). It was a small ✕ in the corner, which read as "close" rather than
  "I've read this".
- **Every announcement can be looked back over** at Home → Past announcements (`/announcements`, Home's own page, a link
  under the notes): newest first, each with who posted it, when it ran, and whether you got it ("Got it", or "Missed
  it" for one that ended first). One still on can be got there, and whoever may post can take one still on down from
  its row (once they've got it, it's no longer on their Home). `GET /api/announcements`, one read, a page of 20 at a
  time (`?before=<id>`, `?limit=` up to 100).
- **A link must be `https://`**: what an admin types is shown to everyone, so it never runs a script. Title up to 80
  characters, the line up to 280.
- Announcements are glass like the tables, with a loudhailer icon in the brand's red. Email or push for them waits for
  #24.

## Consequences

- One small table pair, one club read part and one paged read for looking back; the announcement routes live in
  `worker/announcements/`.
- Taking one down deletes it, so it's gone from looking back too.
- An announcement nobody dismisses stays until its last day, so the last day is required and can't be in the past.

## History

- 2026-10-10: Announcements on Home, posted by admins, two at a time, dismissable, ending on their last day (#85).
- 2026-10-20: "Got it" in words (the main button) instead of a ✕, folding the note away; every announcement can be
  looked back over, with whether you got it, at More → Announcements.
- 2026-10-21: Past announcements are Home's page (`/announcements`, the old `/more/announcements` redirects), not a
  Settings row for whoever posts: on a desktop it showed the Settings list, as if it were a setting. Posting stays on
  Home (the megaphone) ([0065](0065-page-frame-and-admin-actions.md)).
