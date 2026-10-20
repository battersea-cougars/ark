// The token that reads the club's Instagram posts (lib/server/instagram.ts, ADR 0113). It lasts 60 days, and one call
// with the current token returns a fresh one, no sign-in. The first comes from Bitwarden (INSTAGRAM_TOKEN); the
// website's daily cron renews it once a week and keeps the new one in D1 (sealed_tokens), the one exception to
// secrets living only in Bitwarden (ADR 0002): nothing that runs by itself can write there.
//
// Sealed in the Worker before it's written: AES-GCM with INSTAGRAM_TOKEN_KEY (a Worker secret, 32 bytes, base64),
// the row's name bound in as associated data. So someone with the database (the dashboard, an export, a backup) can't
// read it, change it unnoticed, or move a sealed value to another row. If it won't open, the Bitwarden token is used,
// and an error says so. Never logged.
import { first, run } from "@cougars/shared/d1";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("instagram");

const NAME = "instagram";
const DAY = 24 * 60 * 60_000;
const RENEW_EVERY = 7 * DAY;
const REFRESH_URL = "https://graph.instagram.com/refresh_access_token";

export interface InstagramTokenEnv {
  DB: D1Database;
  INSTAGRAM_TOKEN?: string;
  INSTAGRAM_TOKEN_KEY?: string;
}

interface Row {
  sealed: string;
  expires_at: string;
  renewed_at: string;
}

const utf8 = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const associated = (name: string) => utf8.encode(`sealed_tokens:${name}`);

async function aesKey(base64: string): Promise<CryptoKey> {
  const raw = fromBase64(base64);
  if (raw.length !== 32) throw new Error("INSTAGRAM_TOKEN_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** The token sealed for the row `name`: base64 of a random 12-byte IV, then the ciphertext and its tag. */
export async function seal(token: string, key: string, name: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = { name: "AES-GCM", iv, additionalData: associated(name) };
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(params, await aesKey(key), utf8.encode(token)));
  return toBase64(new Uint8Array([...iv, ...ciphertext]));
}

/** The token, or a throw if the key is wrong, the value was changed, or it was sealed for another row. */
async function unseal(sealed: string, key: string, name: string): Promise<string> {
  const bytes = fromBase64(sealed);
  const params = { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: associated(name) };
  return new TextDecoder().decode(await crypto.subtle.decrypt(params, await aesKey(key), bytes.slice(12)));
}

const stored = (db: D1Database) =>
  first<Row>(db, "SELECT sealed, expires_at, renewed_at FROM sealed_tokens WHERE name = ?", [NAME]);

/** The token to read posts with: the renewed one if it opens, else Bitwarden's, else null (not set up yet). */
export async function instagramToken(env: InstagramTokenEnv): Promise<string | null> {
  const row = env.INSTAGRAM_TOKEN_KEY ? await stored(env.DB) : null;
  if (row) {
    try {
      return await unseal(row.sealed, env.INSTAGRAM_TOKEN_KEY!, NAME);
    } catch (error) {
      log.error("instagram.token_unreadable", { reason: (error as Error).name });
    }
  }
  return env.INSTAGRAM_TOKEN || null;
}

export type Renewal = "renewed" | "not-due" | "failed" | "no-token" | "no-key";

/**
 * The cron's weekly renewal: a fresh token for the current one, sealed and stored. Daily runs do nothing until a week
 * has passed. A refusal is an error (an alert in Sentry), with the days the current token has left.
 */
export async function renewInstagramToken(
  env: InstagramTokenEnv,
  { now = Date.now(), fetch = globalThis.fetch }: { now?: number; fetch?: typeof globalThis.fetch } = {},
): Promise<Renewal> {
  if (!env.INSTAGRAM_TOKEN_KEY) return "no-key";
  const row = await stored(env.DB);
  if (row && now - Date.parse(row.renewed_at) < RENEW_EVERY) return "not-due";
  const current = await instagramToken(env);
  if (!current) return "no-token";

  const url = new URL(REFRESH_URL);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", current);
  const daysLeft = row ? Math.floor((Date.parse(row.expires_at) - now) / DAY) : null;
  let fresh: { access_token?: string; expires_in?: number };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    fresh = await res.json();
    if (!res.ok || !fresh.access_token || !fresh.expires_in) {
      const why = (fresh as { error?: { message?: string } }).error?.message ?? "no token in the answer";
      throw new Error(`Instagram answered ${res.status}: ${why}`);
    }
  } catch (error) {
    log.error("instagram.token_renewal_failed", error, { daysLeft });
    return "failed";
  }
  const sealed = await seal(fresh.access_token, env.INSTAGRAM_TOKEN_KEY, NAME);
  const expires = new Date(now + fresh.expires_in * 1000).toISOString();
  await run(
    env.DB,
    `INSERT INTO sealed_tokens (name, sealed, expires_at, renewed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET sealed = excluded.sealed, expires_at = excluded.expires_at,
       renewed_at = excluded.renewed_at`,
    [NAME, sealed, expires, new Date(now).toISOString()],
  );
  log.info("instagram.token_renewed", { expires });
  return "renewed";
}
