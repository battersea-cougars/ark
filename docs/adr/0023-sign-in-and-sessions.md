# 0023. Everyone signs in with a passkey or an emailed code that works only in the browser that asked for it

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-24
- **Merges:** 0008, 0035, 0093, 0094

## Context

Every member signs in to the team app, mostly from a phone, often from the installed PWA. They won't manage
passwords well, and we won't pay for an identity provider ([0003](0003-free-tiers-only.md)). Two problems with a
plain magic link:

- On an iPhone an installed web app keeps its sign-in apart from every browser, and a link in an email always opens
  a browser, so a link could never sign in the app most members use.
- A link or a code can be forwarded, and whoever opens it is signed in.

Every request already looks the session up in D1, so that an admin can sign someone out and an inactive member is
shut out at once. With that lookup, a signed cookie adds nothing: the row decides.

Local dev needs a way to sign in when nothing is emailed from a laptop, and that way must never work on a deployed
worker.

A code needs Gmail. When Gmail is down (a spent sending limit, a lost token, #101), nobody signs in, admins included,
and it's admins who would fix it. Members want "proper login" too: a passkey (WebAuthn) signs in with the face,
finger or PIN the phone already uses, with nothing to type, in the browser and in the iPhone app. Passkeys cost
nothing ([0003](0003-free-tiers-only.md)). If every admin also lost their passkeys while Gmail was down, the club would
need a way back in that no stranger on the internet could use.

## Decision

**Sign-in**

- A member enters their email. The Worker sets a private **nonce cookie** on that browser and emails a **6-digit
  code**, and nothing else: no link. The code signs in only alongside the nonce cookie, so a forwarded email signs no
  one in ("open this on the device you signed in from"). The email shows the code first and huge, in the club's
  colours (`apps/team/worker/auth/auth.email.ts`), with a plain-text version saying the same.
- Codes are sent only to the email on the member's own account. An unknown email gets the same reply, after the
  same work (the member looked up, the browser's codes checked), so the form doesn't reveal who's a member, not even
  by how long it takes: a member's code is made and emailed after the reply.
- Codes are stored hashed (SHA-256), are single-use and expire after 15 minutes.
- **One browser, one member, any of its codes.** A browser keeps its nonce while it asks again for the same member,
  so any code it asked for in the last 15 minutes works there, and using one spends all of them. Asking for a
  _different_ member's code starts a fresh nonce, and the earlier member's codes die with the old one. So every live
  code under a nonce is one member's, and every guess is against that member's code, whoever is typing. Two
  people signing in one after the other on a shared browser each get their own code.
- **Guesses are counted before they're checked**, in one statement, and a code is spent the same way, so requests
  sent all at once can't get extra tries or two sessions. The limits:
  - 5 wrong codes per code;
  - 5 codes an hour and 10 a day per member **per browser** (its nonce);
  - 20 wrong codes a day per browser, after which that browser is sent and accepts no codes until the day has passed;
  - 30 codes a day per member across every browser, their inbox's limit (logged as `sign_in.capped`).
    The limits count against the browser asking, not the member: someone who knows a member's email can't use them up
    and lock the member out of their own browser (#69).
  - per address, best effort: 10 code requests in 10 minutes and 5 requests to join an hour;
  - asking to join stops while 50 people are waiting (the same reply for everyone), and an unanswered request goes
    after 30 days;
  - **Turnstile** in front of asking for a code and asking to join, refusing a failed check
    ([0028](0028-turnstile-and-auto-reply.md), #13).
- New people **request access**; an admin approves them ([0024](0024-action-based-authorization.md)).
- The email goes through the Gmail API (`packages/shared/email.ts`, [0027](0027-email-through-gmail-api.md)).
- **Sign in with Google** (OAuth with PKCE, for a member whose verified Google email matches) is planned as a
  shortcut. It isn't built.

**Passkeys** (`worker/auth/auth.passkeys.ts`, `src/app/passkeys.ts`)

- A signed-in member adds one on the **You page** ("Use Face ID next time", Touch ID, Windows Hello, "your
  fingerprint", by device), sees each (named for the device it was made on and who keeps it, "iPhone · iCloud
  Keychain", with the day it was added and last used) and removes any. After a **code** sign-in on a device that can
  make one, Home offers one **once** ("Not now" or adding it, remembered on the device). The **sign-in page** offers
  the device's passkey in the email field's suggestions where the browser can (conditional mediation), and a **Sign
  in with a passkey** button; the emailed code stays for a first sign-in, a new phone or a lost passkey.
- Verified in the Worker with WebCrypto by **@simplewebauthn/server** (ES256 and RS256; no attestation asked for, so
  no vendor lists); the browser side is **@simplewebauthn/browser**. Discoverable passkeys only, and **user
  verification required** both when adding one and signing in. The member is a random 32-byte handle on the passkey,
  never their number or email; their other passkeys are listed when adding one, so a device never makes two. At most
  10 a member.
- **Challenges** (`passkey_challenges`): random, stored as their SHA-256, single-use, **five minutes**. Adding a
  passkey: bound to the session that asked. Signing in: bound to the browser that asked by a nonce cookie of its own
  (`cougars_passkey`, `__Host-` on https, five minutes), as a code is to its nonce. The challenge is **spent in the
  statement that claims it**, before the signature is checked, so two requests carrying one answer make at most one
  session ([0121](0121-load-and-concurrency.md)), and a replayed answer, another browser's, a late one or one signed
  for another challenge or another site is refused.
- **The signature counter** moves on only from the value read (`UPDATE … WHERE sign_count = ?`): a counter that's
  gone backwards, or two sign-ins with the same count, is a copied key, refused and on the record
  (`sign_in.passkey_cloned`). Synced passkeys (iCloud Keychain, Google Password Manager) always say 0, and stay so.
- **Where a passkey belongs** (its RP ID) is the host the request came to, and the browser's reported origin must be
  that request's origin: `localhost` on your machine, `team.cougars-dev.workers.dev` on dev, production's team domain
  (`team.` + `SITE_URL`'s host, `scripts/ci/target.mjs`, which turns `workers_dev` off there so production answers on
  nothing else). No setting to keep in step. A passkey made on dev doesn't work on production, and a LAN address over
  http can't use passkeys at all (the button isn't shown).
- **A passkey sign-in is a session like a code's** (method `passkey`): the same cookie, renewals, limits and endings;
  an inactive member is refused, and the page is told when a passkey isn't known (removed), so it can tell the device
  (`signalUnknownCredential`). Removing a passkey doesn't sign anyone out.
- **What takes passkeys away**: the member (You page), an admin from the member's sheet (**Remove their passkeys**,
  `DELETE /api/members/:id/passkeys`, `manage:Member`, never for someone who can do more than them, on the record as
  `member.passkeys_removed`), being **made inactive**, a **new sign-in email** (whoever had the account before keeps
  no way in) and deleting the account. **Sign out everywhere** (the member's or an admin's) ends sessions only: a
  passkey needs the member's own face or PIN on their own device, which a copied cookie doesn't, and someone worried
  about a lost phone removes its passkey beside it. Letting someone back in starts them with a code.
- **The iPhone app** loads the team app's own address in WKWebView ([0108](0108-store-apps.md)), so its passkeys are
  the domain's; the app may use them because its entitlements list `webcredentials:` for both team domains beside
  `applinks:`, and the domain's `apple-app-site-association` (`store.links.ts`) names the app under
  `webcredentials` (a test holds the two lists together).

**Break glass** (`scripts/admin-break-glass.mjs`, `worker/auth/auth.break-glass.ts`)

- For when Gmail is down, every admin has lost their passkeys and none is signed in. **Never a web route**: someone
  with the club's Bitwarden and that environment's Cloudflare token runs `npm run admin:break-glass -- <email>
[--env dev|production]` (production asks for the email again). It refuses unless the email is an active member
  holding `manage:all`, writes **one** code for them in `login_challenges` (hashed like any code, **15 minutes**,
  `kind` `break_glass`), calls off any earlier one of theirs not yet used, and prints the code on that terminal only.
- **Accepting it without a nonce**: no browser asked for it, so it starts unclaimed (`nonce_hash` `break-glass`,
  never a hash). The admin types their email on the usual sign-in page: the **first browser to ask** for that
  member's code **claims it** (one `UPDATE … WHERE nonce_hash = 'break-glass'`), and is sent nothing, so it works with
  Gmail down. From then on it's a code like any other, bound to that browser: 5 wrong tries, the browser's 20 a day,
  single-use, and spending it ends that browser's other codes. Someone else who knows the admin's email and asks in
  the same 15 minutes would claim it first and still face a one-in-a-million code with five tries; the admin would
  find it doesn't work and run the script again. Asking for that member's code while it waits answers as usual (no
  "paused email" reply), which says something only to someone who knew the email and asked in those minutes.
- **Everyone knows**: on the record as `auth.break_glass` (`issued`, with who ran it, the machine's user and git email;
  `signed_in`, with the session; `ended`); its session's method is `break_glass`. When it's used every admin is told on
  their phone (topic `security`, a switch only admins see) and by email, if email works, neither waiting on the other.
  Each admin's Home lists the week's break-glass codes and sessions (`GET /api/break-glass`, `manage:Member`), with
  **Sign it out** for a session or **Call it off** for a code not used (`POST /api/break-glass/sessions|codes/:id/end`,
  on the record).

**Sessions**

- The session cookie holds a **random 256-bit token**. D1 keeps only its SHA-256 hash in `auth_sessions`, as it does
  for the nonce and the code. There is no signing key and no `TEAM_SESSION_SECRET`.
- The session lasts 180 days. Its expiry moves on at most once a day while it's used, so most requests read and don't
  write, and never past **a year from signing in**: then it's the code again. Each renewal gives the session a **new
  token** (`previous_hash`, `rotated_at` in `auth_sessions`); the one before still works for 10 minutes, for requests
  already on their way and a reply whose new cookie never arrived. Only one request renews it (the update names the
  token it replaces), so two arriving together don't race. A copied cookie stops working once its member's next
  renewal is 10 minutes old.
- **Ending sessions** (`worker/auth/auth.sessions.ts`, #72): signing out (this browser), **Sign out everywhere** on
  the You page (every browser and phone of yours, this one too), and an admin's **Sign out everywhere** on a member's
  sheet (`POST /api/members/:id/sign-out`, `manage:Member`, never for someone who can do more than them, on the
  record as `member.signed_out` with how many sign-ins it ended). A **new sign-in email** and being **made inactive**
  end every session on their own, so letting someone back in opens none of their old ones. An ended session is
  revoked, its phones go (its `push_devices` rows, store app and web push alike, so nothing more is sent to them) and
  its live streams close at the hub ([0072](0072-live-updates.md)). Deleting an account deletes its sessions (the
  phones go with them, `ON DELETE CASCADE`) and closes its streams.
- Cookies: `cougars_session` and `cougars_nonce` (15 minutes), both `HttpOnly`, `SameSite=Lax` and `Path=/`. On https
  they're `Secure` and named with the `__Host-` prefix, so no sibling subdomain can set or shadow them.
- Sign-ins, sign-outs, capped sign-ins and requests to join go in `audit_log` ([0095](0095-audit-log.md)).

**Local dev**

- Local dev (`vite`) signs in the same way. Two switches exist for your own machine: `TEAM_ENV=local` returns the
  code in `/api/auth/start`'s reply (nothing is emailed from a laptop), and `TEAM_AUTO_ADMIN=1` in the shell makes
  any request without a session the first admin, for screenshots and tests. Only `vite`'s serve config sets them; a
  build carries neither, and `scripts/ci/target.mjs` writes only `SITE_ENV`.
- **Signing in without a code, for scripts, tests and agents**: `POST /api/auth/dev` with an active member's email
  (none: the first admin) starts a real session at once, with no code and none of sign-in's caps, as often as asked.
  `node scripts/dev-sign-in.mjs [email]` calls it and writes a Playwright storage state (`.auth/team.json`, ignored by
  git), so a headless browser opens signed in, each run a session of its own that never touches yours. It's on the
  record as `sign_in` with method `dev`. Anywhere but your own machine the route isn't there (404), and the team
  smoke test checks that.
- **All three also need a private address.** `localHere(env, request)` (`worker/auth/auth.ts`) is true only when
  `TEAM_ENV` is `local` _and_ the request's host is loopback, a private range (10/8, 172.16/12, 192.168/16),
  `localhost`, or a `.test` name (reserved, never public; the tests' host). A deployed worker is reached by its
  public name, so on it the switches do nothing even if set. A phone on the house wifi still reaches the laptop by
  its LAN address.
- **A test reads `wrangler.jsonc` and `target.mjs`** and fails if either names a switch
  (`scripts/team-app-config.test.mjs`).
- **The deploy's smoke test** asks the live worker for `/api/bootstrap` with no session and fails unless it's 401.

## Consequences

- Two ways to sign in, the same in the PWA, in a browser and in the store app: a passkey, or the code from the email.
- A member with a passkey signs in without email; a first sign-in, a new phone or a lost passkey still depends on email
  delivery. With Gmail down and no passkey, an admin gets in by break glass, which needs someone with the club's
  Bitwarden and Cloudflare at a terminal, and then lets others in the usual ways.
- A stolen database can't sign anyone in with a passkey either: it holds public keys.
- The Worker carries @simplewebauthn/server (a few hundred KB of the bundle, nothing per request beyond one signature
  check); a passkey sign-in is two requests and a handful of D1 statements.
- No session secret to create, rotate and document.
- A stolen database can't sign anyone in, because it holds only hashes. A stolen cookie works until the session is
  ended (by the member, an admin, an email change or being made inactive) or its member's next renewal, whichever
  is first; if the thief renews first, the member is the one signed out, and signs in again.
- A member whose phone loses the reply that carried the new cookie, and stays offline more than 10 minutes, signs
  in again.
- Each API request makes one indexed D1 read for the session, well inside the free tier for a club.
- The limits mean what they say: 5 wrong per code, 20 a day per browser, 30 codes a day per member. The odds of
  guessing are negligible (at most 150 tries a day against a one-in-a-million code that lasts 15 minutes).
- Someone rotating browsers and addresses could use up a member's 30 codes for a day; Turnstile (#13) makes each
  request need a person's browser, so it would take a person.
- For a deploy to open up the local switches, three independent things now have to go wrong: the config, the config
  test and the smoke test.
- A tunnel to your laptop (a public name onto a local server) doesn't get the code on screen or the auto admin; sign
  in from the laptop's own address instead.
- If Google sign-in is built, it adds a Google OAuth client to the secrets and a dependency on Google for that
  shortcut.

## History

- 2026-10-05: Admins log in with a one-time magic link to an allow-listed email, with a signed session cookie (was
  0008).
- 2026-10-06: Every member signs in, with a device-bound code or link, or Google; the session an HMAC-signed cookie
  backed by `auth_sessions` (was 0023).
- 2026-10-06: The session becomes a hashed random token with no signing key; the link is dropped because it can't
  reach the installed iPhone app; guess limits counted before checking; local dev switches added (was 0035).
- 2026-10-09: A security review found nothing stopped the local switches working on a deployed worker; they now need
  a private address, a config test and a smoke test (was 0093).
- 2026-10-09: The same review found one browser holding codes for two members let guesses count against the wrong
  member; asking for another member's code now starts a fresh nonce (was 0094).
- 2026-10-09: The code email is branded HTML with the code big and split in two (123 456), beside the plain text.
- 2026-10-10: Signing in without a code on your own machine (`/api/auth/dev`, `scripts/dev-sign-in.mjs`), after
  headless sessions kept running into the code caps (five an hour, ten a day) and screenshots needed a member's code.
- 2026-10-10: The code limits count per browser (its nonce), with a ceiling of 30 a day per member, after a review
  showed 20 wrong guesses from anywhere locked a member out for a day (#69).
- 2026-10-11: App Review's account signs in with a fixed code set by secrets in production only, and the store app's phone registers for notifications at `/api/auth/device`, belonging to its sign-in ([0108](0108-store-apps.md)).
- 2026-10-21: Sessions end: an admin signs a member out everywhere from their sheet, a member everywhere from the You
  page, and a new email or being made inactive does it on its own; an ended session's phones and live streams go with
  it. Renewal rotates the token (10 minutes' grace) and a session ends a year after signing in (#72).
- 2026-10-21: Turnstile in front of asking for a code and asking to join (#13, [0028](0028-turnstile-and-auto-reply.md)).
- 2026-10-22: Passkeys: added on the You page and offered once after a code sign-in, signed in with on the sign-in
  page (and its email field's suggestions), verified in the Worker with @simplewebauthn/server; challenges single-use,
  five minutes, bound to the session or browser that asked and spent before checking; counter checked in its
  statement; the RP ID is the request's own host. Being made inactive, a new email, an admin or the member remove
  passkeys; sign out everywhere doesn't. The iPhone app gets `webcredentials:` for both team domains.
- 2026-10-22: Break glass: a terminal script writes one 15-minute code for an active admin, which the first browser to
  ask for their code claims; every use on the record, every admin told (phone, email, Home) and able to sign it out.
- 2026-10-23: A member changes their own sign-in email from the You page: a code to the new address (stored hashed,
  15 minutes, 5 tries, 5 an hour and 10 a day), typed while signed in. Their other sessions end, this one stays, and the
  old address is told. An address that's someone else's gets a note instead of a code, with the same reply, so the app
  never says whose it is. Everything a member did stays theirs, as it hangs on their id, not their address.
- 2026-10-23: Changing your own sign-in email keeps your passkeys: you're signed in and confirm the new address with a
  code, so the account is still yours. An admin changing someone's email still removes theirs.
- 2026-10-24: A member's code is made and emailed after the reply, so asking for a member's address takes no longer
  than a stranger's (#81).
