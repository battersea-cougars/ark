// Settings → Website (#107): the website's state and Rebuild now, for whoever may edit the website (ADR 0024).
import { type Route } from "../api/api.route";
import { json } from "../api/api.http";
import { websiteTime } from "@cougars/shared/website-times";
import { rebuildNow } from "./website";
import { websiteStatus } from "./website.status";

export const WEBSITE_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/website$/,
    action: "edit:Content",
    handle: async (c) => json(await websiteStatus(c.env)),
  },
  {
    method: "POST",
    path: /^\/api\/website\/rebuild$/,
    action: "edit:Content",
    // On the record when GitHub was asked: the last rebuild's time moves on
    audit: { event: "website.rebuilt", subject: (c) => websiteTime(c.env.DB, "rebuild_sent") },
    // Settings → Website reads again: when it was sent, or that it's waiting
    changes: ["settings"],
    handle: async (c) => {
      const result = await rebuildNow(c.env, new Date(c.now));
      return json({ result, ...(await websiteStatus(c.env)) });
    },
  },
];
