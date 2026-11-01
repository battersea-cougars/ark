// Passkeys' routes (ADR 0023). A member's own, under /api/auth/passkeys (handlePasskeys, sent here by auth.routes.ts):
// signing in with one, and listing, adding and removing yours on the You page. And a member's, from their sheet
// (ADR 0065): an admin sees them by device and date, and removes them all, say when a phone's lost or sold. Their
// sign-ins aren't touched (that's Sign out everywhere, beside it); they sign in with a code next time.
import { ok, type Route } from "../api/api.route";
import { json } from "../api/api.http";
import { memberExists } from "../dues/dues";
import { mayChange } from "../members/members";
import { refuseWhileViewing } from "../members/view-as";
import { findSession, type AuthEnv } from "./auth";
import {
  forgetPasskey,
  forgetPasskeys,
  passkeyCount,
  passkeysOf,
  register,
  registerOptions,
  signIn,
  signInOptions,
} from "./auth.passkeys";

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

/** A member's own passkey routes, under /api/auth/passkeys (not a change to the club: the bootstrap's version stays). */
export async function handlePasskeys(request: Request, env: AuthEnv, now: Date): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const m = request.method;
  if (pathname === "/api/auth/passkeys/sign-in-options" && m === "POST") return signInOptions(request, env, now);
  if (pathname === "/api/auth/passkeys/sign-in" && m === "POST") return signIn(request, env, now);
  // The rest are yours: signed in
  const session = await findSession(request, env, now);
  if (!session) return json({ error: "Sign in first." }, 401);
  // Viewing as a member (ADR 0024): their passkeys, as they'd see them, and no changes
  if (pathname === "/api/auth/passkeys" && m === "GET")
    return json({ passkeys: await passkeysOf(env.DB, session.viewing_as ?? session.member_id) });
  await refuseWhileViewing(env.DB, session.viewing_as);
  const mine = { memberId: session.member_id, sessionId: session.id };
  if (pathname === "/api/auth/passkeys/register-options" && m === "POST")
    return registerOptions(request, env, now, mine);
  if (pathname === "/api/auth/passkeys/register" && m === "POST") return register(request, env, now, mine);
  const one = pathname.match(/^\/api\/auth\/passkeys\/(\d+)$/);
  if (!one || m !== "DELETE") return null;
  await forgetPasskey(env.DB, now, mine.memberId, Number(one[1]));
  return json({ ok: true });
}
