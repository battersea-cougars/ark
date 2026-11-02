#!/usr/bin/env node
// The domain's rate-limiting rule (#57, docs/accounts.md): Cloudflare blocks one address that sends far more requests
// than a person could, before they reach (and cost) a Worker. The free plan allows one rule, counted per address per
// data centre over 10 seconds, blocking for 10 seconds. Safe to run again: it writes the same rule.
//   node scripts/env-pull.mjs --environment production -- node scripts/ratelimit-setup.mjs
// Needs CLOUDFLARE_API_TOKEN__PRODUCTION with Zone WAF Write on batterseacougars.com.
const ZONE = "batterseacougars.com";
// A whole club on one Wi-Fi at the rink (one address): 30 phones opening the app at once, then live pages checking
// every few seconds, stays well under this
const REQUESTS_PER_10S = 150;

const { CLOUDFLARE_API_TOKEN: token } = process.env;
if (!token) throw new Error("No Cloudflare token: run it through scripts/env-pull.mjs --environment production.");
async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const out = await res.json();
  if (!out.success) throw new Error(`Cloudflare ${method} ${path}: ${JSON.stringify(out.errors)}`);
  return out.result;
}

const [zone] = await cf("GET", `/zones?name=${ZONE}`);
if (!zone) throw new Error(`No zone ${ZONE} on this account.`);
await cf("PUT", `/zones/${zone.id}/rulesets/phases/http_ratelimit/entrypoint`, {
  rules: [
    {
      description: "One address, far faster than a person (scripts/ratelimit-setup.mjs, #57)",
      expression: `(http.host wildcard "*${ZONE}")`,
      action: "block",
      ratelimit: {
        characteristics: ["cf.colo.id", "ip.src"],
        period: 10,
        requests_per_period: REQUESTS_PER_10S,
        mitigation_timeout: 10,
      },
    },
  ],
});
console.log(`${ZONE}: an address sending over ${REQUESTS_PER_10S} requests in 10 seconds is blocked for 10 seconds.`);
