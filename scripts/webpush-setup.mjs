#!/usr/bin/env node
// The club's VAPID key pair for Web Push (docs/adr/0108-store-apps.md, #24): what a browser's push service knows the
// team Worker by. The private key goes straight into Secrets Manager (VAPID_PRIVATE_KEY, README.md#web-push), never
// printed or written to a file; the public key is no secret, and goes in apps/team/wrangler.jsonc's vars, where the
// Worker and the app's build both read it. One pair serves dev and production: a subscription belongs to the origin
// that made it, so the two never share one.
// Safe to run again: with both in place it only checks they're a pair; it makes a new pair only when Bitwarden has none.
//   node scripts/webpush-setup.mjs
// Then commit apps/team/wrangler.jsonc if it changed (and run `npx wrangler types` in apps/team).
import { createECDH } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { bws, ensureToken, projectFor, setSecret } from "./lib/bitwarden.mjs";

const SECRET = "VAPID_PRIVATE_KEY";
const WRANGLER = new URL("../apps/team/wrangler.jsonc", import.meta.url);
const VAR = /("VAPID_PUBLIC_KEY":\s*)"([^"]*)"/;

/** The public key (uncompressed P-256 point, base64url) of a private key (its 32-byte `d`, base64url). */
function publicOf(d) {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(d, "base64url"));
  return ecdh.getPublicKey(null, "uncompressed").toString("base64url");
}

function storedSecret() {
  const project = bws(["project", "list"]).find((p) => p.name.trim().toLowerCase() === projectFor(SECRET));
  const found = bws(["secret", "list", project.id]).find((s) => s.key === SECRET);
  // Read into memory only, to check the pair: never printed
  return found ? bws(["secret", "get", found.id]).value : null;
}

function writePublicKey(key) {
  const config = readFileSync(WRANGLER, "utf8");
  if (!VAR.test(config)) throw new Error(`apps/team/wrangler.jsonc has no "VAPID_PUBLIC_KEY" in its vars.`);
  writeFileSync(WRANGLER, config.replace(VAR, `$1"${key}"`));
}

ensureToken();
const current = readFileSync(WRANGLER, "utf8").match(VAR)?.[2] ?? "";
const stored = storedSecret();

if (stored) {
  const key = publicOf(stored);
  if (key === current)
    console.log(`${SECRET} is in cougars-dev, and wrangler.jsonc has its public key: nothing to do.`);
  else {
    writePublicKey(key);
    console.log(`${SECRET} is in cougars-dev; its public key is now in apps/team/wrangler.jsonc: commit it.`);
  }
} else {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  // `d` is always 32 bytes, its leading zeros too
  const raw = ecdh.getPrivateKey();
  const d = Buffer.concat([Buffer.alloc(32 - raw.length), raw]).toString("base64url");
  const key = ecdh.getPublicKey(null, "uncompressed").toString("base64url");
  console.log(`${setSecret(SECRET, d)} ${SECRET} in cougars-dev.`);
  writePublicKey(key);
  console.log(
    "Its public key is in apps/team/wrangler.jsonc: commit it, and the next deploy puts the pair on the Worker.",
  );
  // Browsers that subscribed with an old key subscribe again with this one the next time they open the app
  if (current)
    console.log("(A new pair: browsers that turned notifications on take the new key when they next open the app.)");
}
