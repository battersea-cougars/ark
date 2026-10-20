# 0024. Permissions are actions; roles are data built from actions; admins can view as a member or run as less

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-09
- **Merges:** 0029 (view as a member), 0037

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
- Granting is limited: no one grants what they don't hold, and responses are filtered per caller on the server
  ([0036](0036-api-security.md)).
- The bootstrap returns the member's actions. Nav entries and buttons declare an action and hide when it's missing;
  the server still checks.
- The last member holding `manage:all` can't lose it. Role and permission changes and refused requests go in
  `audit_log` ([0095](0095-audit-log.md)).
- Permissions are read with one indexed query per request. The first admin's email is a non-secret setting.

**View as a member** (`impersonate:Member`, "View the app as a member (read-only)")

- Admins have it through `manage:all`; it can be given to other roles.
- It's a page in **Settings → Security** (View as a member), where an admin looks for their tools. Picking someone
  makes the app show what they see, with their actions: their Home, their team, their tab, only the pages their
  roles allow.
- **Read-only.** While viewing as someone you can't change anything as them: the app disables the controls (In/Out,
  sign-up, profile, sign out).
- An amber banner across the top says who you're viewing as, with **Back to <you>** always available, whatever the
  member's own permissions. The badge turns amber too.
- It's worked out in the browser (`src/demo/session.svelte.ts`) from the member's roles, which is why
  `impersonate:Member` is one of the actions that receives everyone's roles ([0036](0036-api-security.md)). The
  server doesn't know a view is in progress: it still answers as, and authorizes, the admin.

**Everyday role**

- A member whose role is more than Member can choose an **everyday role** on their Profile, for example Contributor.
  It's stored on the member (`members.everyday_role_id`, set through `/api/me/everyday-role`), so it applies on every
  device. The choices are roles that can do less than they can; the API refuses anything else, so it can never be a
  way up.
- **An admin can set it for another member** on their card (Details → Opens as, `PUT /api/members/:id/everyday-role`,
  `manage:Member`): the same rule, a role that can do less than that member can, and only for a member the admin may
  change at all. It's on the record (`member.everyday`).
- The app **opens in the everyday role**: the pages, buttons and data it shows are that role's and Member's.
- **Opening Settings moves them up.** The Settings gear (top right: beside the desktop's badge, in a phone's You bar)
  shows for anyone whose full role can set something up, and opening it, or any settings page, switches to the full
  role on the way. The account menu (the badge, or your card on a phone) has the switch both ways ("Switch to Admin",
  "Back to Session lead"). Going back from a page the everyday role can't see goes Home.
- Being switched up lasts for the tab (session storage): the app always reopens in the everyday role.
- View as a member is a settings page, so reaching it switches up like any other.
- Every place that decides what to show uses the app's granted actions (`granted()`), never the real roles, and role
  badges for yourself use `shownRoles()`.

## Consequences

- New kinds of helper need no code change, only a role.
- Every new route needs an action, and every new action a label; the test enforces it.
- Mistakes in role setup are possible; the grant rules, the audit log and the last-admin guard limit the damage.
- Admins can check roles and support members without asking for their phone.
- View as a member and the everyday role are **screen safeguards, not security boundaries**. The server authorizes
  by the member's real roles and sends the data those roles may see; the app simply doesn't show it. Someone with
  the phone and devtools could still read it.
- Because viewing as a member is client-side, an admin's preview holds the admin's own data, not exactly the
  member's, and starting or ending it isn't recorded. If it ever needs to be exact, it moves to the server, becomes
  read-only there, and `impersonate:Member` drops out of the actions that see everyone's roles.
- An admin can hand their phone round without hiding anything by hand.

## History

- 2026-10-06: Permissions are `verb:Subject` actions declared on every route; roles are data in D1 built from them
  (was 0024).
- 2026-10-06: Admins can view the app as a member, read-only, with an amber banner; planned with the session holding
  both members, the API refusing writes and the start and end audited (was 0029; built in the browser instead).
- 2026-10-07: Members with more than Member can run the app day to day as a lesser everyday role and switch up for
  the tab (was 0037).
- 2026-10-09: An admin can set another member's everyday role on their card.
- 2026-10-20: The switch beside the badge is gone: the Settings gear switches you up on the way in, the account menu
  switches both ways; View as a member moved from the account menu to Settings → Security.
