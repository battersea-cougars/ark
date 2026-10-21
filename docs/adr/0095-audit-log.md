# 0095. Each change declares what it puts on the audit log, on its route, and the log has a page in plain words

- **Status:** Accepted
- **Date:** 2026-10-09 · updated 2026-10-21
- **Merges:** 0098

## Context

[0024](0024-action-based-authorization.md) promised that role changes, permission changes and refused requests go in
`audit_log`, and [0023](0023-sign-in-and-sessions.md) put sign-ins there. Until the security review of 2026-10-09
only sign-ins, sign-outs and capped sign-ins were written, and nothing read the table: an admin wanting to know who
gave someone a role, or who kept poking at admin routes, had to query D1 by hand.

Writing each entry as an `audit()` call in the handler is imperative: a new route that changes who can do what has to
remember to call it, and nothing notices when it doesn't. Auditing is a cross-cutting concern, and routes already
declare their others the same way: `action` (who may) and `changes` (what comes back) are properties of the route,
applied by one wrapper and held by a test.

Decorators were considered. TypeScript's decorate class members, and the Worker has no classes: a route is an object
in a table. A decorator around a handler would also see only the request and the status, which makes a request log
("PUT /api/members/3"), not a record ("Reg: roles Member → Helper, Member").

## Decision

**Writing**

- **Every route that isn't a GET declares `audit`**: what it puts on the record, or `{ none: "why" }` for nothing,
  saying why. A test fails on any that doesn't, and on an opt-out with no reason, so the choice is made on purpose
  for each new route and a reviewer reads the reason in the diff.
- **Every change made with more than being signed in goes on the record** (#80): anything an admin, a team maker, a
  scorer or a treasurer does (training, tournaments, scores, the register, teams, venues, settings, quips, club
  events, dues). A member's own changes may stay off it, with their reason: their sign-up (which needs
  `signup:Event`, and is its own record), profile and everyday role, a captain's pick and their team's look, holding
  the scoresheet, dismissing an announcement. A test lists the opt-outs beyond being signed in: only the sign-ups.
- **What happens tap by tap is summarised**: goals and the game clock write one `game.scored` when a game ends, and
  again for each edit after it's ended (their subject is the result once the game's done, else nothing), not one per
  goal. The register is per tap: each is a change to who's charged.
- **One-line subjects**: `rowOf(sql)` reads one row by the route's id (or, for a new one, the id in the reply) and
  `rowsOf(sql)` a list (a session's register, a team's players), in `worker/api/api.route.ts`.
- **A declaration is data**: an `event` name, a `subject` (one read of the thing the change is to: a member's
  standing, a role's actions, a sign-in email) and optionally `about` (the member or role, by id, for the page to
  name).
- **The wrapper does the rest** (`handleApi` in `worker/api/api.ts`): it reads the subject before the handler and after
  it, and when the two differ writes one entry with who did it, `from`, `to` and `about`. A refused or failed change
  writes nothing; a change that changes nothing (the same roles saved again) writes nothing.
- **Readers live with their domain** (`memberStanding`, `roleSummary` in members/members.ts; `sessionSignups` in training/training.teams.ts;
  `draftProgress` in tournaments/draft.ts; `tournamentSummary` in tournaments/tournaments.ts), so "what does this change touch" is answered once.
- On the record from declarations: `member.updated` (status, roles), `member.email`, `member.added`,
  `member.quarterly`, `role.created`, `role.updated`, `dev_mail.changed`, `tournament.deleted`, `session.reset`,
  `draft.reset`. From the wrapper itself: `refused` (every 403, with the method, path and missing action).
- **Not declarative, and staying that way:** sign-in's own events (`sign_in`, `sign_out`, `sign_in.capped`,
  `access.requested`), written by explicit `audit()` calls in `worker/auth/auth.ts`. Sign-in routes run before anyone is
  known and aren't in the route table; their events are what happened, not a change to compare.

**Reading**

- **A new action, `read:Audit`** ("See the audit log: who changed what, and when"). Admins hold it through
  `manage:all`; it can be given to a role like any other.
- **`GET /api/audit`** returns the newest entries first, a page at a time (`before=<id>` for the next page, up to 200
  a page). Each entry names who acted and, where its detail names a member or a role, that one by its current name,
  so the page needs no other data to say what happened.
- **Settings → Audit log**, under Security (`AuditLog.svelte`): a table like the app's others (ADR 0065), one row per
  entry: when (the day and time), what in plain words ("Dana changed Reg: roles Member → Helper, Member", "Pat was
  refused GET /api/usage: needs \"See the club's free Cloudflare allowance\""), and its area (dropped on a phone).
  The page is `.page.fit` and the table scrolls inside, under its own header row. Refusals and capped sign-ins carry
  an alert icon. A search in the header row (who, what) and filter chips by area (Members, Money, Training, Kumite,
  Settings, each with its icon) sift the entries read so far; "Earlier", at the foot of the rows, reads the next page.

## Consequences

- An admin can answer "who did this?" from their phone, and sees attempts at admin routes without being told.
- Adding a route means deciding its record in the same place as its permission. Forgetting is a failing test.
- A new kind of entry needs a line in the page's `said()`; an event the page doesn't know still shows, as its name
  and detail, so nothing is silent.
- A subject is read twice per audited change: two small indexed reads, on the few routes that change who can do what.
- A subject must read the same way both times; one that includes a timestamp or an order that drifts would record
  changes that didn't happen. The readers sort what they return.
- The log holds names and emails (a changed sign-in email, an added member's). It's behind `read:Audit`, and the
  table is personal data like the rest of D1 ([0029](0029-personal-data.md)).

## History

- 2026-10-09: The audit log gets a page and `read:Audit`; the review adds member, role, sign-in email, dev mail and
  refused entries, each an explicit `audit()` call in its handler (was 0095).
- 2026-10-09: Each non-GET route declares its record and the wrapper writes it by comparing before and after; dev mail
  entries become `dev_mail.changed`, and tournament, session and draft resets join (was 0098).
- 2026-10-10: Every change made with more than being signed in goes on the record; an opt-out names its reason
  (`{ none }` replaces `false`); goals and the clock are summarised as `game.scored`; the page filters by area (#80).
- 2026-10-21: The page becomes a table like Roles and Unpaid fees: a row per entry (when · what · area), scrolling
  inside a `.page.fit`, a search in its header row, the area chips with icons in the page's filters, "Earlier" at the
  foot of the rows; notable entries get an icon, not a fill. The API is unchanged: search and chips sift what's read.
- 2026-10-21: Refused requests go on the record at most once a minute per member, every one still in the log, so a loop
  can't spend the day's D1 writes (#73); an admin signing a member out everywhere is `member.signed_out` (#72).
