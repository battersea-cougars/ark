# 0036. Every API response sends only what that caller may see, decided on the server, and every page is hardened

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-24
- **Merges:** 0092, 0099

## Context

Security reviews of the team app (2026-10-06, before sign-in went live, and 2026-10-09) found the UI doing the
server's job:

- The bootstrap sent every signed-in member everyone's email, phone, payment reference and rating, and the names
  and emails of strangers asking to join. Later it still sent who pays quarterly, every session's no-shows and
  walk-ins, who said they're out of every event, every member's roles and every role's actions, and the contact of
  every outside team entered in a tournament. The screens showing these are admin screens; the data was in every
  member's devtools.
- Anyone who could manage members could make themselves Admin. Anyone who could manage roles could add `manage:all`
  to a role they held.
- Forms on another site could post to the API wherever `SameSite=Lax` cookies let them through: from a sibling
  subdomain, or as `text/plain`.
- The security headers reached only `/api/*`. The team app's `wrangler.jsonc` runs the Worker first for `/api/*`
  alone, so the app's page and files came straight from Cloudflare's asset layer with none of them, and the
  website's prerendered pages never had any. The test that proved the headers called the Worker directly, so it
  couldn't see this.

The repo is public and members' details are personal data ([0029](0029-personal-data.md)). Once real people sign
in ([0023](0023-sign-in-and-sessions.md)), anything the API sends is effectively published to whoever receives it.
Dev's data becomes production's at launch ([0050](0050-schema-and-seed-until-launch.md)), so the time to stop
sending it is before anyone real signs in.

## Decision

**Every route is designed for its least trusted caller.** The UI hiding something is never the protection.

**Rows and fields are filtered on the server, per caller.** A response holds only what the caller's actions allow.
A new field or route starts private and is opened up deliberately. Filtering is in the club read
(`apps/team/worker/api/api.club.ts`): who's asking is a row of the statement, so what they may not see never leaves D1. The
slices are made from it, so a change's reply (`changed`, [0057](0057-team-app-loading-and-changes.md)) is filtered
exactly as the bootstrap is. Of anything
personal, a member is sent **their own**, and everyone's only with the action that needs it:

| Field                            | Everyone's, with                                                                                                                       | Otherwise                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Members                          | `manage:Member`                                                                                                                        | active members only                                                                                                                           |
| Email, phone, payment reference  | `manage:Member`                                                                                                                        | your own                                                                                                                                      |
| Rating                           | `read:Rating`                                                                                                                          | not sent                                                                                                                                      |
| Member `quarterly`               | `manage:Member`                                                                                                                        | your own                                                                                                                                      |
| Member `roles`                   | `manage:Member`, `manage:Role`                                                                                                         | your own                                                                                                                                      |
| `roles` (each role's actions)    | `manage:Member`, `manage:Role`                                                                                                         | roles you could hold as you are: yours, and those that can do less (your everyday role's choices, [0024](0024-action-based-authorization.md)) |
| An event's `out`                 | runs events: `record:Attendance`, `update:Event`, `generate:Teams`, `publish:Teams`, `manage:Member`, `manage:Tournament`, `run:Draft` | your own                                                                                                                                      |
| A session's `noShows`, `walkIns` | the same                                                                                                                               | your own                                                                                                                                      |
| An entered team's `contact`      | `manage:Tournament`                                                                                                                    | empty                                                                                                                                         |

Unchanged, because they're the point of the screen or already public: who's in and waiting (a sign-up list), a
member's name, position, bio, website name, Cougar flag and sessions played (all on the public website roster for
Cougars, and on the player card), and a closed draft's teams ([0060](0060-the-draft.md)).

An admin viewing the app as a member is answered as that member, by the server ([0024](0024-action-based-authorization.md)):
what comes back is what the member may see, so `impersonate:Member` needs nobody's roles.

**You can't grant what you don't have.** Only `manage:all` may give out any action. Anyone else may:

- give a member only roles whose actions they hold themselves;
- create or change only roles whose old and new actions they hold;
- change a member (their details, roles, status or sign-in email) only if that member can do nothing they can't.

So a member manager can't make an admin, demote one, or take over an admin's account by changing its email.

**Changes come only from the app's own pages.** Every POST, PUT and DELETE with an `Origin` header must have the
app's own origin; with no `Origin`, it must carry `Sec-Fetch-Site: same-origin`, and a change with neither is refused:
every browser's fetch sends one, so only a script sends neither (`sameOrigin` in `worker/api/api.http.ts`). Only JSON bodies are accepted. GET requests change nothing (bootstrap's adding
of future sessions is idempotent).

**Security headers on every page, file and response, from both layers.**

