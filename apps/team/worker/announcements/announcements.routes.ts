// Announcements (#85): posting and taking one down (on the record), a member getting one ("Got it", for themselves),
// and looking back over all of them.
import { id, ok, type Route } from "../api/api.route";
import { HttpError, body, json } from "../api/api.http";
import {
  announcementSummary,
  dismissAnnouncement,
  PAST_PAGE,
  pastAnnouncements,
  postAnnouncement,
  removeAnnouncement,
} from "./announcements";
import { announced } from "../push/push.notices";

export const ANNOUNCEMENTS_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/announcements$/,
    action: "authenticated",
    // Every one, newest first, with whether you got it: ?before=<id> for the page after, ?limit= up to 100
    handle: async (c) => {
      const q = new URL(c.request.url).searchParams;
      const before = q.get("before");
      const limit = q.get("limit");
      if ((before && !/^\d+$/.test(before)) || (limit && !/^\d+$/.test(limit)))
        throw new HttpError(400, "before and limit should be whole numbers.");
      return json(
        await pastAnnouncements(c.env.DB, c.memberId, {
          before: before ? Number(before) : null,
          limit: limit ? Number(limit) : PAST_PAGE,
        }),
      );
    },
  },
  {
    method: "POST",
    path: /^\/api\/announcements$/,
    audit: {
      event: "announcement.posted",
      subject: async (c, reply) => (reply ? announcementSummary(c.env.DB, reply.id as number) : null),
    },
    action: "post:Announcement",
    changes: ["announcements"],
    notify: announced,
    handle: async (c) => json(await postAnnouncement(c.env.DB, await body(c.request), c.memberId, c.today, c.now), 201),
  },
  {
    method: "DELETE",
    path: /^\/api\/announcements\/(\d+)$/,
    audit: { event: "announcement.removed", subject: (c) => announcementSummary(c.env.DB, id(c)) },
    action: "post:Announcement",
    changes: ["announcements"],
    handle: async (c) => (await removeAnnouncement(c.env.DB, id(c)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/announcements\/(\d+)\/dismiss$/,
    audit: { none: "a member's own Home: dismissing an announcement is nobody else's business" },
    action: "authenticated",
    changes: ["announcements"],
    handle: async (c) => (await dismissAnnouncement(c.env.DB, id(c), c.memberId), ok()),
  },
];
