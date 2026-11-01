#!/usr/bin/env node
// Make an environment's Turnstile widget through Cloudflare's API (docs/secrets.md#turnstile, ADR 0028), or find the one that's
// there, and store its secret key straight in Secrets Manager: nobody sees it. Prints the site key (public), which goes
// in deploy.yml. Safe to run again: it changes nothing that's already right.
//   node scripts/env-pull.mjs -- node scripts/turnstile-setup.mjs dev
//   node scripts/env-pull.mjs --environment production -- node scripts/turnstile-setup.mjs production
// Needs that account's CLOUDFLARE_API_TOKEN with Turnstile Write.
import { ensureToken, setSecret } from "./lib/bitwarden.mjs";

// One widget per account; a hostname covers its subdomains: the website, its PR previews, and the team app's sign-in
// and Ask to join (team.cougars-dev.workers.dev, team.batterseacougars.com; #13), which use the same keys
const WIDGETS = {
  dev: { domains: ["cougars-dev.workers.dev"], secret: "TURNSTILE_SECRET_KEY" },
  production: { domains: ["batterseacougars.com"], secret: "TURNSTILE_SECRET_KEY__PRODUCTION" },
};
const NAME = "cougars";

const environment = process.argv[2];
const want = WIDGETS[environment];
if (!want) throw new Error(`Usage: turnstile-setup.mjs ${Object.keys(WIDGETS).join("|")}`);
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account) throw new Error("No Cloudflare token: run it through scripts/env-pull.mjs.");

const base = `https://api.cloudflare.com/client/v4/accounts/${account}/challenges/widgets`;
async function cf(method, path = "", body) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const out = await res.json();
  if (!out.success) throw new Error(`Cloudflare ${method} widgets${path}: ${JSON.stringify(out.errors)}`);
  return out.result;
}

const settings = { name: NAME, domains: want.domains, mode: "managed", clearance_level: "no_clearance" };
const found = (await cf("GET")).find((w) => w.name === NAME);
let widget;
if (!found) {
  widget = await cf("POST", "", settings);
  console.log(`Made the ${environment} widget "${NAME}" for ${want.domains.join(", ")}.`);
} else {
  const same = found.mode === settings.mode && found.domains.join() === want.domains.join();
  if (!same) await cf("PUT", `/${found.sitekey}`, settings);
  widget = await cf("GET", `/${found.sitekey}`);
  console.log(`The ${environment} widget "${NAME}" is there${same ? "" : "; its hostnames and mode are put right"}.`);
}

ensureToken();
console.log(`${setSecret(want.secret, widget.secret)} ${want.secret} in Secrets Manager.`);
console.log(`Site key (public, for deploy.yml): ${widget.sitekey}`);
