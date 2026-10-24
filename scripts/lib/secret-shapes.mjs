// What a secret should look like, and how to tell two values apart without showing either (#149, docs/secrets.md
// "Handing a secret over"). The Secrets page (scripts/lib/secrets-page.mjs) checks a value's shape before it saves it,
// here and, from the same function, in the browser; it shows each stored value only as its fingerprint.
import { createHash } from "node:crypto";

/** How many hex digits of SHA-256 a fingerprint shows: enough to tell values apart, far too few to guess one. */
export const FINGERPRINT_HEX = 12;

/** A value as the page shows it: its length, last 4 characters and the start of its SHA-256. Never the value. */
export function fingerprint(value) {
  return {
    length: value.length,
    last4: value.length > 8 ? value.slice(-4) : "",
    sha: createHash("sha256").update(value, "utf8").digest("hex").slice(0, FINGERPRINT_HEX),
  };
}

/**
 * What looks wrong with `value` as the secret `name`: a list of plain sentences, empty when it looks right or when
 * the secret has no known form. A warning never stops a save; the page asks first. Self-contained (no imports, no
 * outside names) because the page sends this very function to the browser.
 */
export function shapeWarnings(name, value) {
  const json = (check) => (v) => {
    try {
      return check(JSON.parse(v));
    } catch {
      return false;
    }
  };
  const pkcs8 = (v) => /^-----BEGIN PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PRIVATE KEY-----$/.test(v);
  const KEY_32_BYTES = /^[A-Za-z0-9+/_-]{43}=?$/;
  // [names it applies to, the form (a pattern or a check), what that form is]
  const SHAPES = [
    [
      /_CLIENT_SECRET$/,
      /^GOCSPX-[A-Za-z0-9_-]{28}$/,
      "a Google client secret is GOCSPX- and 28 letters, digits, - or _",
    ],
    [
      /^(BWS_ACCESS_TOKEN|COUGARS_LOCAL_BW_TOKEN)/,
      /^0\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{20,}:[A-Za-z0-9+/]{20,}={0,2}$/,
      "a Bitwarden access token is 0.<id>.<secret>:<key>",
    ],
    [/^GMAIL_REFRESH_TOKEN/, /^1\/\/0[A-Za-z0-9_-]{40,}$/, "a Google refresh token starts 1//0"],
    [
      /^GMAIL_WEB_CLIENT_ID/,
      /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
      "a Google client ID ends .apps.googleusercontent.com",
    ],
    [/^YOUTUBE_API_KEY/, /^AIza[0-9A-Za-z_-]{35}$/, "a Google API key is AIza and 35 more"],
    [
      /^(APP_STORE_CONNECT_KEY|GITHUB_APP_PRIVATE_KEY)(__[A-Z]+)?$/,
      pkcs8,
      "a PKCS#8 key: -----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY----- (GitHub's PKCS#1 key needs converting first)",
    ],
    [
      /^FIREBASE_SERVICE_ACCOUNT/,
      json((o) => o?.type === "service_account" && !!o.client_email && /BEGIN PRIVATE KEY/.test(o.private_key ?? "")),
      "a service account's JSON key: type service_account, with client_email and private_key",
    ],
    [/^TEAM_ROSTER/, json(Array.isArray), "the roster is one JSON array of players"],
    [/^TURNSTILE_SECRET_KEY/, /^0x4[A-Za-z0-9_-]{20,}$/, "a Turnstile secret key starts 0x4"],
    [/^SENTRY_(AUTH|ISSUES)_TOKEN/, /^sntr[ysu]_[A-Za-z0-9+/=_.-]{20,}$/, "a Sentry token starts sntrys_ or sntryu_"],
    [/^SENTRY_DSN/, /^https:\/\/[0-9a-f]+@[^/\s]+\/\d+$/, "a Sentry DSN is https://<key>@<host>/<project>"],
    [/^SANITY_.*TOKEN/, /^sk[A-Za-z0-9]{150,}$/, "a Sanity token is sk and 150 or more letters and digits"],
    [
      /^CLOUDFLARE_(API|ANALYTICS)_TOKEN/,
      /^[A-Za-z0-9_-]{40,60}$/,
      "a Cloudflare API token is 40-odd letters, digits, - or _",
    ],
    [/^CF_ACCESS_CLIENT_ID/, /^[0-9a-f]{32}\.access$/, "an Access client ID is 32 hex digits and .access"],
    [/^CF_ACCESS_CLIENT_SECRET/, /^[0-9a-f]{64}$/, "an Access client secret is 64 hex digits"],
    [/^(BACKUP_KEY|GMAIL_TOKEN_KEY|INSTAGRAM_TOKEN_KEY)/, KEY_32_BYTES, "our keys are 32 random bytes, base64"],
    [/^VAPID_PRIVATE_KEY/, /^[A-Za-z0-9_-]{43}$/, "a VAPID private key is 32 bytes, base64url (43 characters)"],
  ];
  const warnings = [];
  if (!value) return ["It's empty."];
  if (value.startsWith(`${name}=`) || /^(export\s+)?[A-Z][A-Z0-9]*_[A-Z0-9_]*=\S/.test(value))
    warnings.push("It starts with a NAME=: paste only the value.");
  if (/^(["'`]).*\1$/s.test(value)) warnings.push("It's in quotes: paste it without them.");
  const shape = SHAPES.find(([names]) => names.test(name));
  const multiline = /PRIVATE_KEY|APP_STORE_CONNECT_KEY$|SERVICE_ACCOUNT|IOS_CONFIG|ROSTER/.test(name);
  if (!multiline && /\s/.test(value)) warnings.push("It has a space or a line break in it, which a token never has.");
  if (shape) {
    const [, form, says] = shape;
    const fits = typeof form === "function" ? form(value) : form.test(value);
    if (!fits) warnings.push(`It doesn't look like one: ${says}.`);
  }
  return warnings;
}
