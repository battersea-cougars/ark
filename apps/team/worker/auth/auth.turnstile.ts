// Cloudflare Turnstile in front of the two routes anyone can call without signing in (#13, ADR 0028): asking for a
// sign-in code and asking to join. The sign-in page's widget (src/lib/turnstile.ts, managed and shown only when
// Cloudflare wants a tap) puts its token in the body as `turnstile`; it's checked here once with Cloudflare, and a
// missing or failed check is refused. Free, no cookies.
//
// Without a secret (your machine, the tests) there's nothing to check against and it lets everyone through, as the
// website does; a deployed production server without one refuses instead, since that's a deploy gone wrong, not a
// laptop.
import { isProduction } from "@cougars/shared/email";
import { verifyTurnstile } from "@cougars/shared/turnstile";
import { scribe } from "@cougars/shared/scribe";
import { HttpError } from "../api/api.http";

const log = scribe.logger("turnstile");

export interface TurnstileEnv {
  /** The secret of the account's Turnstile widget (scripts/turnstile-setup.mjs), the same one the website uses. */
  TURNSTILE_SECRET_KEY?: string;
  SITE_ENV?: string;
}

/** What the widget was rendered for: a token for one can't be spent on the other. */
export type HumanAction = "sign-in" | "join";

const NOT_CHECKED = "We couldn't check you're a person. Reload the page and try again.";

/** Throws a 403 unless Cloudflare says a person sent this. `local`: your own machine's server (localHere). */
export async function mustBeHuman(
  env: TurnstileEnv,
  request: Request,
  body: Record<string, unknown>,
  { action, local }: { action: HumanAction; local: boolean },
): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY) {
    if (local || !isProduction(env.SITE_ENV)) return;
    log.error("turnstile.unset", new Error("No TURNSTILE_SECRET_KEY in production"), { action });
    throw new HttpError(503, "Signing in is being set up. Try again in a few minutes.");
  }
  const token = typeof body.turnstile === "string" ? body.turnstile : null;
  const ip = request.headers.get("cf-connecting-ip") ?? undefined;
  if (await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip, { action })) return;
  // A warning, not reported: a bot, or a widget left open too long, refused is Turnstile working. Cloudflare failing to
  // answer is an error, in verifyTurnstile (turnstile.error)
  log.warn("turnstile.refused", { action, token: !!token });
  throw new HttpError(403, NOT_CHECKED);
}
