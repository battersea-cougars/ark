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
  - **Notifications**: the night's teams are out (which team you're on), a place came up off the waitlist, a session
    you're in is off, an announcement. A route says what's news with `notify` (`worker/push/push.notices.ts`), read
    before and after the change like the record ([0095](0095-audit-log.md)); the wrapper sends it after the reply
    (`waitUntil`), and a notification that can't be sent never fails the change. Home asks once, saying what
    they're for, before the phone's own question; "Not now" is remembered.
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
