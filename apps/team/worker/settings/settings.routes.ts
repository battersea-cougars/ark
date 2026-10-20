// The club's settings that aren't a feature of their own: venues, live refresh, quips, dev tools (ADR 0027), usage (ADR 0059) and the audit log (ADR 0095).
import { id, ok, rowOf, type Route } from "../api/api.route";
import { AUDIT_PAGE, readAudit } from "./audit";
import { addDevMail, devMailList, removeDevMail } from "./devtools";
import { HttpError, body, json } from "../api/api.http";
import { createQuip, deleteQuip, updateQuip } from "./quips";
import { createVenue, updateVenue } from "./venues";
import { saveBank, saveSettings } from "./settings";
import { readUsage } from "./usage";

export const SETTINGS_ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/venues$/,
    audit: {
      event: "venue.added",
      subject: rowOf("SELECT id, name, address, map_url mapUrl, active FROM venues WHERE id = ?"),
    },
    action: "manage:Venue",
    changes: ["venues"],
    handle: async (c) => json(await createVenue(c.env.DB, await body(c.request)), 201),
  },
  {
    method: "PUT",
    path: /^\/api\/venues\/(\d+)$/,
    audit: {
      event: "venue.updated",
      subject: rowOf("SELECT id, name, address, map_url mapUrl, active FROM venues WHERE id = ?"),
    },
    action: "manage:Venue",
    changes: ["venues"],
    handle: async (c) => (await updateVenue(c.env.DB, id(c), await body(c.request)), ok()),
  },
  {
    method: "GET",
    path: /^\/api\/usage$/,
    action: "read:Usage",
    // Today's use of the club's free Cloudflare allowance (ADR 0059)
    handle: async (c) => json(await readUsage(c.env, new Date(c.now))),
  },
  {
    method: "GET",
    path: /^\/api\/audit$/,
    action: "read:Audit",
    // The record, newest first (ADR 0095): ?before=<id> for the page after, ?limit= up to 200
    handle: async (c) => {
      const q = new URL(c.request.url).searchParams;
      const before = q.get("before");
      const limit = q.get("limit");
      if ((before && !/^\d+$/.test(before)) || (limit && !/^\d+$/.test(limit)))
        throw new HttpError(400, "before and limit should be whole numbers.");
      return json(
        await readAudit(c.env.DB, {
          before: before ? Number(before) : null,
          limit: limit ? Number(limit) : AUDIT_PAGE,
        }),
      );
    },
  },
  {
    method: "PUT",
    path: /^\/api\/settings$/,
    audit: {
      event: "settings.updated",
      subject: rowOf("SELECT live_refresh_seconds liveRefreshSeconds FROM club_settings WHERE id = ?", () => 1),
    },
    action: "manage:Settings",
    changes: ["settings"],
    // { liveRefreshSeconds }: how often live pages check for updates (ADR 0072)
    handle: async (c) => (await saveSettings(c.env.DB, await body(c.request)), ok()),
  },
  {
    method: "PUT",
    path: /^\/api\/settings\/bank$/,
    audit: {
      event: "settings.bank",
      subject: rowOf(
        "SELECT bank_name name, bank_sort_code sortCode, bank_account account FROM club_settings WHERE id = ?",
        () => 1,
      ),
    },
    action: "manage:Fees",
    changes: ["settings"],
    // { name, sortCode, account }: where members pay (ADR 0007), on their Dues page and in reminders
    handle: async (c) => (await saveBank(c.env.DB, await body(c.request)), ok()),
  },
  // Dev tools (ADR 0027): who gets their own email outside production. Not there at all in production.
  {
    method: "GET",
    path: /^\/api\/dev\/mail$/,
    action: "manage:Settings",
    handle: async (c) => json({ addresses: await devMailList(c.env) }),
  },
  {
    method: "POST",
    path: /^\/api\/dev\/mail$/,
    // Who gets their own email outside production
    audit: { event: "dev_mail.changed", subject: (c) => devMailList(c.env) },
    action: "manage:Settings",
    // A club setting, read on its own page (GET /api/dev/mail)
    changes: ["settings"],
    handle: async (c) => (await addDevMail(c.env, await body(c.request), c.memberId, c.now), ok()),
  },
  {
    method: "DELETE",
    path: /^\/api\/dev\/mail$/,
    audit: { event: "dev_mail.changed", subject: (c) => devMailList(c.env) },
    action: "manage:Settings",
    // A club setting, read on its own page (GET /api/dev/mail)
    changes: ["settings"],
    handle: async (c) => (await removeDevMail(c.env, await body(c.request)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/quips$/,
    audit: { event: "quip.added", subject: rowOf("SELECT id, kind, text FROM quips WHERE id = ?") },
    action: "manage:Quip",
    changes: ["quips"],
    handle: async (c) => json(await createQuip(c.env.DB, await body(c.request)), 201),
  },
  {
    method: "PUT",
    path: /^\/api\/quips\/(\d+)$/,
    audit: { event: "quip.updated", subject: rowOf("SELECT id, kind, text FROM quips WHERE id = ?") },
    action: "manage:Quip",
    changes: ["quips"],
    handle: async (c) => (await updateQuip(c.env.DB, id(c), await body(c.request)), ok()),
  },
  {
    method: "DELETE",
    path: /^\/api\/quips\/(\d+)$/,
    audit: { event: "quip.removed", subject: rowOf("SELECT id, kind, text FROM quips WHERE id = ?") },
    action: "manage:Quip",
    changes: ["quips"],
    handle: async (c) => (await deleteQuip(c.env.DB, id(c)), ok()),
  },
];
