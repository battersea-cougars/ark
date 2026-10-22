// The club's email (#101, ADR 0027): whether it works, and reconnecting it when Google has cancelled its token.
import { type Route } from "../api/api.route";
import { json } from "../api/api.http";
import { finishReconnect, mailStatus, startReconnect } from "./mail";

export const MAIL_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/mail$/,
    action: "manage:Settings",
    // Settings → Email: the sending account, the From address, the last send or failure and why
    handle: async (c) => json(await mailStatus(c.env)),
  },
  {
    method: "POST",
    path: /^\/api\/mail\/reconnect$/,
    action: "manage:Settings",
    // Only the way to Google's consent page; the reconnect itself is on the record once it's done (mail.reconnected)
    audit: { none: "only starts Google's consent; the callback records the reconnect" },
    // Nothing yet: Settings → Email reads again once Google sends the admin back
    changes: ["settings"],
    handle: async (c) => startReconnect(c.env, c.request),
  },
  {
    method: "GET",
    path: /^\/api\/mail\/callback$/,
    action: "manage:Settings",
    // Back from Google's consent page (a top-level visit, so a GET): keeps the new token, then lands on Settings → Email
    handle: async (c) => finishReconnect(c.env, c.request, c.memberId, c.now),
  },
];
