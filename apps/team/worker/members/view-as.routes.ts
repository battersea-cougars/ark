// Viewing the app as a member (ADR 0024, #40): starting, for whoever holds View as a member, and going back to
// yourself, which is the one change the API takes while you're viewing. Either way the app reads the whole club again,
// as whoever the sign-in is now answered as. What the API does meanwhile is api.ts's: it answers as the member and
// refuses every other change (view-as.ts).
import { type Ctx, memberIdIn, type Route } from "../api/api.route";
import { HttpError, json } from "../api/api.http";
import { first } from "@cougars/shared/d1";
import { endViewing, startViewing, viewingAsOf } from "./view-as";

const RELOADS = "who the app is shown as: everything it shows changes, so it reads the whole club again";
/** On the record (ADR 0095): who the sign-in is viewing as, before and after, about the member viewed. */
const viewing = (event: string) => ({
  event,
  subject: (c: Ctx) => viewingAsOf(c.env.DB, c.sessionId),
  about: (_c: Ctx, reply: Record<string, unknown>) => ({ memberId: reply.memberId }),
});

export const VIEW_AS_ROUTES: Route[] = [
  {
    method: "PUT",
    path: /^\/api\/me\/view-as$/,
    action: "impersonate:Member",
    reloads: RELOADS,
    audit: viewing("view_as.started"),
    handle: async (c) => {
      const { memberId } = await memberIdIn(c);
      if (c.sessionId == null) throw new HttpError(400, "Sign in first: viewing as someone is a sign-in's.");
      if (memberId === c.memberId) throw new HttpError(400, "That's you.");
      const active = await first(c.env.DB, "SELECT 1 FROM members WHERE id = ? AND status = 'active'", [memberId]);
      if (!active) throw new HttpError(404, "No such member.");
      await startViewing(c.env.DB, c.sessionId, memberId);
      return json({ ok: true, memberId });
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/me\/view-as$/,
    // Whatever the member viewed may do: going back is always there
    action: "authenticated",
    whileViewing: true,
    reloads: RELOADS,
    audit: viewing("view_as.ended"),
    handle: async (c) => {
      const memberId = await viewingAsOf(c.env.DB, c.sessionId);
      if (c.sessionId != null) await endViewing(c.env.DB, c.sessionId);
      return json({ ok: true, memberId });
    },
  },
];