- Both apps have a `_headers` file, which Workers static assets apply to everything they serve. The Worker (team app,
  `worker/index.ts`) and the middleware (website's live routes) set the same set on what they answer. The team app's
  is `public/_headers`, and a test checks it equals the code's set, so the two can't drift; the website's is written
  by its build from the same code (`src/lib/server/headers.ts`, `headers.integration.ts`), for the environment being
  built, so there's nothing to drift.
- **The team app** sends `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`
  and a **content security policy**: only its own scripts, styles (inline allowed: Svelte sets style attributes),
  fonts and files; talks only to its own origin; its own images plus `data:` (team logos) and `blob:` (upload
  previews); no objects, no other base, forms only to itself, `frame-ancestors 'none'`. The one outsider is
  Cloudflare Turnstile on the sign-in page ([0028](0028-turnstile-and-auto-reply.md), #13): its script and its frame
  from `challenges.cloudflare.com`. A new outside resource means widening the policy on purpose, in both places.
- **The website** sends `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (it
  links out and is public, so the origin may travel) and a **content security policy** (`csp` in
  `src/lib/server/headers.ts`, per environment):
  - Scripts only from its own files, Turnstile and Cloudflare's analytics beacon. **No inline scripts at all**:
    Astro's small component scripts aren't inlined (`assetsInlineLimit` in `astro.config.mjs`), and the two that
    must run first (the error catcher, the back/forward check) are one blocking file, `src/scripts/head.js`. So the
    policy needs no hashes or nonces, is the same string in both layers, and works with `<ClientRouter />` (which
    Astro's own CSP feature doesn't support).
  - Images from itself, Sanity's CDN, YouTube's thumbnails and, off production only (dev, previews, a laptop), picsum
    for the demo content: production's policy doesn't name it (`SITE_ENV`, as the build and the Worker have it); frames
    only YouTube's player (`youtube-nocookie.com`) and Turnstile; inline styles allowed (`style="--i:…"` throughout).
  - No objects, no other base, forms only to itself, `frame-ancestors 'none'`, `upgrade-insecure-requests`.
  - A refusal is reported to `/api/csp-report` by `report-uri`, which every browser sends at once. Not the Reporting
    API's `report-to`: with it, Chrome ignores `report-uri`, and on dev it queued the report and never delivered it. The route keeps
    only reports about our own pages, leaves out what browser extensions cause, and sends each kind to Sentry as one
    issue ([0110](0110-structured-logging.md)). It was enforced from the start, not report-only first: before launch
    nobody visits to report, so instead a headless browser walked every page (and the demo content's) under the real
    policy, pressing Play and opening a photo, and found nothing refused.
- **HSTS:** both apps send `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Every host under the
  domain is HTTPS through Cloudflare. Not `preload`: the browsers' built-in list is slow to leave, and can come later.
- **Links typed by someone else** (the Studio, the team app's venues) are checked before they reach a page
  (`src/lib/links.ts`): only `http:`, `https:`, `mailto:`, `tel:` or a link within the site. Every link field in
  Sanity's answers is checked where they arrive (`content.ts`, `server/photos.ts`); a bad one is dropped as if empty,
  and in an event's write-up a bad link shows as its words. The Studio already refuses other schemes on its link
  fields; this holds when it doesn't (an API write, a schema change).
- **The deploy's smoke test** checks a built page and a live page each carry the policy and HSTS.

**Tests prove it**:

- `apps/team/worker/api/api.security.test.ts`: every route refuses someone who isn't signed in (401); every route refuses a
  member whose role lacks its action (403); the grant rules hold; other sites' requests and non-JSON bodies are
  refused; and each row of the table above is a story: what a plain member sees, what they see of themselves, and
  what whoever runs the register sees. A new route is covered by the first two automatically. A new private field
  needs its own assertion.
- **The deploy's smoke test** fetches the team app's `/` and fails without `X-Frame-Options`, so the headers are
  checked where they're served, not only in a unit test.

## Consequences

- Each new route asks, for every field and row it returns: who is this for?
- A plain member's devtools show the club's calendar, who's coming, and themselves. Nothing about anyone's payments,
  attendance record, permissions or contact details.
- Admin-only screens get their data from the server only when the caller may see it. A screen showing an empty value
  for someone else's email is the server working, not a bug.
- A screen built later for plain members that wants one of the private fields has to argue for it here first.
- Payment references follow the member's id (`COU-0001`), so they aren't secret. They're still sent only to the
  member and to managers.
- Dues are gated on the server (`read:Dues`, `record:Payment`) from the start ([0007](0007-dues-and-payments.md)).
- Every page and file from either app is unframeable and unsniffable, and the team app's page can't run a script or
  reach a host that isn't its own, which limits what any injected content could do.
- Adding a CDN, an embed or an analytics script to either app takes a deliberate change to its policy, in the code
  (`worker/index.ts` and `public/_headers`, where the test fails until both agree; the website's
  `lib/server/headers.ts`, both layers). On the
  website an inline `<script>` won't run: put it in a file.

## History

- 2026-10-06: A review before sign-in went live: responses filtered per caller on the server, no granting what you
  don't hold, changes only from the app's own origin as JSON, four security headers set in the Worker (was 0036).
- 2026-10-09: The headers reached only `/api/*`; both apps now carry `_headers` for the asset layer, the team app
  gets a content security policy, and the smoke test checks `/` (was 0092).
- 2026-10-09: Of anything personal, the bootstrap now sends a member only their own: quarterly, roles, role actions,
  outs, no-shows, walk-ins and outside teams' contacts filtered by action (was 0099).
- 2026-10-09: A change with neither `Origin` nor `Sec-Fetch-Site: same-origin` is refused; before, one with neither
  (or `Sec-Fetch-Site: none`) got through ([#42](https://github.com/battersea-cougars/ark/issues/42)).
- 2026-10-09: The bootstrap's filtering moved into its SQL (`club.ts`, [0057](0057-team-app-loading-and-changes.md)):
  someone else's private fields, outs, no-shows, walk-ins and contacts are no longer read and then dropped in code.
  The draft's hiding (ADR 0060) and which roles you see stay in code.
- 2026-10-20: The website gets a full content security policy, enforced, with no inline scripts; both apps send
  HSTS; links from the Studio are checked before they reach a page
  ([#78](https://github.com/battersea-cougars/ark/issues/78)).
- 2026-10-21: The team app's policy lets in Turnstile's script and frame, for sign-in and Ask to join (#13).
- 2026-10-24: The website's headers are per environment: production's policy no longer lets in picsum, which only
  dev's demo content uses. Its `_headers` is written by the build from the middleware's code, for the environment
  built, instead of kept in `public/` (#148).
- 2026-10-24: `impersonate:Member` no longer sees everyone's roles: viewing as a member moved to the server, which
  answers as the member (#40, [0024](0024-action-based-authorization.md)).
