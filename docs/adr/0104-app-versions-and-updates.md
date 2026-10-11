# 0104. The team app has a version and a build id, and offers a reload when a newer build is out

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

An installed team app (a PWA) gets new code only when its page reloads. Opening it fresh fetches the page from the
network first (`public/sw.js`), so a fresh open is always current, but Android keeps an installed app alive for days,
and switching back to it isn't a reload. It went on running the code it started with, with nothing to say a newer
one was out; the only reload was the stale-code recovery, when old code asked for a file a deploy had removed. Nobody
could say which code a member was on either.

## Decision

- **Two numbers.** The version, `apps/team/package.json` `"version"`, is semver for people: release notes, "which
  version are you on?". It is 0.x until launch, 1.0.0 at launch, and bumped by hand when a release changes what
  members see. The build id is the commit, for finding the exact code: CI's `PUBLIC_BUILD_VERSION` already ends
  `+<commit>`, and a build on your machine asks git.
- **Stamped once, in both halves.** `vite.config.ts` defines them for the app and its Worker alike
  (`src/app/build.ts`); the dev server, and anything unstamped (the Worker under test), is `dev`.
- **Shown where people look**: the foot of Profile, "Cougars Fresh Meat 0.1.0 · 17c51af".
- **Every bootstrap says which build answered** (`x-app-build`, on the 200 and the 304). The app already asks often:
  on opening, on coming back to it, on pull to refresh, and on live pages' beat. No new request.
- **A different build: offered, never forced.** Where "Saved" shows, one big button, "Get the new version", and a quiet
  "Later" beside it: no sentence to wrap on a phone. A forced reload could land mid-form or mid-game on the scoresheet. `dev` never offers.

## Consequences

- An app left open hears of a deploy the next time it checks, and its member chooses when to reload.
- A redeploy of the same commit offers nothing (same build id); a different commit always offers, even when only the
  Worker changed.
- The version needs bumping by hand; the build id never does.
- Not done yet: a deploy that old code can't work with has no way to insist; the service worker's cache keeps every
  build's files (its name never changes).

## History

- 2026-10-10: Version, build id, and the reload offered when the build that answers isn't the app's own.
- 2026-10-11: The offer is one big "Get the new version" button and "Later"; the sentence beside two small buttons
  wrapped to three lines on a phone.
