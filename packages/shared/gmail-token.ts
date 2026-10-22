// Which Gmail token the website and the team app send with (ADR 0027). Two can exist:
//   - the deployed one: GMAIL_REFRESH_TOKEN from Bitwarden, made by scripts/gmail-auth.mjs (first-time setup) with the
//     Desktop client GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET;
//   - the reconnected one: made when an admin presses "Reconnect email" in the team app (apps/team/worker/mail), with
//     the Web client GMAIL_WEB_CLIENT_ID / GMAIL_WEB_CLIENT_SECRET, and kept in D1 (sealed_tokens, row "gmail"), sealed
//     with GMAIL_TOKEN_KEY (sealed-tokens.ts). The Worker can't write to Bitwarden, so this is the second exception to
//     secrets living only there (ADR 0002 point 8).
// The reconnected one wins. If it won't open (a changed key, a changed row), the deployed one is used and an error says
// so. Each environment has its own D1, so reconnecting dev never touches production. The token is never logged.
import { first, run } from "./d1";
import type { GmailCredentials } from "./email";
import { scribe } from "./scribe";
import { seal, unseal } from "./sealed-tokens";

const log = scribe.logger("mail");

const NAME = "gmail";

export interface GmailEnv {
  DB: D1Database;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
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

/** The token to send with, and where it came from; null when neither is set up (the email is logged, not sent). */
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
  if (env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN)
    return {
      gmail: {
        clientId: env.GMAIL_CLIENT_ID,
        clientSecret: env.GMAIL_CLIENT_SECRET,
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
