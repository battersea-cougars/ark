#!/usr/bin/env node
// Set up the team app in the App Store through Apple's App Store Connect API (docs/adr/0108-store-apps.md): its bundle
// id with the capabilities it uses (notifications; links to the team app opening the app), and it checks the Apple
// team's id (APPLE_TEAM_ID, not secret: the Worker serves it to phones and store.yml signs with it) against the one
// committed in scripts/lib/settings.mjs, saying what to put there if it differs. Safe to run again: it changes nothing
// that's already right.
//   node scripts/env-pull.mjs -- node scripts/store-setup.mjs
// Needs APP_STORE_CONNECT_KEY (the secret) and APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID (settings), which
// env-pull hands it (docs/secrets.md#apple).
// The app's record (name, description, screenshots) is made in App Store Connect by hand: Apple's API can't.
// The Play Store's setup joins this when the Android app comes (the ADR lists what it needs).
import { createPrivateKey, sign } from "node:crypto";

const APP_ID = "com.batterseacougars.team";
const NAME = "Cougars Fresh Meat";
const CAPABILITIES = ["PUSH_NOTIFICATIONS", "ASSOCIATED_DOMAINS"];

const { APP_STORE_CONNECT_KEY_ID: keyId, APP_STORE_CONNECT_ISSUER_ID: issuer, APP_STORE_CONNECT_KEY: p8 } = process.env;
if (!keyId || !issuer || !p8) throw new Error("No App Store Connect key: run it through scripts/env-pull.mjs.");

/** A 20-minute token, signed with the API key (ES256), as Apple asks. */
function token() {
  const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "ES256", kid: keyId, typ: "JWT" })}.${b64({ iss: issuer, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: createPrivateKey(p8), dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${signature.toString("base64url")}`;
}

async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const out = res.status === 204 ? {} : await res.json();
  if (!res.ok) throw new Error(`App Store Connect ${method} ${path}: ${JSON.stringify(out.errors ?? out)}`);
  return out;
}

const found = await asc(
  "GET",
  `/bundleIds?filter[identifier]=${APP_ID}&include=bundleIdCapabilities&fields[bundleIds]=identifier,seedId,name`,
);
let bundle = found.data.find((b) => b.attributes.identifier === APP_ID);
if (!bundle) {
  bundle = (
    await asc("POST", "/bundleIds", {
      data: { type: "bundleIds", attributes: { identifier: APP_ID, name: NAME, platform: "IOS" } },
    })
  ).data;
  console.log(`Registered ${APP_ID}.`);
} else console.log(`${APP_ID} is registered.`);

const have = new Set(
  (found.included ?? []).filter((i) => i.type === "bundleIdCapabilities").map((c) => c.attributes.capabilityType),
);
for (const capability of CAPABILITIES) {
  if (have.has(capability)) continue;
  await asc("POST", "/bundleIdCapabilities", {
    data: {
      type: "bundleIdCapabilities",
      attributes: { capabilityType: capability },
      relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } } },
    },
  });
  console.log(`Turned on ${capability}.`);
}

// The team's id is the bundle id's prefix (Apple calls it the seed id). Not secret, so it's committed, not stored.
const teamId = bundle.attributes.seedId;
if (process.env.APPLE_TEAM_ID === teamId) console.log("APPLE_TEAM_ID in scripts/lib/settings.mjs is right.");
else console.log(`Put APPLE_TEAM_ID: "${teamId}" in scripts/lib/settings.mjs and commit it (not secret).`);
console.log("Next: make the app's record in App Store Connect (My Apps → +) with this bundle id.");
