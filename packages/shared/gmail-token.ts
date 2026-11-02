// Which Gmail refresh token the website and the team app send with (ADR 0027): the deployed one from Bitwarden
// (GMAIL_REFRESH_TOKEN, made by scripts/gmail-auth.mjs), or one an admin made with "Reconnect email" in the team app,
// kept sealed in D1 (sealed-tokens.ts, ADR 0002). Both come from the one Web OAuth client. Never logged.
import { first, run } from "./d1";
import type { GmailCredentials } from "./email";
import { scribe } from "./scribe";
import { seal, unseal } from "./sealed-tokens";

const log = scribe.logger("mail");

const NAME = "gmail";

export interface GmailEnv {
  DB: D1Database;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_WEB_CLIENT_ID?: string;
  GMAIL_WEB_CLIENT_SECRET?: string;
  GMAIL_TOKEN_KEY?: string;
}

/** Where the token being used came from: an admin's reconnect (D1), or the deploy (Bitwarden). */
export type TokenSource = "reconnected" | "deployed";

/** Whether an admin can reconnect here: the Web client and the sealing key are both set up. */
export const canReconnect = (env: GmailEnv) =>
  !!(env.GMAIL_WEB_CLIENT_ID && env.GMAIL_WEB_CLIENT_SECRET && env.GMAIL_TOKEN_KEY);

/**
 * The token to send with, and where it came from; null when neither is set up (the email is logged, not sent). The
 * reconnected one wins; if it won't open (a changed key, a changed row), the deployed one is used and an error says so.
 * Each environment has its own D1, so reconnecting dev never touches production.
 */
export async function gmailCredentials(
  env: GmailEnv,
): Promise<{ gmail: GmailCredentials; source: TokenSource } | null> {
  if (canReconnect(env)) {
    try {
      const row = await first<{ sealed: string }>(env.DB, "SELECT sealed FROM sealed_tokens WHERE name = ?", [NAME]);
      if (row)
        return {
          gmail: {
            clientId: env.GMAIL_WEB_CLIENT_ID!,
            clientSecret: env.GMAIL_WEB_CLIENT_SECRET!,
            refreshToken: await unseal(row.sealed, env.GMAIL_TOKEN_KEY!, NAME),
          },
          source: "reconnected",
        };
    } catch (error) {
      log.error("mail.token_unreadable", { reason: (error as Error).name });
    }
  }
  if (env.GMAIL_WEB_CLIENT_ID && env.GMAIL_WEB_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN)
    return {
      gmail: {
        clientId: env.GMAIL_WEB_CLIENT_ID,
        clientSecret: env.GMAIL_WEB_CLIENT_SECRET,
        refreshToken: env.GMAIL_REFRESH_TOKEN,
      },
      source: "deployed",
    };
  return null;
}

/** Keep the token an admin's reconnect made, sealed, in place of any before it. */
export async function keepReconnectedToken(env: GmailEnv, refreshToken: string, now: string): Promise<void> {
  if (!canReconnect(env)) throw new Error("Reconnecting isn't set up here (GMAIL_WEB_CLIENT_ID, GMAIL_TOKEN_KEY)");
  await run(
    env.DB,
    `INSERT INTO sealed_tokens (name, sealed, expires_at, renewed_at) VALUES (?, ?, NULL, ?)
     ON CONFLICT (name) DO UPDATE SET sealed = excluded.sealed, expires_at = NULL, renewed_at = excluded.renewed_at`,
    [NAME, await seal(refreshToken, env.GMAIL_TOKEN_KEY!, NAME), now],
  );
}
