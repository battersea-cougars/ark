// Club events: one-offs on the calendar (ADR 0042), and what's already on when something new would be (ADR 0122).
import { places } from "../push/push.notices";
import { id, ok, rowOf, type Route } from "../api/api.route";
import { HttpError, body, json } from "../api/api.http";
import { findClashes } from "./clashes";
import { createClubEvent, setClubEventCancelled, updateClubEvent } from "./events";

export const EVENTS_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/calendar\/clashes$/,
    // What's on the calendar, which every member sees; whether it's theirs to cancel is in each answer
    action: "read:Event",
    // ?startsAt=&endsAt=[&except=tournament:5]: asked before a save, so the admin can say what's off (ADR 0122)
    handle: async (c) => {
      const q = new URL(c.request.url).searchParams;
      const window = { startsAt: q.get("startsAt") ?? "", endsAt: q.get("endsAt") ?? "", except: q.get("except") };
      return json({ clashes: await findClashes(c.env.DB, window, c.today, c.actions) });
    },
  },
  {
    method: "POST",
    path: /^\/api\/club-events$/,
    audit: {
      event: "event.created",
      subject: rowOf(
        "SELECT id, title, starts_at startsAt, ends_at endsAt, venue, capacity, signup_enabled signup, public, cancelled_at cancelledAt FROM club_events WHERE id = ?",
      ),
    },
    action: "create:Event",
    changes: ["clubEvents"],
    handle: async (c) => json(await createClubEvent(c.env.DB, await body(c.request)), 201),
  },
  {
    method: "PUT",
    path: /^\/api\/club-events\/(\d+)$/,
    audit: {
      event: "event.updated",
      subject: rowOf(
        "SELECT id, title, starts_at startsAt, ends_at endsAt, venue, capacity, signup_enabled signup, public, cancelled_at cancelledAt FROM club_events WHERE id = ?",
      ),
    },
    action: "update:Event",
    changes: ["clubEvents"],
    // A limit raised lets the first waiting in, and they hear it
    notify: places,
    handle: async (c) => (await updateClubEvent(c.env.DB, id(c), await body(c.request), c.today, c.now), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/club-events\/(\d+)\/cancelled$/,
    audit: {
      event: "event.cancelled",
      subject: rowOf(
        "SELECT id, title, starts_at startsAt, ends_at endsAt, venue, capacity, signup_enabled signup, public, cancelled_at cancelledAt FROM club_events WHERE id = ?",
      ),
    },
    action: "update:Event",
    changes: ["clubEvents"],
    handle: async (c) => {
      const b = await body(c.request);
      if (typeof b.cancelled !== "boolean") throw new HttpError(400, "cancelled should be true or false.");
      await setClubEventCancelled(c.env.DB, id(c), b.cancelled, c.now);
      return ok();
    },
  },
];
