# 0069. Admins add members; the members table is in Settings; a member's details save with a button

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-23
- **Merges:** 0080, 0082

## Context

Someone new could only get into the app by asking to join on the sign-in screen and waiting for an admin to approve
them, and nobody told them when they were in. An admin who'd just met a new player at training had no way to add
them.

Teammates had two views for admins: cards, and Rows, an AG Grid table of what an admin checks (rating, role, plan,
played, owes, email, phone). In the page frame ([0065](0065-page-frame-and-admin-actions.md)) the table's last columns
were cut off and the whole page scrolled, taking the header row with it; the toggle also gave an everyday page an
admin's tool.

The member sheet (an admin's view of a member, from Teammates or Settings → Members) saved every field as it changed.
Nothing on screen said what had been saved or offered a way back, and a slip (the wrong role, a mistyped rating) was
live at once.

## Decision

**Adding a member**

- **Teammates has Add member** (`manage:Member`), a sheet over the page ([0065](0065-page-frame-and-admin-actions.md)):
  name, email, position. `POST /api/members`. They're `active` at once, with a payment reference
  ([0007](0007-dues-and-payments.md)), like an approved request. An email already in the club is refused (409).
- **The app emails them** a short welcome with a link to itself, `<origin>/?email=<their address>`; the sign-in screen
  fills the address in from it, so they send themselves a code and they're in. The link signs nobody in by itself
  ([0023](0023-sign-in-and-sessions.md)). It's sent through Gmail like the codes
  ([0027](0027-email-through-gmail-api.md)), so outside production it goes to the safe address.
- **Emailing them is a switch, on by default** (#164): "Email them a link to the app" in the sheet, and the main
  button says what it'll do, **Add and email them** or **Add**. Off (`emailThem: false`), nothing is sent: they're in
  all the same and sign in with their address (a code, then a passkey) whenever they're told, in person or later. A
  request that doesn't say emails them, as before.
- **The email failing doesn't undo the add.** The reply says `emailed: false` and the admin is told to send the link
  themselves.
- **Send them the app link**, on the member's card (Their account, `manage:Member`): the same welcome, one email a
  tap, for a quiet add or an email that went astray. `POST /api/members/:id/app-link`; only for someone active with
  an email (409, 400 otherwise), `emailed` in the reply.
- **On the record:** `member.added` says whether the add emailed them (`emailed`), and each Send the app link is a
  `member.app_link` entry, sent or not.

**Asking to join**

- **The admins hear at once.** Someone asking to join on the sign-in screen is a `pending` member; everyone who lets
  members in (`manage:Member`) gets one email naming them, with a link to their sheet
  (`<origin>/settings/members?member=<id>`, which opens it). Asking again with the same email sends nothing.
- **They hear once they're in.** An admin moving them from pending to active sends them the same welcome as an added
  member: the link that fills in their address on the sign-in screen. Both go through Gmail like the codes, so the dev
  allow list ([0027](0027-email-through-gmail-api.md)) and the breaker ([0055](0055-degrade-instead-of-break.md))
  apply; an email that doesn't go never undoes the change (`worker/members/members.mail.ts`).

**Importing members**

- Members' **Manage** button (one button, [0065](0065-page-frame-and-admin-actions.md)) has two tools: Add a member
  (above) and **Import members**, a side drawer. The admin chooses a file: a spreadsheet saved as CSV whose first row
  names the columns, or the roster's JSON ([db/seed/README.md](../../db/seed/README.md)). The columns are the club's
  own sheet's, matched in any case and any order (others are ignored); the drawer's **Download template** has exactly
  them, in this order, with one example row:
  - `name` (needed); `position` F/D/G (F if blank);
  - `subx` (also `subscription`, `plan`, `quarterly`): this quarter's plan ([0007](0007-dues-and-payments.md)).
    `quarterly`, `q`, `yes`, `y`, `true`, `1`, `sub`, `subscription` make them a Quarterly Member from the import's
    day, as an admin ticking Quarterly does; `payg`, `pay as you go`, `no`, `n`, `false`, `0` or blank, pay as you go;
    `keeper` only for a G (anyone else is a problem row). A G is on the Keeper plan whatever it says;
  - `email`; `role` (or `roles`): role names in any case, several separated by `;` or `|`;
  - `is Cougars` (or `cougars`, `cougar`): yes/no, y/n, true/false, 1/0, x;
  - `rating` 0–100, optional: 50 if left out, the database's default, as for anyone an admin adds.
- `POST /api/members/import` with `{ file }` checks it and changes nothing: who'd be added, who's already in the club
  (same email, or same name: skipped and left as they are, as the roster seed does) and what's wrong, by row (a bad
  position, rating or plan, a keeper who isn't a G, an unknown role, a role that can do more than the importer, the
  same name or email twice), with each person's plan.
  With `apply: true` it adds them, refusing a file with any problem.
- **All or nothing, in one D1 batch** (insert, payment reference, roles per member, then one `INSERT … SELECT` over
  `json_each` that gives every Quarterly row its subscription, found by name and the import's `created_at`): the free
  plan allows 50 queries per request, and a half-imported file would be worse than none. Up to 500 rows a file.
- **Nobody is emailed.** An import is for bringing the club in at launch; the admins say when the app's ready, and
  everyone signs in with the email in the file; anyone can be sent the link from their card (Send them the app
  link). On the record as `members.imported`, with the names.

**The members table**

- The table is **Settings → Members** (`/settings/members`, Club section, `manage:Member`). Teammates is cards only,
  for everyone; it keeps the join requests, and a card's tap opens the member sheet for an admin.
- Members is a `.page.fill`: past the frame, every bit of width beside the settings list to the window's edge, and the
  window's height. The table scrolls inside itself, its header row and the pinned Name column in view. On a short
  phone it keeps at least a few rows' height and the page scrolls too.
- Columns are as wide as what's in them (`fitCellContents`), any room left shared out, re-fitted when the rows change.
  Cells are tight (8px) so the table fits beside the settings list at 1440px; past that it scrolls sideways inside
  itself, never off the page. The settings list stays, so the title keeps its place.

**The member sheet**

- A member's details (name, role, plan, position, rating, Cougars team, email, phone) are a draft until **Save**, in a
  footer that stays at the bottom of the sheet (on a phone too, where the whole sheet scrolls). **Discard** puts the
  draft back. Only what changed goes to the server.
- Closing with unsaved changes (×, Escape, a tap outside) doesn't close: the footer asks, with Keep editing, Discard
  and Save.
- Attendance (tapping a Friday) is part of the draft too: a tap shows at once and goes with Save, through the
  register's rules. Fees (marking a charge paid) still save as they're tapped: each is its own payment record.
- Training teams aren't a form and still save as you change them ([0076](0076-training-teams.md)).

## Consequences

- Adding a member needs no new secret or service: the same Gmail sender, inside its free quota.
- Approving someone who asked to join still sends nothing; it could send the same email.
- Production starts with only its admins and is filled by an import ([0050](0050-schema-and-seed-until-launch.md)).
  Someone imported without an email can't sign in until an admin adds one.
- An admin's table has the room it needs and its header never scrolls away; members never see a toggle they can't use.
- A narrow desktop window with long emails still scrolls the table sideways. Hiding the settings list on this page
  would give it about 250px more, at the cost of the title moving between settings pages.
- `.page.fill` is for a page that is one big table. Anything else stays `page` or `page full`.
- An admin sees when there's something unsaved and can back out of it. One more tap per change; forgetting is caught
  by the close check, not lost.
- A sheet mixes a draft (details and attendance) and a live action (fees); the footer's note and the sections' order
  make which is which clear.

## History

- 2026-10-08: An admin adds a member from Teammates, and the app emails them a link to itself (was 0069).
- 2026-10-08: The admins' table left Teammates for Settings → Members, a `.page.fill` page that fills the window
  (was 0080).
- 2026-10-08: The member sheet stopped saving each field as it changed; details and attendance save with a Save button
  (was 0082).
- 2026-10-09: Members' Add button became Manage, with Import members: a CSV (or the roster's JSON), checked first, then
  added all at once with nobody emailed.
- 2026-10-10: Asking to join emails the admins, with a link to the member's sheet; being let in emails the member
  (#77).
- 2026-10-21: Import takes the club's own spreadsheet: a `subx` column for the plan (Quarterly from the import's day,
  pay as you go, Keeper for a G), header aliases (`role`, `is Cougars`), and a Download template with the club's
  columns; the check shows each person's plan.
- 2026-10-23: Adding a member can leave the email off (a switch, on by default; the button says Add or Add and email
  them), and the member's card has Send them the app link for later; the record says whether they were emailed. Import
  still sends nothing (#164).
