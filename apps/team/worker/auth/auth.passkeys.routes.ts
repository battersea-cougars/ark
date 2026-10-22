// A member's passkeys, from their sheet (ADR 0023, ADR 0065): an admin sees them by device and date, and removes them
// all, say when a phone's lost or sold. Their sign-ins aren't touched (that's Sign out everywhere, beside it); they
// sign in with a code next time. A member's own passkeys are on the You page (auth.passkeys.ts, under /api/auth).
import { ok, type Route } from "../api/api.route";
import { json } from "../api/api.http";
import { memberExists } from "../dues/dues";
import { mayChange } from "../members/members";
import { forgetPasskeys, passkeyCount, passkeysOf } from "./auth.passkeys";

const id = (c: { params: string[] }) => Number(c.params[0]);

export const PASSKEY_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/members\/(\d+)\/passkeys$/,
    action: "manage:Member",
    handle: async (c) => {
      await memberExists(c.env.DB, id(c));
      return json({ passkeys: await passkeysOf(c.env.DB, id(c)) });
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/members\/(\d+)\/passkeys$/,
    audit: {
      event: "member.passkeys_removed",
      subject: (c) => passkeyCount(c.env.DB, id(c)),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "manage:Member",
    changes: ["members"],
    // Never for someone who can do more than them, as with signing them out
    handle: async (c) => {
      await memberExists(c.env.DB, id(c));
      await mayChange(c.env.DB, c.actions, id(c));
      await forgetPasskeys(c.env.DB, id(c));
      return ok();
    },
  },
];
