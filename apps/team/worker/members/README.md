# Members

The rules for who's in the club and how they get in, in plain words. Each one is checked by the use-case test it links;
change the rule, the test and this line together. Why a piece of code is the way it is stays in a comment beside it.

## Adding a member

- An admin adds someone with their name, email and position, and they're in the club at once, with a payment reference;
  the app emails them a link to itself that fills in their address on the sign-in screen.
  [members.use-cases.test.ts › "they're in the club straight away, and get an email with a link to the app"](members.use-cases.test.ts)
- The link signs nobody in by itself: they sign in with that email, as anyone does.
  [members.use-cases.test.ts › "they sign in with that email, as anyone does"](members.use-cases.test.ts)
- An email already in the club, in any capitals, is refused, so nobody is in twice.
  [members.use-cases.test.ts › "an email already in the club is refused, so nobody ends up twice"](members.use-cases.test.ts)
- Emailing them is a switch, on to start with; off, nothing is sent and they're in all the same.
  [members.use-cases.test.ts › "with the email off nothing is sent, and they're in and sign in with their address as anyone does"](members.use-cases.test.ts)
- The email failing doesn't undo the add: they're in, and the admin is told it wasn't sent.
  [members.use-cases.test.ts › "the email failing doesn't undo the add: they're in, and the admin hears it wasn't sent"](members.use-cases.test.ts)
- Later, Send them the app link on their card sends the same welcome, for someone in the club with an email; the add
  and each link sent are on the record, saying whether they were emailed.
  [members.use-cases.test.ts › "later, Send them the app link from their card sends one email, and it's on the record"](members.use-cases.test.ts)

## Asking to join

- Someone asking to join on the sign-in screen waits for an admin; everyone who lets members in gets one email naming
  them, with a link to their sheet. Asking again with the same email sends nothing more.
  [members.join.use-cases.test.ts › "the admins get an email at once, with a link to the member's sheet"](members.join.use-cases.test.ts)
- Once an admin lets them in, they get "You're in" with the way to sign in.
  [members.join.use-cases.test.ts › "once an admin lets them in, they get “You're in” with the way to sign in"](members.join.use-cases.test.ts)

## Importing members

- An admin imports the club from a spreadsheet saved as CSV (or the roster's JSON). Checking the file says who'd be
  added, who's in already (same email or name, left as they are) and what's wrong by row, and changes nothing.
  [members.import.use-cases.test.ts › "checking the file says who'd be added and who's in already, and changes nothing"](members.import.use-cases.test.ts)
- The club's own sheet's columns are understood in any case and order, and the plan column makes someone a Quarterly
  Member from the import's day, pay as you go, or, for a goalie, the Keeper plan.
  [members.import.use-cases.test.ts › "every way of saying the plan is understood, under any of its headers"](members.import.use-cases.test.ts)
- A file with any problem adds nobody: all or nothing.
  [members.import.use-cases.test.ts › "a file with mistakes says which rows and why, and adds nobody"](members.import.use-cases.test.ts)
- Nobody can import a role that can do more than they can.
  [members.edge-cases.use-cases.test.ts › "a member manager can't import a role that can do more than they can"](members.edge-cases.use-cases.test.ts)
- Up to 500 players a file.
  [members.edge-cases.use-cases.test.ts › "500 players in a file is fine; 501 is refused"](members.edge-cases.use-cases.test.ts)
- Nobody in the file is emailed: the admins say when the app's ready, and each signs in with the email in the file.
  [members.import.use-cases.test.ts › "nobody in the file is emailed: the admins say when the app's ready"](members.import.use-cases.test.ts)
- Importing the same file again adds nobody twice.
  [members.import.use-cases.test.ts › "importing the same sheet again adds nobody twice, and nobody gets a second subscription"](members.import.use-cases.test.ts)

## The members table and the member sheet

- The table of members is Settings → Members, for whoever lets members in; The club is cards, for everyone.
  [members.journey.ts › "can't open Settings → Members: Not for this role"](../../journeys/members.journey.ts)
- A member's details on their sheet are a draft until Save.
  [members.journey.ts › "changes their name, email and position on their card, and saves"](../../journeys/members.journey.ts)
- Closing the sheet with unsaved changes asks first.
  [dirty.test.ts › "asks before closing with changes"](../../src/lib/dirty.test.ts)

## The name you go by

- A member chooses how their name shows, and it's the name they go by everywhere in the app; with nothing chosen it's
  their full name.
  [names.test.ts › "is the name they chose on their profile, everywhere in the app"](../../src/lib/names.test.ts)
- Where the app says just a first name (the card, greetings), a chosen name is used whole.
  [names.test.ts › "uses a chosen name whole where the app says just a first name (the card, greetings), and otherwise their first name"](../../src/lib/names.test.ts)
- Search finds a member by either name.
  [names.test.ts › "finds them by either name when searching"](../../src/lib/names.test.ts)
- An admin can set or clear the name someone goes by.
  [members.use-cases.test.ts › "sets it for them, and it shows everywhere in place of their full name"](members.use-cases.test.ts)

## Photos

- A member puts up their own photo, and everyone in the club sees it in place of their initials.
  [members.photo.use-cases.test.ts › "everyone in the club sees it, at an address that changes when it does"](members.photo.use-cases.test.ts)
- Only your own: nobody sets or takes down someone else's.
  [members.photo.use-cases.test.ts › "it's only your own: the body can't name someone else"](members.photo.use-cases.test.ts)
- A small PNG, JPEG or WebP only.
  [members.photo.use-cases.test.ts › "anything but a small PNG, JPEG or WebP is refused"](members.photo.use-cases.test.ts)
- Nobody signed out sees it.
  [members.photo.use-cases.test.ts › "nobody signed out sees it"](members.photo.use-cases.test.ts)
- It's personal data: it's in the data you download, and goes when you delete your account.
  [members.photo.use-cases.test.ts › "it goes with them when they delete their account"](members.photo.use-cases.test.ts)
