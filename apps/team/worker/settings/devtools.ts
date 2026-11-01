// Dev tools (ADR 0027): what an admin can change outside production without a deploy. For now, who gets their own
// email: everyone else's still goes to the safe inbox (packages/shared/email.ts). In production none of this exists, and the
// list is never read: real recipients always get their own email there.
import { all, run } from "@cougars/shared/d1";
import { clubContact } from "@cougars/shared/club-contact";
import { email, type AuthEnv } from "../auth/auth";
import { HttpError } from "../api/api.http";

/**
 * Whether Dev tools (and every dev-only tool, ADR 0123) exist here: only where the environment says, in so many words,
 * that it isn't production. A deploy says with SITE_ENV (scripts/ci/target.mjs: "dev" from main, "production" from
 * release); your own machine's server with TEAM_ENV "local" (vite.config.ts) and no SITE_ENV. Anything else
 * (production, a missing or unknown environment) is production here: fail closed (#81).
 */
export const devToolsHere = (env: { SITE_ENV?: string; TEAM_ENV?: string }) =>
  env.SITE_ENV === "dev" || (env.TEAM_ENV === "local" && env.SITE_ENV === undefined);

const here = (env: { SITE_ENV?: string; TEAM_ENV?: string }) => {
  if (!devToolsHere(env)) throw new HttpError(404, "Not found.");
};

export async function devMailList(env: AuthEnv): Promise<string[]> {
  here(env);
  const rows = await all<{ email: string }>(env.DB, "SELECT email FROM dev_mail_recipients ORDER BY email");
  return rows.map((r) => r.email);
}

export async function addDevMail(env: AuthEnv, o: Record<string, unknown>, by: number, now: string) {
  here(env);
  const address = email(o);
  if (address === (await clubContact(env.SITE_ENV)))
    throw new HttpError(400, "Not the club's own inbox: it never gets email from dev.");
  await run(env.DB, "INSERT OR IGNORE INTO dev_mail_recipients (email, added_by, added_at) VALUES (?, ?, ?)", [
    address,
    by,
    now,
  ]);
}

export async function removeDevMail(env: AuthEnv, o: Record<string, unknown>) {
  here(env);
  await run(env.DB, "DELETE FROM dev_mail_recipients WHERE email = ?", [email(o)]);
}
