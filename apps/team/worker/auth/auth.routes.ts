// Sign-in's own routes (ADR 0023), under /api/auth: answered before anyone is signed in, so they aren't in the API's
// route table (api.ts sends /api/auth/* here). What each one does is in auth.ts; passkeys' are auth.passkeys.routes.ts.
import { handlePasskeys } from "./auth.passkeys.routes";
import { device, devSignIn, localHere, requestAccess, signOut, start, verify, type AuthEnv, type Waiter } from "./auth";

/** Sign-in's own routes, answered without a session. Null for anything else. */
export async function handleAuth(
  request: Request,
  env: AuthEnv,
  now: Date,
  waitUntil?: Waiter,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const m = request.method;
  if (pathname === "/api/auth/start" && m === "POST") return start(request, env, now, waitUntil);
  if (pathname === "/api/auth/verify" && m === "POST") return verify(request, env, now, waitUntil);
  // Passkeys: adding one (signed in), and signing in with one (auth.passkeys.ts)
  if (pathname.startsWith("/api/auth/passkeys")) return handlePasskeys(request, env, now);
  if (pathname === "/api/auth/sign-out" && m === "POST") return signOut(request, env, now);
  if (pathname === "/api/auth/sign-out-everywhere" && m === "POST") return signOut(request, env, now, true);
  if (pathname === "/api/auth/device" && (m === "PUT" || m === "DELETE")) return device(request, env, now);
  if (pathname === "/api/auth/request" && m === "POST") return requestAccess(request, env, now);
  // Your own machine only: anywhere else it isn't there at all (null: the API's 404)
  if (pathname === "/api/auth/dev" && m === "POST" && localHere(env, request)) return devSignIn(request, env, now);
  return null;
}
