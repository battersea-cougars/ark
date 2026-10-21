# 0108. The team app in the app stores: a native shell that loads the live app, with notifications; iOS first, Android-ready

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

On an iPhone the team app can only be added to the Home Screen by hand (Share → Add to Home Screen): Safari never
offers to install it, and most members won't find that. We want it in the App Store, with notifications, and later
in the Play Store. [0022](0022-team-app-svelte-pwa.md) expected this ("a store app wraps the same build with
Capacitor", #26); [0003](0003-free-tiers-only.md) said the store fees need agreeing: Apple's is paid on an existing
Apple Developer account.

Three things shape it:

- **Sign-in and every change are first-party.** The session and the sign-in nonce are `__Host-` cookies,
  `SameSite=Lax`; every change must come from the app's own origin ([0036](0036-api-security.md)); there's no CORS.
  A shell serving a bundled copy of the app (at `capacitor://localhost`) would be another origin: sign-in and every
  change would break, and the cookies wouldn't be kept.
- **Apple rejects a website in a wrapper** (App Store Review Guideline 4.2): the app must do things a Home Screen
  icon can't.
- **No Mac.** The repo is public, so GitHub's macOS runners are free.

## Decision

- **A Capacitor shell that loads the live team app** (`apps/team/capacitor.config.ts`, `server.url`): dev's for test
  builds, production's for the store. Sign-in, the live hub, the update offer ([0104](0104-app-versions-and-updates.md))
  and every change work as in a browser, and **a deploy of `team` updates the app**: the shell is rebuilt only when it
  changes. Only the offline screen is in the app (`apps/team/native/offline.html`, "Can't reach the club", Try again).
  `limitsNavigationsToAppBoundDomains` keeps the shell to the team app's own domains.
- **What the app does that a browser can't** (`src/app/native.ts`, which asks "is this the app", never "is this an
  iPhone", and falls back to the browser's way everywhere else):
  - **Notifications**: the night's teams are out (which team you're on), a place came up off the waitlist, a
    Quarterly Member took your place and you're waiting ([0030](0030-training-and-tournament-schedule.md), #97), a session
    you're in is off, an announcement. A route says what's news with `notify` (`worker/push/push.notices.ts`), read
    before and after the change like the record ([0095](0095-audit-log.md)); the wrapper sends it after the reply
    (`waitUntil`), and a notification that can't be sent never fails the change. Home asks once, a row in its feed
    ([0118](0118-home-calls-to-action-then-feed.md)) saying what they're for, before the phone's own question; "Not now" is remembered. A reminder of what you owe
    ([0007](0007-dues-and-payments.md)) comes with its email: the dues code tells a member through
    `worker/tell/tell.ts`, which sends the email and hands the notification to `notify`.
  - **A topic each, the member's to switch off** (#24): every Notice says its topic, from one list
    (`src/lib/notification-topics.ts`: `teams`, `places`, `sessionOff`, `announcements`, `dues`; `draft` joins it
    when the draft's notifications are sent, so there's never a switch for nothing). Every topic is on until a member
    turns it off: `notification_prefs` holds only what they switched, and the statement that fills the outbox skips
    them, so choosing costs no round trip. The choice is the member's, not a phone's: one copy, whichever phone they
    sign in on (and Web Push, if it comes). The You page shows a switch per topic to everyone, in a browser too, with a
    line saying notifications come through the club's app; it's in the bootstrap (`notifications`), and
    `PUT /api/me/notifications` (`worker/push/push.routes.ts`) changes only your own.
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
  request per phone, so a send to every phone can't go out at once. Each notification is a row in `push_outbox` (one
  per notice per phone), written in one statement with the first batch claimed in the same round trip. A batch is at
  most `SEND_AT_ONCE` (40) phones: with Google's access token, the live hub and a Sentry report that leaves about ten
  fetches to spare. The first batch goes right after the reply; the rest go a batch per cron run (`push.drain`, every
  five minutes and hourly), so 200 phones are told within about 20 minutes. Rows are claimed before sending (one
  `UPDATE … RETURNING`), so two sends at once never send a phone twice, and what became of a batch is one round trip
  after it. A failed send is tried again after 5, 10 and 20 minutes, then given up and logged (`push.gave_up`); what
  was waiting for a phone that's gone or signed out isn't sent; sent rows are pruned after a week. Without
  `FIREBASE_SERVICE_ACCOUNT` (your machine, tests) every row is caught or logged at once and nothing waits.
- **App Review signs in** with one member's email that takes a fixed code (`APP_REVIEW_EMAIL`/`APP_REVIEW_CODE`,
  production only): reviewers can't read our email. The nonce, tries and limits still apply
  ([0023](0023-sign-in-and-sessions.md)). Members already delete their own account in the app (Apple's 5.1.1(v)).
- **Built in CI** (`.github/workflows/store.yml`, job `ios`): on `release` when the shell changes, or by hand for a
  dev build for testers. Signing is automatic with the App Store Connect API key, so there are no certificates or
  profiles to keep; the build goes to TestFlight, and a person submits it for review in App Store Connect.
  `scripts/store-setup.mjs` registers the bundle id (`com.batterseacougars.team`) with its capabilities and stores
  `APPLE_TEAM_ID`. Icons come from `scripts/favicons.mjs`, like the web app's.
- **Android is one platform folder and one CI job away**, with nothing above to change: the same config and app id,
  Firebase is Android's own push, `native.ts` and the links are shared, `push_devices.platform` already says which.
  It needs: `npx cap add android` (commit `apps/team/android/`); a Google Play Console account ($25 once,
  [0003](0003-free-tiers-only.md)); an upload key with Play App Signing; the Android app in Firebase
  (`google-services.json` as `FIREBASE_ANDROID_CONFIG`); `/.well-known/assetlinks.json` from the signing key's
  fingerprint in `store.links.ts`; and an `android` job in `store.yml` (ubuntu) building an AAB and uploading it to the
  internal testing track with a Play service account (`PLAY_SERVICE_ACCOUNT`). Google's review has no 4.2: the same
  app passes.

## Consequences

- The app is only as available as the team app's server: no signal is the offline screen (the service worker's
  cached shell works in app-bound domains, so a page already open keeps working).
- Production must be reachable without Cloudflare Access for App Review: the store build is submitted at launch.
- Apple's fee is paid yearly on the existing account; Firebase Cloud Messaging and the macOS runners cost nothing.
- Web push for the Home Screen app (#24) can share `push_devices` (`platform: web`) and `notify`; only its sending
  differs.

## History

- 2026-10-11: The store app: a Capacitor shell loading the live team app, notifications through Firebase, links
  opening the app, App Review's sign-in, TestFlight builds from Actions; iOS first, Android ready (#26).
- 2026-10-20: Sending within the free plan: a push outbox sent 40 phones at a time, the rest by the cron, claimed
  before sending, retried with backoff (Workers Free's 50 subrequests an invocation).
- 2026-10-20: Topics: each notification says what it's about, and a member turns any topic off on the You page
  (`notification_prefs`, absent is on, read inside the outbox statement) (#24); a pay-as-you-go player a Quarterly
  Member bumps to the waitlist hears it, topic `places` (#97).
- 2026-10-20: A dues reminder is news too: `tell` (worker/tell/tell.ts) emails a member and notifies their phone in
  one call, so a feature never talks to Gmail or Firebase itself (#79).
- 2026-10-21: Home's notification ask moved under the calls to action, a row in its feed
  ([0118](0118-home-calls-to-action-then-feed.md)).
