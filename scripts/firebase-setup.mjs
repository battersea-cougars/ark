#!/usr/bin/env node
// Set up Firebase for the store app's notifications (docs/adr/0108-store-apps.md) in the club's Google Cloud project,
// through Google's APIs: Firebase turned on, the iOS app, and the service account the team Worker sends with. What it
// makes goes straight into Secrets Manager (FIREBASE_IOS_CONFIG, FIREBASE_SERVICE_ACCOUNT; README.md#store-app).
// Safe to run again: it changes nothing that's already right, and makes a new key only when Bitwarden has none.
//   gcloud auth login   (an Owner of the project, once; the devcontainer keeps it)
//   node scripts/firebase-setup.mjs
// The one step Google's API can't do: uploading the APNs key (APNS_KEY) in the Firebase console, which it prints.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { bws, ensureToken, projectFor, setSecret } from "./lib/bitwarden.mjs";

const PROJECT = "battersea-cougars";
const BUNDLE_ID = "com.batterseacougars.team";
const NAME = "Cougars team app";
const ACCOUNT = "firebase-service-account";
const ROLE = "roles/firebasecloudmessaging.admin";
const SERVICES = ["firebase.googleapis.com", "fcm.googleapis.com", "iam.googleapis.com"];

const gcloud = (...args) => execFileSync("gcloud", [...args, `--project=${PROJECT}`], { encoding: "utf8" }).trim();
const token = gcloud("auth", "print-access-token");

async function google(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "x-goog-user-project": PROJECT, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(out.error ?? out)}`);
  return out;
}

/** Waits for a long-running operation (Firebase answers some calls with one). */
async function done(operation, base = "https://firebase.googleapis.com/v1beta1") {
  let op = operation;
  while (!op.done) {
    await new Promise((r) => setTimeout(r, 2000));
    op = await google("GET", `${base}/${op.name}`);
  }
  if (op.error) throw new Error(JSON.stringify(op.error));
  return op.response;
}

function hasSecret(key) {
  const project = bws(["project", "list"]).find((p) => p.name.trim().toLowerCase() === projectFor(key));
  return bws(["secret", "list", project.id]).some((s) => s.key === key);
}

ensureToken();
gcloud("services", "enable", ...SERVICES);
console.log(`APIs on: ${SERVICES.join(", ")}.`);

const FIREBASE = `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}`;
const project = await fetch(FIREBASE, {
  headers: { authorization: `Bearer ${token}`, "x-goog-user-project": PROJECT },
});
if (project.status === 404) {
  await done(await google("POST", `${FIREBASE}:addFirebase`, {}));
  console.log(`Firebase turned on in ${PROJECT}.`);
} else if (!project.ok) throw new Error(`GET ${FIREBASE}: ${await project.text()}`);
else console.log(`Firebase is on in ${PROJECT}.`);

// The iOS app, and its GoogleService-Info.plist
const apps = (await google("GET", `${FIREBASE}/iosApps`)).apps ?? [];
let app = apps.find((a) => a.bundleId === BUNDLE_ID);
if (!app) {
  app = await done(await google("POST", `${FIREBASE}/iosApps`, { bundleId: BUNDLE_ID, displayName: NAME }));
  console.log(`Made the iOS app ${BUNDLE_ID}.`);
} else console.log(`The iOS app ${BUNDLE_ID} is there.`);
const config = await google("GET", `https://firebase.googleapis.com/v1beta1/${app.name}/config`);
const plist = Buffer.from(config.configFileContents, "base64").toString("utf8");
console.log(`${setSecret("FIREBASE_IOS_CONFIG", plist)} FIREBASE_IOS_CONFIG in cougars-dev.`);

// The service account the Worker sends with: Cloud Messaging only
const email = `${ACCOUNT}@${PROJECT}.iam.gserviceaccount.com`;
const accounts = JSON.parse(gcloud("iam", "service-accounts", "list", "--format=json"));
if (!accounts.some((a) => a.email === email)) {
  gcloud("iam", "service-accounts", "create", ACCOUNT, "--display-name=Firebase notifications (team Worker)");
  console.log(`Made the service account ${email}.`);
} else console.log(`The service account ${email} is there.`);
const bound = gcloud(
  "projects",
  "get-iam-policy",
  PROJECT,
  "--flatten=bindings[].members",
  `--filter=bindings.role=${ROLE} AND bindings.members=serviceAccount:${email}`,
  "--format=value(bindings.role)",
);
if (!bound) {
  const args = ["projects", "add-iam-policy-binding", PROJECT, `--member=serviceAccount:${email}`, `--role=${ROLE}`];
  gcloud(...args, "--condition=None", "--quiet");
}
console.log(`${email} has ${ROLE}.`);

if (hasSecret("FIREBASE_SERVICE_ACCOUNT")) console.log("FIREBASE_SERVICE_ACCOUNT is in cougars-dev: no new key.");
else {
  // The key goes from gcloud straight to Bitwarden, never to a file that stays
  const keyFile = `/dev/shm/${ACCOUNT}-${process.pid}.json`;
  try {
    gcloud("iam", "service-accounts", "keys", "create", keyFile, `--iam-account=${email}`);
    console.log(
      `${setSecret("FIREBASE_SERVICE_ACCOUNT", readFileSync(keyFile, "utf8"))} FIREBASE_SERVICE_ACCOUNT in cougars-dev.`,
    );
  } finally {
    rmSync(keyFile, { force: true });
  }
}

console.log(
  `Next, by hand (no API): upload the APNs key (APNS_KEY, its id APNS_KEY_ID, team APPLE_TEAM_ID) at\n` +
    `https://console.firebase.google.com/project/${PROJECT}/settings/cloudmessaging/ios:${BUNDLE_ID}`,
);
