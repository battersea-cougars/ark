# 0024. Permissions are actions and roles are data; every response sends only what its caller may see; every change declares its audit record; every page is hardened

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-11-02
- **Merges:** 0029 (view as a member), 0036, 0037, 0092, 0095, 0098, 0099

## Context

The team app starts with three kinds of user (member, contributor, admin), but the club will want others: someone
who does the door register, a Kumite scorekeeper, a treasurer who sees dues but can't edit the website. Hard-coding
roles means a code change for each.

typesmiths/decohere checks `verb:Subject` actions (CASL style), declared on every route, failing closed, with an
admin wildcard (`manage:all`). Its roles live in Auth0. We have no identity provider, so ours live in D1.

Because roles are data, what a member sees depends on roles an admin configured. The only reliable way to check a
role, or to answer "I can't see my team", is to see the app as that member does.

Admins also use the app on their own phone at the rink and show it to members: who's in, the teams, the calendar.
In their full role the app shows ratings, admin pages and admin buttons, which members shouldn't see over their
shoulder. Viewing as a member is the wrong tool for that: it shows someone else's data, read-only, and takes several
taps to start and stop.

## Decision

**Actions and roles**

- **Actions are code.** `apps/team/src/access/actions.ts` is the catalog: each action (`verb:Subject`) with a
  plain-English label for the admin screen. For example: `read:Event`, `create:Event`, `update:Event`,
  `signup:Event`, `record:Attendance`, `generate:Teams`, `publish:Teams`, `manage:Fees`, `record:Payment`,
  `read:Dues`, `score:Match`, `run:Draft`, `pick:Draft`, `upload:Photo`, `upload:Video`, `publish:Media`,
  `read:Rating`, `manage:Member`, `manage:Role`, `manage:Settings`, `impersonate:Member`, `read:Audit`,
  `edit:Content`, and `manage:all` (everything).
- **Every API handler and page declares what it needs**: an action, `authenticated` (signed in) or `anonymous`. The
  API wrapper denies anything else. A test fails if a route declares nothing or names an action not in the catalog.
- **Roles are data**: `roles` (name, description, `is_system`), `role_actions`, `member_roles`. A member can do the
  union of their roles' actions. Actions in the database that are no longer in the catalog are ignored.
