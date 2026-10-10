// Sign-ups (ADR 0036): in or out of a session, a tournament or a club event, and an admin putting someone in.
import { id, memberIdIn, ok, rowsOf, type Route } from "../api/api.route";
import { type Slice } from "../api/api.slices";
import { TABLES, answer, setPlayer, type EntryKind } from "./entries";
import { HttpError, body } from "../api/api.http";

// The same routes for each kind of event
const KINDS: [string, EntryKind, Slice][] = [
  ["sessions", "session", "sessions"],
  ["tournaments", "tournament", "tournaments"],
  ["club-events", "event", "clubEvents"],
];
export const ENTRIES_ROUTES: Route[] = KINDS.flatMap(([path, kind, slice]): Route[] => [
  {
    method: "POST",
    path: new RegExp(`^/api/${path}/(\\d+)/answer$`),
    audit: { none: "a member's own sign-up: the sign-ups are their own record (signed_up_at)" },
    action: "signup:Event",
    changes: slice === "clubEvents" ? [slice] : [slice, "charges", "credits", "payments"],
    // You, in or out
    handle: async (c) => {
      const b = await body(c.request);
      if (b.answer !== "in" && b.answer !== "out") throw new HttpError(400, "In or out?");
      await answer(c.env.DB, kind, id(c), c.memberId, b.answer, c.now);
      return ok();
    },
  },
  {
    method: "POST",
    path: new RegExp(`^/api/${path}/(\\d+)/players$`),
    audit: {
      event: "signups.changed",
      subject: rowsOf(
        `SELECT member_id memberId, signup FROM ${TABLES[kind].table} WHERE ${TABLES[kind].key} = ? ORDER BY member_id`,
      ),
    },
    action: "update:Event",
    // A past session's line-up is what a player's "played" counts
    changes:
      slice === "sessions"
        ? ["sessions", "members", "charges", "credits", "payments"]
        : slice === "tournaments"
          ? [slice, "charges", "credits", "payments"]
          : [slice],
    // An admin puts someone in, or takes them off
    handle: async (c) => {
      const { b, memberId } = await memberIdIn(c);
      if (typeof b.in !== "boolean") throw new HttpError(400, "in should be true or false.");
      await setPlayer(c.env.DB, kind, id(c), memberId, b.in, c.now);
      return ok();
    },
  },
]);
