# 0108. The team app in the app stores: a native shell that loads the live app, with notifications; iOS first, Android-ready

- **Status:** Accepted
- **Date:** 2026-10-11 · updated 2026-10-24

## Context

On an iPhone the team app can only be added to the Home Screen by hand (Share → Add to Home Screen): Safari never
offers to install it, and most members won't find that. We want it in the App Store, with notifications, and later
in the Play Store. [0022](0022-team-app-svelte-pwa.md) expected this ("a store app wraps the same build with
Capacitor", #26); [0003](0003-free-tiers-only.md) said the store fees need agreeing: Apple's is paid on an existing
Apple Developer account.

Three things shape it:

- **Sign-in and every change are first-party.** The session and the sign-in nonce are `__Host-` cookies,
  `SameSite=Lax`; every change must come from the app's own origin ([0024](0024-action-based-authorization.md)); there's no CORS.
  A shell serving a bundled copy of the app (at `capacitor://localhost`) would be another origin: sign-in and every
  change would break, and the cookies wouldn't be kept.
- **Apple rejects a website in a wrapper** (App Store Review Guideline 4.2): the app must do things a Home Screen
  icon can't.
- **No Mac.** The repo is public, so GitHub's macOS runners are free.

## Decision

- **A Capacitor shell that loads the live team app** (`apps/team/capacitor.config.ts`, `server.url`): dev's for test
  builds, production's for the store. Sign-in, the live hub, the update offer ([0022](0022-team-app-svelte-pwa.md))
  and every change work as in a browser, and **a deploy of `team` updates the app**: the shell is rebuilt only when it
  changes. Only the offline screen is in the app (`apps/team/native/offline.html`, "Can't reach the club", Try again).
  `limitsNavigationsToAppBoundDomains` keeps the shell to the team app's own domains, and Turnstile's
  (`challenges.cloudflare.com`, the sign-in page's check, [0027](0027-email-through-gmail-api.md)).
- **What the app does that a browser can't** (`src/app/native.ts`, which asks "is this the app", never "is this an
  iPhone", and falls back to the browser's way everywhere else):
  - **Notifications**: the night's teams are out (which team you're on), a place came up off the waitlist, a
    Quarterly Member took your place and you're waiting ([the training notes](../../apps/team/worker/training/README.md), #97), a session
    you're in is off, an announcement, a training night's sign-up is open (on its day, once a night, from the cron:
    `worker/training/training.signup.ts`, topic `places`, queued for the push drain straight after it). A route says what's news with `notify` (`worker/push/push.notices.ts`), read
    before and after the change like the record ([0024](0024-action-based-authorization.md)); the wrapper sends it after the reply
    (`waitUntil`), and a notification that can't be sent never fails the change. A place changing hands isn't worked out from before and after
    (two requests at once would both see it): the statement that moves someone marks their sign-up (`moved`: up
    because a place came up, up by the team maker's Let in, or bumped down by a Quarterly Member), and `places` reads and
    clears every mark in one batch, so each move is told once whichever request gets there first
    ([0003](0003-free-tiers-only.md)). Every route that can move someone says `notify: places`: an answer, an
    admin putting someone in or taking them off, Let in, the register (a night's, or a member's Fridays), a limit raised
    (a training, a tournament, a club event), an account deleted. Home asks once, a row in its feed
    ([the team app's page notes](../../apps/team/src/pages/README.md)) saying what they're for, before the phone's own question; "Not now" is remembered. Next quarter's fee a few days before it starts, to its Quarterly Members (topic `dues`, from the hourly cron, an
    email instead for anyone without the app, #187). A reminder of what you owe
    ([the dues notes](../../apps/team/worker/dues/README.md)) comes with its email: the dues code tells a member through
    `worker/tell/tell.ts`, which sends the email and hands the notification to `notify`.
  - **A topic each, the member's to switch off** (#24): every Notice says its topic, from one list
    (`src/lib/notification-topics.ts`: `teams`, `places`, `sessionOff`, `announcements`, `dues`, `draft`, `email`, `security`, `usage`; a topic
    joins it only once something's sent on it, so there's never a switch for nothing). `draft`: a draft's opening,
    to each of its captains with their place ([the tournament notes](../../apps/team/worker/tournaments/README.md)). `security`: a break-glass sign-in, to
    admins only, whose switch only admins see ([0023](0023-sign-in-and-sessions.md)). `usage` ("Free limits"): a free
    limit at 70% or 90%, or a request stopped for its CPU time, to admins only, whose switch only they see
    ([0003](0003-free-tiers-only.md)). Every topic is on until a member
    turns it off: `notification_prefs` holds only what they switched, and the statement that fills the outbox skips
    them, so choosing costs no round trip. The choice is the member's, not a device's: one copy, whichever phone or
    browser they sign in on. The You page shows a switch per topic to everyone; it's in the bootstrap
    (`notifications`), and `PUT /api/me/notifications` (`worker/push/push.routes.ts`) changes only your own.
  - **Links to the team app open the app** (an email's "Open the app"): the Worker answers
    `/.well-known/apple-app-site-association` from `APPLE_TEAM_ID` (`worker/store/store.links.ts`), and a link or a
    tapped notification opens its page.
  - **The game clock** buzzes (haptics) and keeps the screen on; **Add to calendar** goes to the share sheet.
- **Notifications go through Firebase Cloud Messaging** (free, the club's Google Cloud project): it reaches iPhones
  (through Apple's push service, its key uploaded to Firebase) and Android phones over plain HTTPS, which a Worker
  can speak (Apple's own service wants HTTP/2). The Worker signs an hour's token with a service account (WebCrypto,
  `worker/push/fcm.ts`) and sends one request per phone. **A phone belongs to a sign-in** (`push_devices.session_id`):
  signing out, or the session running out, stops its notifications, with nothing more for the app to do; a token
  Firebase says is gone is forgotten. The phone registers at `PUT /api/auth/device`, beside sign-in and sign-out,
  not as a change to the club (no data version bump).
- **Sending within the free plan.** Workers Free allows 50 subrequests (fetches) an invocation and FCM takes one
  request per phone, so a send to every phone can't go out at once. Each notification is a row in `push_outbox`, **one
  per member per notice**, sent to whichever devices they're signed in on when it goes (a phone registered overnight
  hears the morning's news). The route's `waitUntil` writes the rows in one statement and, in the same round trip,
  claims what's due and sends it. A batch is at most `SEND_AT_ONCE` (40) devices, a member's devices counted at the
  claim: with Google's access token, the live hub and a Sentry report that leaves about ten fetches to spare. The rest
  go from the cron (`push.drain`): **every minute** (`* * * * *`) a whole batch of 40, and on the five-minute run
  `DRAIN_AT_ONCE` (25), since that run also sends dues reminders and may ask for a website rebuild
  ([0003](0003-free-tiers-only.md) has the sums); the minute run skips the minutes the five-minute one runs. A
  third cron trigger is free (5 an account; the team Worker has 3, the website 1), and every five minutes wasn't
  enough: a debounced notice would wait up to seven minutes, and 120 phones held overnight would take 25 minutes from
  08:00; a minute's run makes them about three. A notification sent with an email (`tell`) is only queued, for the
  next drain: the emails have taken the invocation's requests. Rows are claimed before sending (one
  `UPDATE … RETURNING`, state `queued` → `claimed` → `sent` or `dropped`), so two sends at once never send a phone
  twice, and what became of a batch is one round trip after it. A failed send is tried again after 5, 10 and 20
  minutes on the devices it failed on, then given up and logged (`push.gave_up`); a row for a member with no device
  left, or a topic turned off since, is dropped, not sent; a device Firebase or a push service says is gone is
  forgotten; sent rows are pruned after a week. Without `FIREBASE_SERVICE_ACCOUNT` (your machine, tests) every row is
  caught or logged at once and nothing waits: no quiet hours or debounce, as there's no cron to send it later.
- **Quiet hours and the debounce decide when a row is due** (`worker/push/push.rules.ts`: every number in one place).
  - **Quiet hours, 22:00 to 08:00 London** (`QUIET_HOURS`), on London's clock, so the night the clocks go back
    08:00 is 08:00 GMT and the night they go forward 08:00 BST: a notice that comes in them waits for 08:00. A notice
    about something happening now says `live` and goes anyway; the route marks it, never a guess by topic. Live: the
    draft opening and pausing (on the night, `draftOpen`, `draftPaused`). The awards' reveal sends nothing.
    Not live: teams out, a place (in, let in, bumped), a night off, announcements, a training's sign-up
    opening (at midnight, so heard at 08:00), dues. The draft's "your pick" and Chong Li's "You are next!" are on the
    page, not sent; when they are, they'll be live.
  - **The debounce, two minutes per member and thing** (`DEBOUNCE_MINUTES`; a notice's `key`, such as
    `places:session:12` for their place that night, `teams:12`, `draft:3`, `announcement:7`). The first goes at once;
    another on the same key within two minutes of the last one told waits out the rest, and a newer one still takes
    its place (`ON CONFLICT … DO UPDATE` on the one waiting per member and key: the latest words win, sent at the
    earlier of the two times). A row that was replaced and ends saying what the member was last told about the key
    (`says`: "in", "waitlist", a team; `push_told` keeps the last per member and key, a week) is dropped: in, bumped,
    in again within two minutes is one "You're in". Live notices are debounced too: open, pause, open within two
    minutes is one "Draft Open".
- **App Review signs in** with one member's email that takes a fixed code (`APP_REVIEW_EMAIL`/`APP_REVIEW_CODE`,
  production only): reviewers can't read our email. The nonce, tries and limits still apply
  ([0023](0023-sign-in-and-sessions.md)). Members already delete their own account in the app (Apple's 5.1.1(v)).
- **Built in CI** (`.github/workflows/store.yml`, job `ios`): on `release` when the shell changes, or by hand for a
  dev build for testers. Signing is automatic with the App Store Connect API key, so there are no certificates or
  profiles to keep; the build goes to TestFlight, and a person submits it for review in App Store Connect.
  `scripts/store-setup.mjs` registers the bundle id (`com.batterseacougars.team`) with its capabilities and checks
  `APPLE_TEAM_ID`, which isn't secret and is committed (`scripts/lib/settings.mjs`). Icons come from `scripts/favicons.mjs`, like the web app's.
- **Android is one platform folder and one CI job away**, with nothing above to change: the same config and app id,
  Firebase is Android's own push, `native.ts` and the links are shared, `push_devices.platform` already says which.
  It needs: `npx cap add android` (commit `apps/team/android/`); a Google Play Console account ($25 once,
  [0003](0003-free-tiers-only.md)); an upload key with Play App Signing; the Android app in Firebase
  (`google-services.json` as `FIREBASE_ANDROID_CONFIG`); `/.well-known/assetlinks.json` from the signing key's
  fingerprint in `store.links.ts`; and an `android` job in `store.yml` (ubuntu) building an AAB and uploading it to the
  internal testing track with a Play service account (`PLAY_SERVICE_ACCOUNT`). Google's review has no 4.2: the same
  app passes.

- **Browsers get them too, through Web Push** (#24): Android's Chrome or Firefox, a desktop, and an iPhone with the app
  on its Home Screen (iOS 16.4+), with no store. A browser's subscription is a device like a phone: a `push_devices`
  row with platform `web`, its endpoint as the token and its keys in `web_keys`, so topics, the outbox, its batches,
  retries and the sign-in tie are the same, and push.ts sends each row its own way, phones through Firebase and
  browsers straight to their push service (`worker/push/webpush.ts`: RFC 8291 aes128gcm, RFC 8292 VAPID ES256, all
  WebCrypto; one fetch per browser, counted like a phone's). A subscription is only taken on a browser's push service
  (Google, Mozilla, Apple, Windows), so the Worker never fetches an address someone chose. One VAPID key pair serves
  dev and production (a subscription belongs to its origin, so they never share one): the private key is
  `VAPID_PRIVATE_KEY` in Bitwarden, the public key a var in `wrangler.jsonc` that the app's build bakes in
  (`scripts/webpush-setup.mjs` makes both). In the app (`src/app/web-push.ts`): Home asks once as the store app does,
  and the You page has **On this device**; permission only ever from a tap; turning it off unsubscribes and forgets it,
  and signing out forgets the session's devices. An iPhone in a Safari tab can't have them, so it isn't asked: it's
  told, in a line, to add the app to the Home Screen. `public/sw.js` shows a push, a tap opens its page, and a renewed
  subscription is given to the club again.

## Consequences

- The app is only as available as the team app's server: no signal is the offline screen (the service worker's
  cached shell works in app-bound domains, so a page already open keeps working).
- Production must be reachable without Cloudflare Access for App Review: the store build is submitted at launch.
- Apple's fee is paid yearly on the existing account; Firebase Cloud Messaging and the macOS runners cost nothing.
- Web Push (#24) shares `push_devices` (`platform: web`) and `notify`; only its sending differs. A member on Android
  hears the club without the Play Store. An iPhone in Safari without the app on its Home Screen still hears nothing.
