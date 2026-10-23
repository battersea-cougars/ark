// Break glass's routes (ADR 0023, auth.break-glass.ts): each admin's Home lists the week's break-glass sign-ins, and
// calls off a code nobody's used or signs a session out. None makes a code: that's only ever at a terminal.
import { run } from "@cougars/shared/d1";
import { ok, type Route } from "../api/api.route";
import { HttpError } from "../api/api.http";
import { mayChange } from "../members/members";
import { breakGlassShown, stillLive, type Kind } from "./auth.break-glass";
import { endSessions } from "./auth.sessions";

/** Calling off a code nobody's used, or signing a break-glass session out: nobody meant to. */
const endRoute = (kind: Kind, plural: string): Route => ({
  method: "POST",
  path: new RegExp(`^\\/api\\/break-glass\\/${plural}\\/(\\d+)\\/end$`),
  audit: {
    event: "auth.break_glass",
    subject: async (c) => {
      const row = await stillLive(c.env.DB, kind, Number(c.params[0]), c.now);
      return row && { live: row.live };
    },
    about: (c) => ({ step: "ended", kind, id: Number(c.params[0]) }),
  },
  action: "manage:Member",
  changes: ["members"],
  // The session is signed out (its phones and live pages with it), or the code can't be used
  handle: async (c) => {
    const id = Number(c.params[0]);
    const row = await stillLive(c.env.DB, kind, id, c.now);
    if (!row) throw new HttpError(404, "There's no break-glass sign-in like that.");
    await mayChange(c.env.DB, c.actions, row.memberId);
    if (kind === "session") await endSessions(c.env, c.now, { sessionId: id });
    else
      await run(c.env.DB, "UPDATE login_challenges SET expires_at = ? WHERE id = ? AND used_at IS NULL", [c.now, id]);
    return ok();
  },
});

export const BREAK_GLASS_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/break-glass$/,
    action: "manage:Member",
    // Home's line for admins: who got in that way this week, and whether it's still a way in
    handle: async (c) => Response.json({ breakGlass: await breakGlassShown(c.env.DB, c.now) }),
  },
  endRoute("code", "codes"),
  endRoute("session", "sessions"),
];
