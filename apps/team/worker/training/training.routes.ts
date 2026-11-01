// Training (ADR 0030, ADR 0076): series and their sessions, the register, and the night's teams.
import { places, sessionOff, teamsOut } from "../push/push.notices";
import { can } from "../../src/access/actions";
import { id, memberIdIn, ok, rowOf, rowsOf, type Route } from "../api/api.route";
import { seriesFeeChange } from "../dues/dues";
import { letIn, mark } from "../entries/entries";
import { HttpError, body, json } from "../api/api.http";
import { createSeries, moreSessions, nightOf, updateSeries } from "./training";
import { backOn, callOff } from "./training.nights-off";
import { publishTeams, removeTeams, resetSession, sessionSignups } from "./training.teams";

/** What a night's called off for: a tournament on its day (the clash sheet's Cancel), or null, by hand. */
function offFor(b: Record<string, unknown>) {
  if (b.tournamentId == null) return null;
  if (!Number.isInteger(b.tournamentId)) throw new HttpError(400, "tournamentId should be a tournament's id.");
  return b.tournamentId as number;
}

export const TRAINING_ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/series$/,
    audit: {
      event: "training.created",
      subject: rowOf(
        `SELECT ts.id, ts.name, ts.weekdays, ts.repeat_every repeatEvery, ts.start_time startTime, ts.end_time endTime,
                ts.venue_id venueId, ts.capacity, ts.goalie_capacity goalieCapacity, ts.active,
                (SELECT json_group_array(json_object('from', f.effective_from, 'pence', f.amount_pence))
                   FROM series_fees f WHERE f.series_id = ts.id) fees
         FROM training_series ts WHERE ts.id = ?`,
      ),
    },
    action: "manage:Training",
    changes: ["series", "sessions", "charges", "dues"],
    handle: async (c) => {
      const b = await body(c.request);
      // A new training is free until whoever sets fees says otherwise; its fees go in with it, or neither (#131)
      const fees = can(c.actions, "manage:Fees") ? await seriesFeeChange(c.env.DB, null, b.fees, c.actions) : undefined;
      return json(await createSeries(c.env.DB, b, c.today, fees), 201);
    },
  },
  {
    method: "PUT",
    path: /^\/api\/series\/(\d+)$/,
    audit: {
      event: "training.updated",
      subject: rowOf(
        `SELECT ts.id, ts.name, ts.weekdays, ts.repeat_every repeatEvery, ts.start_time startTime, ts.end_time endTime,
                ts.venue_id venueId, ts.capacity, ts.goalie_capacity goalieCapacity, ts.active,
                (SELECT json_group_array(json_object('from', f.effective_from, 'pence', f.amount_pence))
                   FROM series_fees f WHERE f.series_id = ts.id) fees
         FROM training_series ts WHERE ts.id = ?`,
      ),
    },
    action: "manage:Training",
    changes: ["series", "sessions", "charges", "dues"],
    // A limit raised lets the first waiting in on each night, and they hear it
    notify: places,
    // Its fees too, for whoever sets fees (ADR 0007)
    handle: async (c) => {
      const b = await body(c.request);
      const fees = await seriesFeeChange(c.env.DB, id(c), b.fees, c.actions);
      await updateSeries(c.env.DB, id(c), b, c.today, c.now, fees);
      return ok();
    },
  },
  {
    method: "POST",
    path: /^\/api\/series\/(\d+)\/more$/,
    audit: {
      event: "sessions.added",
      subject: rowOf("SELECT COUNT(*) sessions, MAX(held_on) lastOn FROM training_sessions WHERE series_id = ?"),
    },
    action: "manage:Training",
    changes: ["sessions"],
    handle: async (c) => (await moreSessions(c.env.DB, id(c), c.today), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/series\/(\d+)\/sessions$/,
    audit: {
      event: "sessions.added",
      subject: rowOf("SELECT COUNT(*) sessions, MAX(held_on) lastOn FROM training_sessions WHERE series_id = ?"),
    },
    action: "manage:Training",
    changes: ["sessions"],
    // { heldOn }: the one night the rule gives that day, made now (past the weeks ahead) so it can be cancelled
    // before the rest are made (a clash, ADR 0122); { id }, the same night if it's made already
    handle: async (c) => json({ id: await nightOf(c.env.DB, id(c), await body(c.request), c.today) }),
  },
  {
    method: "POST",
    path: /^\/api\/sessions\/(\d+)\/cancelled$/,
    audit: {
      event: "session.cancelled",
      subject: rowOf("SELECT id, held_on heldOn, cancelled_at cancelledAt FROM training_sessions WHERE id = ?"),
    },
    action: "manage:Training",
    changes: ["sessions", "members", "charges", "dues"],
    notify: sessionOff,
    handle: async (c) => {
      const b = await body(c.request);
      if (typeof b.cancelled !== "boolean") throw new HttpError(400, "cancelled should be true or false.");
      if (!b.cancelled) return (await backOn(c.env.DB, id(c), c.now), ok());
      await callOff(c.env.DB, id(c), offFor(b), c.now);
      return ok();
    },
  },
  {
    method: "POST",
    path: /^\/api\/sessions\/(\d+)\/teams$/,
    audit: {
      event: "teams.published",
      subject: rowsOf(
        `SELECT t.name, (SELECT json_group_array(p.member_id) FROM session_team_players p WHERE p.team_id = t.id) players
         FROM session_teams t WHERE t.session_id = ? ORDER BY t.position`,
      ),
    },
    action: "publish:Teams",
    changes: ["sessions"],
    notify: teamsOut,
    handle: async (c) => (await publishTeams(c.env.DB, id(c), await body(c.request), c.memberId, c.now), ok()),
  },
  {
    method: "DELETE",
    path: /^\/api\/sessions\/(\d+)\/teams$/,
    audit: {
      event: "teams.removed",
      subject: rowsOf(
        `SELECT t.name, (SELECT json_group_array(p.member_id) FROM session_team_players p WHERE p.team_id = t.id) players
         FROM session_teams t WHERE t.session_id = ? ORDER BY t.position`,
      ),
    },
    action: "publish:Teams",
    changes: ["sessions"],
    // Take the teams down; the sign-ups stay
    handle: async (c) => (await removeTeams(c.env.DB, id(c)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/sessions\/(\d+)\/let-in$/,
    audit: {
      event: "signups.changed",
      subject: rowsOf("SELECT member_id memberId, signup FROM attendance WHERE session_id = ? ORDER BY member_id"),
    },
    // Who's playing is the team maker's to decide on the night, as the teams are (ADR 0076)
    action: "publish:Teams",
    changes: ["sessions", "charges", "dues"],
    notify: places,
    // Someone waiting, in over the limit
    handle: async (c) => {
      const { memberId } = await memberIdIn(c);
      await letIn(c.env.DB, id(c), memberId, c.now);
      return ok();
    },
  },
  {
    method: "POST",
    path: /^\/api\/sessions\/(\d+)\/reset$/,
    audit: { event: "session.reset", subject: (c) => sessionSignups(c.env.DB, id(c)) },
    action: "update:Event",
    changes: ["sessions", "charges", "dues"],
    // Start the session again: no sign-ups, no teams
    handle: async (c) => (await resetSession(c.env.DB, id(c), c.now), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/sessions\/(\d+)\/register$/,
    audit: {
      // The register makes the night's charges (ADR 0007): who was there, who didn't come, who walked in
      event: "register.marked",
      subject: rowsOf(
        `SELECT member_id memberId, attended, walk_in walkIn FROM attendance
         WHERE session_id = ? AND signup = 'in' ORDER BY member_id`,
      ),
    },
    action: "record:Attendance",
    // Who came is who's charged (ADR 0007)
    changes: ["sessions", "members", "charges", "dues"],
    // A walk-in taken off frees a place
    notify: places,
    // The register on the night (or before it): here or not. Someone added to a full night waits for the team
    // maker's Let in (ADR 0131); the reply says where they went: { signup: "in" | "waitlist" | null }
    handle: async (c) => {
      const { b, memberId } = await memberIdIn(c);
      if (typeof b.here !== "boolean") throw new HttpError(400, "here should be true or false.");
      return json({ signup: await mark(c.env.DB, id(c), memberId, b.here, c.memberId, c.now) });
    },
  },
];
