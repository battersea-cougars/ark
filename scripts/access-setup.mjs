#!/usr/bin/env node
// Production behind Cloudflare Access until launch (ADR 0010): batterseacougars.com, www. and team. ask for an email
// and a one-time code, and let in only the emails on the Admins policy (managed in the dashboard; a first run starts it
// from the admins in the production roster, TEAM_ROSTER, ADR 0029), plus CI's service
// token for the deploy's smoke tests. Safe to run again: it finds what's there by name and puts it right. The service
// token's ID and secret go straight into Secrets Manager (CF_ACCESS_CLIENT_ID/SECRET__PRODUCTION); nothing is printed.
//   node scripts/env-pull.mjs --environment production -- node scripts/access-setup.mjs
// At launch: node scripts/env-pull.mjs --environment production -- node scripts/access-setup.mjs --remove
// Needs CLOUDFLARE_API_TOKEN__PRODUCTION with Access: Identity Providers, Apps, Policies and Service Tokens Write.
import { ensureToken, setSecret } from "./lib/bitwarden.mjs";

const ZONE = "batterseacougars.com";
const HOSTS = [ZONE, `www.${ZONE}`, `team.${ZONE}`];
const APP = "Cougars before launch";
const ADMINS = "Admins (production roster)";
const CI = "CI smoke tests";
const remove = process.argv.includes("--remove");

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, TEAM_ROSTER: roster } = process.env;
if (!token || !account)
  throw new Error("No Cloudflare token: run it through scripts/env-pull.mjs --environment production.");
async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/access${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const out = await res.json();
  if (!out.success) throw new Error(`Cloudflare ${method} access${path}: ${JSON.stringify(out.errors)}`);
  return out.result;
}
const named = async (path, name) => (await cf("GET", path)).find((x) => x.name === name);
/** Create it, or put the one with this name right. */
async function upsert(path, body) {
  const found = await named(path, body.name);
  return found ? cf("PUT", `${path}/${found.id}`, body) : cf("POST", path, body);
}

if (remove) {
  // Launch: the gate goes; the policies and the token go with it
  for (const [path, name] of [
    ["/apps", APP],
    ["/policies", ADMINS],
    ["/policies", CI],
    ["/service_tokens", CI],
  ]) {
    const found = await named(path, name);
    if (found) await cf("DELETE", `${path}/${found.id}`);
    console.log(`${name}: ${found ? "removed" : "not there"}.`);
  }
  console.log("Production is open to everyone. Remove CF_ACCESS_CLIENT_ID/SECRET__PRODUCTION from Secrets Manager.");
  process.exit(0);
}

// Who may pass is managed by hand in the dashboard (Access → Policies → this policy's Include emails): a run keeps the
// list as it is. Only a policy made for the first time starts from the admins in the roster that seeds production.
const existing = await named("/policies", ADMINS);
const emails = existing
  ? null
  : JSON.parse(roster ?? "[]")
      .filter((p) => p.email && (p.roles ?? []).includes("Admin"))
      .map((p) => p.email.trim().toLowerCase());
if (emails && !emails.length) throw new Error("No admins with an email in TEAM_ROSTER__PRODUCTION.");

// Signing in: an email, then a code sent to it
const otp =
  (await cf("GET", "/identity_providers")).find((i) => i.type === "onetimepin") ??
  (await cf("POST", "/identity_providers", { name: "One-time PIN", type: "onetimepin", config: {} }));

// CI's key. Its secret is only shown when it's made (or rotated), so a token whose secret isn't stored is rotated.
ensureToken();
let ci = await named("/service_tokens", CI);
if (!ci || !process.env.CF_ACCESS_CLIENT_SECRET) {
  const made = ci
    ? { ...(await cf("POST", `/service_tokens/${ci.id}/rotate`)), client_id: ci.client_id }
    : await cf("POST", "/service_tokens", { name: CI, duration: "8760h" });
  ci = ci ?? made;
  setSecret("CF_ACCESS_CLIENT_ID__PRODUCTION", made.client_id);
  setSecret("CF_ACCESS_CLIENT_SECRET__PRODUCTION", made.client_secret);
  console.log(`${CI}: service token ${ci === made ? "made" : "rotated"}; stored in Secrets Manager.`);
} else console.log(`${CI}: service token there, secret stored.`);

const admins =
  existing ??
  (await cf("POST", "/policies", {
    name: ADMINS,
    decision: "allow",
    include: emails.map((email) => ({ email: { email } })),
    session_duration: "720h",
  }));
const robots = await upsert("/policies", {
  name: CI,
  decision: "non_identity",
  include: [{ service_token: { token_id: ci.id } }],
});
await upsert("/apps", {
  name: APP,
  type: "self_hosted",
  domain: HOSTS[0],
  self_hosted_domains: HOSTS,
  session_duration: "720h",
  allowed_idps: [otp.id],
  auto_redirect_to_identity: true,
  app_launcher_visible: false,
  policies: [
    { id: robots.id, precedence: 1 },
    { id: admins.id, precedence: 2 },
  ],
});
console.log(
  `${HOSTS.join(", ")}: behind Access. ${existing ? `${ADMINS}: kept as set in the dashboard (${existing.include.length} emails).` : `${emails.length} admins may sign in with an emailed code.`}`,
);
