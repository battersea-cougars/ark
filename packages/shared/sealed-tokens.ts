// Tokens kept in D1 (sealed_tokens) because nothing that writes them can write to Bitwarden (ADR 0002 point 8): the
// website's renewed Instagram token (ADR 0113) and the Gmail token an admin reconnects in the team app (ADR 0027).
//
// Sealed in the Worker before it's written: AES-GCM (Web Crypto) with a key of the token's own (a Worker secret,
// 32 random bytes, base64), the row's name bound in as associated data. So someone with the database (the dashboard,
// an export, a backup) can't read one, change it unnoticed, or move a sealed value to another row. Never logged.

const utf8 = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const associated = (name: string) => utf8.encode(`sealed_tokens:${name}`);

async function aesKey(base64: string): Promise<CryptoKey> {
  const raw = fromBase64(base64);
  if (raw.length !== 32) throw new Error("A sealing key must be 32 bytes, base64");
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
export async function unseal(sealed: string, key: string, name: string): Promise<string> {
  const bytes = fromBase64(sealed);
  const params = { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: associated(name) };
  return new TextDecoder().decode(await crypto.subtle.decrypt(params, await aesKey(key), bytes.slice(12)));
}
