// Announcements (#85): posting and taking one down (on the record), and a member dismissing one for themselves.
import { id, ok, type Route } from "../api/api.route";
import { json } from "../api/api.http";
import { body } from "../api/api.http";
import { announcementSummary, dismissAnnouncement, postAnnouncement, removeAnnouncement } from "./announcements";

export const ANNOUNCEMENTS_ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/announcements$/,
    audit: {
      event: "announcement.posted",
      subject: async (c, reply) => (reply ? announcementSummary(c.env.DB, reply.id as number) : null),
    },
    action: "post:Announcement",
    changes: ["announcements"],
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
