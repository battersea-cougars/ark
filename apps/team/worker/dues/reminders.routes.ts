// Reminders of what someone owes (ADR 0007): whoever records payments sees who'd get one and what it says, then sends
// them, to everyone who owes or to one member. The first few go after the reply; the rest on the next runs (reminders.ts).
import { type Route } from "../api/api.route";
import { HttpError, body, json } from "../api/api.http";
import { previewReminders, sendQueued, sendReminders } from "./reminders";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("reminders");

export const REMINDERS_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/dues\/reminders$/,
    action: "record:Payment",
    // ?member=12: their email, in the preview (else the first who owes)
    handle: async (c) => {
      const member = new URL(c.request.url).searchParams.get("member");
      if (member !== null && !/^\d+$/.test(member)) throw new HttpError(400, "member should be a member's id.");
      return json(await previewReminders(c.env.DB, new Date(c.now), member === null ? null : Number(member)));
    },
  },
  {
    method: "POST",
    path: /^\/api\/dues\/reminders$/,
    audit: {
      event: "dues.reminded",
      subject: async (_c, reply) => (reply ? { memberIds: reply.memberIds } : null),
      about: (_c, reply) =>
        Array.isArray(reply.memberIds) && reply.memberIds.length === 1 ? { memberId: reply.memberIds[0] } : {},
    },
    action: "record:Payment",
    changes: ["reminders"],
    // { memberIds? }: everyone who owes, or these; anyone reminded this week is held back
    handle: async (c) => {
      const now = new Date(c.now);
      const reply = await sendReminders(c.env, await body(c.request), c.memberId, now);
      const first = sendQueued(c.env, now).catch((e) => log.error("reminders.send_failed", e));
      if (c.waitUntil) c.waitUntil(first);
      else await first;
      return json(reply);
    },
  },
];
