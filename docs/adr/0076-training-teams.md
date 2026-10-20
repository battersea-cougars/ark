# 0076. Training teams: a Session lead role, made by dragging, saved as you change them

- **Status:** Accepted
- **Date:** 2026-10-08 · updated 2026-10-20
- **Merges:** 0079

## Context

Only some people make Friday's teams. The actions already existed (`generate:Teams`, `publish:Teams`,
[0024](0024-action-based-authorization.md)) but only Admin had them, and moving a player meant tapping an arrow to send
them round the teams one at a time.

Teams are made from who's in, but people sign up late or drop out after the teams are out, and the page has to say so
without taking players off a team behind the team maker's back.

## Decision

- **A seeded role, Session lead** (db/seed/club.sql), for whoever runs Friday night: see the calendar, say in or out,
  run the register (`record:Attendance`), see ratings, make and publish teams. One role, not a Door and a Team maker,
  because on a Friday the same person does both. An admin gives it to members on the Roles screen like any other role.
  Moving players needs both `generate:Teams` and `publish:Teams`, since each move is a publish; Session lead and Admin
  have both.
- **No drafts, no Publish.** Every change a team maker makes is saved straight away, and everyone sees it: making the
  teams, remaking them, moving a player, slotting in late sign-ups, and keeping the teams without whoever's out. Each
  save says what happened in the app's save note ("Reno to Cougars"), which shows wherever you've scrolled.
- **Make teams is the team maker's call to action, in words**, always there for them on the training's page (greyed
  until someone's in, so nothing moves when the first person signs up): on a phone a bar of its own above the tabs,
  where the thumb is, the page keeping room for it at the bottom so it covers no row; on a desktop the main button at
  the right of the toolbar. Members never see it.
- **Once the teams are out it's Remake teams, with Clear teams beside it** (Clear on a phone). Remaking takes a second
  tap ("Tap again to remake"), because it replaces what everyone can see; making the first ones doesn't. Clearing
  throws the team maker's work away, so it asks in a sheet (Keep them / Clear teams, the red one) before everyone's
  back to Who's in, on no team; who's in stays. It's `DELETE /api/sessions/{id}/teams`, under `publish:Teams` like
  every change to the teams, on the record as `teams.removed`, and members' pages hear it live
  ([0072](0072-live-updates.md)). It isn't in Manage too: one place for it.
- **Team makers move players by dragging** a row's grip onto another team, with pointer events so it works with a
  finger as well as a mouse. Enter or Space on the focused grip moves the player to the next team, for keyboards and
  screen readers. **A click or tap on the grip does nothing**: with every move saved, a tap that sent someone to
  another team made them seem to vanish.
- **When the teams stop matching who's in, the page says so**: someone signed up after them (slot them in by rule,
  `slotIn` in lib/balance.ts, or remake), or someone said they're out since (keep the teams as they are without them, or
  remake). Saying out doesn't take a member off a published team: they stay on it, marked Out, until a team maker
  decides. An admin taking someone off the session still takes them off their team.
- The warning takes the place of the In / Waiting / Spaces numbers, over them and the same height, so nothing below
  moves.

## Consequences

- What a team maker sees is what everyone sees. There's no Discard: an accidental move is undone by moving the player
  back.
- Members may see the teams shift while they're being arranged. On a Friday that's a few minutes before the session.
- Each move is one Worker request: a few dozen on a busy night.

## History

- 2026-10-08: A Team maker role; players moved by dragging or a tap on the grip; changes to published teams were a
  draft in the team maker's browser until they pressed Publish, in a banner at the top of the page (was 0076).
- 2026-10-08: Drafts and Publish went: the banner was out of sight of the moves, so a move looked done but wasn't.
  Every change saves at once, a tap on the grip no longer moves anyone, and the warning moved over the counts (was 0079).
- 2026-10-09: Door (the register) and Team maker became one role, Session lead; anyone who had either has it.
- 2026-10-20: Make teams became a worded call to action for the team maker (a bar above the tabs on a phone; it had
  been an icon in the phone bar, the same icon as the Cards view beside the list, which now has its own), and
  Remove the teams left Manage to sit beside it as Clear teams, asked in a sheet rather than by a second tap.
