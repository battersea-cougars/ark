# 0123. A member puts up their own photo from their phone; it's kept small in D1 and shown in the app only

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

`members.photo` had been in the schema from the start, and the player card's photo slot showed the club mark "until
members add photos" ([0043](0043-roster-and-names.md)), but nothing let anyone add one. Members wanted to put up a
profile picture from their phone.

The app keeps no files anywhere. Team logos are the one picture it has: shrunk to 256px in the browser and kept in
D1 as a data: URL, sent with the tournament ([lib/logo.ts](../../apps/team/src/lib/logo.ts)). R2 would be the
obvious place for files, but it's a new service and binding on two Cloudflare accounts, with its own setup and
limits, for a few dozen small pictures ([0003](0003-free-tiers-only.md)).

## Decision

- **Your own, from the You page.** Your avatar there is a button, with **Add a photo** / **Change photo** and
  **Remove** beside your name. It's a plain file input (`accept="image/*"`, no `capture`), so a phone offers the
  camera, its photos or its files. It saves at once, apart from the details' Save. Only you set yours: an admin
  doesn't (yet), and the route only ever changes the signed-in member.
- **Shrunk on the phone.** The browser crops the middle square and draws it at 512px at most, WebP where it can write
  it, else JPEG (`lib/photo.ts`): 30–80 KB. A full-size phone photo never leaves the phone.
- **Kept in D1, beside the member.** `PUT /api/me/photo` `{ photo }` takes a PNG, JPEG or WebP data: URL of 300 KB at
  most (anything else is a 400, a bigger body a 413) and stores it in `members.photo`, with `members.photo_at` the
  time it was set; `{ photo: null }` takes it down. No new service, binding or secret.
- **Served on its own, not in the bootstrap.** The members part carries only `photoAt`; the picture is
  `GET /api/members/<id>/photo?v=<photoAt>`, decoded to the image itself, for anyone signed in who may see that
  member (an active member, yourself, or anyone if you manage members, as the bootstrap's members,
  [0036](0036-api-security.md)). Its address changes when the photo does, so it's `private, max-age=31536000,
immutable`: each phone fetches each photo once. Signed out: 401.
- **Shown wherever an avatar is.** `lib/Avatar.svelte` is the disc everywhere a member's initials were (a person row,
  the shell's You tile and tab, the member sheet, the flipped card, the You page), and the player card's photo slot
  shows it in place of the club mark. Each reads the club's copy (the store), so a new photo shows at once.
- **Personal data** ([0029](0029-personal-data.md)): it's in the data you download, and deleting your account clears
  it with the rest.
- **The website doesn't show it.** The public roster stays on the club mark until the club decides members' photos
  may be public; that would be a choice on the You page, like the name you go by.

## Consequences

- No new service: one more column, read only when someone's picture is on screen. A 512px photo is about a hundredth
  of a row's 2 MB limit.
- Keeping the pictures out of the bootstrap keeps every page load and every members change as small as before.
- Each picture is one API request the first time a phone shows it, inside the per-address limit (600 a minute). A
  whole squad opening Teammates for the first time on the rink's wifi could get close; lazily loaded images and the
  browser keeping them make that rare.
- An admin can't put up or take down someone else's photo; that's a member sheet button away if it's wanted.
- If photos ever need to be bigger or many more, R2 is the move: the route and `photoAt` stay, only where the bytes
  live changes.

## History

- 2026-10-23: Members put up their own photo from the You page; shrunk on the phone, kept in D1, served by its own
  route.