- **Seeded roles**: Member (events, sign-up, own profile and tab), Contributor (Member plus uploads), Admin
  (`manage:all`, can't be edited or deleted). Admins create other roles by ticking actions.
- **Some checks also look at the record**: `pick:Draft` only for that draft's captains; a profile only by its owner
  or `manage:Member`.
- Granting is limited: no one grants what they don't hold, and responses are filtered per caller on the server (below).
- The bootstrap returns the member's actions. Nav entries and buttons declare an action and hide when it's missing;
  the server still checks.
- The last active member holding `manage:all`, through Admin or any other role, can't lose it: not by their roles
  changing, being made inactive or pending, deleting their account, or `manage:all` coming off the role that gives
  it; the change is refused (409) and the admin's told to make someone else an admin first. Role and permission changes and refused requests go in
  `audit_log` (below).
- Permissions are read with one indexed query per request. The first admin's email is a non-secret setting.

**View as a member** (`impersonate:Member`, "View the app as a member (read-only)")

- Admins have it through `manage:all`; it can be given to other roles. **The grant rule holds**: you view as
  someone who can do no more than you, as you change only them. Starting as someone
  who can do more is refused (403), and a view of someone who's since been given more ends on the next request, so
  a role holding only View as a member never reads what an admin may.
- It's a page in **Settings → System** (View as a member), where an admin looks for their tools. Picking someone
  makes the app show what they see, with their actions: their Home, their team, their tab, only the pages their
  roles allow.
- **The server keeps it, on the sign-in** (`auth_sessions.viewing_as`, #40). Starting is `PUT /api/me/view-as`
  (`impersonate:Member`) and going back `DELETE /api/me/view-as` (anyone signed in), in
  `worker/members/view-as.routes.ts`. Either way the app reads the whole club again. It's that browser's sign-in, not
  the admin's: it lasts through a reload, the admin's other phones are still them, and signing out ends it.
- **The API answers as the member.** While viewing, every request is read with the member's id and their actions
  (`Ctx.memberId`, with `Ctx.viewedBy` the admin): their Home, their team, their tab, the pages and data their roles
  allow, exactly what their own phone is sent. The bootstrap says who you are (`me`) and who you're viewing as
  (`viewingAs`), and its `actions` are the member's; the app shows those (`granted()`), not ones it works out.
- **Read-only, on the server.** Every change is refused with a 403 in words, "You're viewing as Sam: go back to
  yourself to change anything.", except going back (the route's `whileViewing`) and signing out. So are a sign-in's
  own changes outside the API: a passkey, or a phone given to the club for notifications, so a view never registers
  a device and nothing is pushed to it as the member. The app still disables the controls (In/Out, sign-up,
  profile, sign out) so nobody taps into a refusal.
- **On the record**: `view_as.started` and `view_as.ended`, by the admin, about the member; signing out while viewing writes the end too.
- **It ends cleanly** when the member leaves the club (made inactive, erased, deleted) or the admin no longer holds
  `impersonate:Member`: the next request finds out, ends it on the record, and answers as the admin again.
- An amber banner across the top says who you're viewing as, with **Back to <you>** always available, whatever the
  member's own permissions. The badge turns amber too.
- Counted, rate-limited and on the record as the admin; a live page's stream is the admin's sign-in's, and a
  journey's clock moves with the admin's actions.

**Everyday role**

- A member whose role is more than Member can choose an **everyday role** on their You page, for example Contributor.
  It's stored on the member (`members.everyday_role_id`, set through `/api/me/everyday-role`), so it applies on every
  device. The choices are roles that can do less than they can; the API refuses anything else, so it can never be a
  way up.
- **An admin can set it for another member** on their card (Details → Opens as, `PUT /api/members/:id/everyday-role`,
  `manage:Member`): the same rule, a role that can do less than that member can, and only for a member the admin may
  change at all. It's on the record (`member.everyday`).
- The app **opens in the everyday role**: the pages, buttons and data it shows are that role's and Member's.
- **Opening Settings moves them up.** The Settings gear (top right: beside the desktop's avatar, in a phone's You bar)
  shows for anyone whose full role can set something up, and opening it, or any settings page, switches to the full
  role on the way. One switch goes both ways, "Using the app as Session lead / Admin", under your card on the You
  page and at the top of Settings. Going back from a page the everyday role can't see goes Home.
- Being switched up lasts for the tab (session storage): the app always reopens in the everyday role.
- View as a member is a settings page, so reaching it switches up like any other.
- Every place that decides what to show uses the app's granted actions (`granted()`), never the real roles, and role
  badges for yourself use `shownRoles()`.

**Every response sends only what its caller may see**

Every route is designed for its least trusted caller; the UI hiding something is never the protection. The repo is
public and members' details are personal data ([ADR 0029](0029-personal-data.md)), so anything the API sends is
effectively published to whoever receives it.

- **Rows and fields are filtered on the server, per caller**, in the club read (`worker/api/api.club.ts`): who's asking
  is a row of the statement, so what they may not see never leaves D1, and a change's reply is filtered exactly as the
  bootstrap is. A new field or route starts private and is opened up deliberately. Of anything personal, a member is
  sent their own, and everyone's only with the action that needs it:

| Field                            | Everyone's, with                                                                                                                       | Otherwise                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Members                          | `manage:Member`                                                                                                                        | active members only                                                   |
| Email, phone, payment reference  | `manage:Member`                                                                                                                        | your own                                                              |
| Rating                           | `read:Rating`                                                                                                                          | not sent                                                              |
| Member `quarterly`               | `manage:Member`                                                                                                                        | your own; on a training's sign-up list, each skater shown (the badge) |
| Member `roles`                   | `manage:Member`, `manage:Role`                                                                                                         | your own                                                              |
| `roles` (each role's actions)    | `manage:Member`, `manage:Role`                                                                                                         | roles you could hold as you are: yours, and those that can do less    |
| An event's `out`                 | runs events: `record:Attendance`, `update:Event`, `generate:Teams`, `publish:Teams`, `manage:Member`, `manage:Tournament`, `run:Draft` | your own                                                              |
| A session's `noShows`, `walkIns` | the same                                                                                                                               | your own                                                              |
| An entered team's `contact`      | `manage:Tournament`                                                                                                                    | empty                                                                 |
| Dues                             | `read:Dues`, `record:Payment`                                                                                                          | your own                                                              |

Unchanged, because they're the point of the screen or already public: who's in and waiting, a member's name,
position, bio, website name, Cougar flag and sessions played, and a closed draft's teams. An admin viewing as a
member is answered as that member, by the server.

- **You can't grant what you don't have.** Only `manage:all` may give out any action. Anyone else may give a member
  only roles whose actions they hold, create or change only roles whose old and new actions they hold, and change a
  member only if that member can do nothing they can't. The last who can do everything is kept inside the statements
  that change roles, status or erasure ([ADR 0003](0003-free-tiers-only.md)).
- **Changes come only from the app's own pages.** Every POST, PUT and DELETE must carry the app's own `Origin`, or
  `Sec-Fetch-Site: same-origin` (`sameOrigin`, `worker/api/api.http.ts`); only JSON bodies are accepted; GET changes
  nothing.
- **Security headers on every page, file and response, from both layers**: each app's `_headers` for static assets,
  and the Worker or middleware for what it answers, from the same code (a test checks the team app's two agree; the
  website's build writes its file). `X-Frame-Options: DENY`, `nosniff`, a `Referrer-Policy`, a `Permissions-Policy`
  that turns off camera, microphone and location, HSTS (`includeSubDomains`, not `preload`), and a **content security
  policy**: the team app's own origin only, plus Turnstile on sign-in; the website's own files, Turnstile and
  Cloudflare's analytics beacon, with **no inline scripts at all**, so the policy needs no hashes or nonces. Refusals
  are reported to `/api/csp-report` and sent to Sentry. A new outside resource means widening a policy on purpose.
- **The bootstrap is never kept by the browser** (`private, no-store`): the club's data would outlast signing out.
- **Links typed by someone else** (the Studio, venues) are checked before they reach a page (`src/lib/links.ts`):
  only `http:`, `https:`, `mailto:`, `tel:` or a link within the site.
- **Tests prove it**: `api.security.test.ts` refuses every route to someone not signed in (401) and to a role without
  its action (403), holds the grant rules and the origin check, and tells each row of the table above as a story; the
  deploy's smoke test checks the headers where they're served.

**Every change declares what it puts on the audit log**

- Auditing is a property of the route, like its `action`: every route that isn't a GET declares `audit`, a record or
  `{ none: "why" }`, and a test fails on any that doesn't. A declaration is data: an `event` name, a `subject` (one
  read of the thing changed, by a reader that lives with its domain) and optionally `about`.
- **The wrapper does the rest** (`handleApi`, `worker/api/api.ts`): it reads the subject before and after the
  handler, and when they differ writes one entry with who did it, `from`, `to` and `about`. A refused, failed or
  no-op change writes nothing; every 403 for want of an action is its own `refused` entry. Sign-in's own events stay
  explicit `audit()` calls: they run before anyone is known and aren't changes to compare.
- What's on the record and how the log reads is in [the Settings notes](../../apps/team/worker/settings/README.md).

## Consequences

- New kinds of helper need no code change, only a role.
- Every new route needs an action, and every new action a label; the test enforces it.
- Mistakes in role setup are possible; the grant rules, the audit log and the last-admin guard limit the damage.
- Admins can check roles and support members without asking for their phone.
- The everyday role is a **screen safeguard, not a security boundary**. The server authorizes by the member's real
  roles and sends the data those roles may see; the app simply doesn't show it. Someone with the phone and devtools
  could still read it.
- **Viewing as a member is a boundary**: the phone holds only what the member's own would, and can change nothing,
  whatever devtools does. An admin's preview is exactly the member's, so "I can't see my team" is answered by
  looking. `impersonate:Member` receives nobody's roles (above).
- Starting and ending are API changes, so they need the network; and viewing as someone costs a second permissions
  read per request (the admin's and the member's).
- An admin can hand their phone round without hiding anything by hand.
- Each new route asks, for every field and row it returns: who is this for? A screen showing an empty value for
  someone else's email is the server working, not a bug.
- Adding a route means deciding its record in the same place as its permission; forgetting is a failing test. A
  subject is read twice per audited change, and must read the same way both times.
- Adding a CDN, an embed or an analytics script to either app takes a deliberate change to its policy. On the website
  an inline `<script>` won't run: put it in a file.
