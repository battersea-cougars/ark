// Notifications (ADR 0108): what you choose to hear, a switch per topic on the You page. Only ever your own: there's
// no route to anyone else's. (The phone itself registers beside sign-in, at /api/auth/device.)
import { ok, type Route } from "../api/api.route";
import { body, json } from "../api/api.http";
import { slices } from "../api/api.slices";
import { choosePrefs } from "./push.prefs";

export const PUSH_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/me\/notifications$/,
    action: "authenticated",
    // { teams: true, places: false, ... }: every topic, on unless you turned it off (the bootstrap has it too)
    handle: async (c) => json((await slices(c, ["notifications"])).notifications),
  },
  {
    method: "PUT",
    path: /^\/api\/me\/notifications$/,
    audit: { none: "a member's own choice of notifications: theirs to change, and nobody else's business" },
    action: "authenticated",
    changes: ["notifications"],
    // { [topic]: boolean }: on or off, for one topic or more
    handle: async (c) => (await choosePrefs(c.env.DB, c.memberId, await body(c.request)), ok()),
  },
];
