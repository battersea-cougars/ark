#!/usr/bin/env node
// www.batterseacougars.com → batterseacougars.com, permanently, keeping the path and query (docs/setup.md). The site
// answers on both (target.mjs gives the Worker both names), so without this search engines see two copies of every
// page. A zone rule, not the Worker: built pages are served before the Worker runs. Every production deploy runs it
// (deploy.yml); safe to run again: it writes the same rule.
//   node scripts/env-pull.mjs --environment production -- node scripts/redirect-setup.mjs
// Needs CLOUDFLARE_API_TOKEN__PRODUCTION with Dynamic URL Redirects: Edit (Rules & Configuration) on batterseacougars.com.
const ZONE = "batterseacougars.com";

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
await cf("PUT", `/zones/${zone.id}/rulesets/phases/http_request_dynamic_redirect/entrypoint`, {
  rules: [
    {
      description: "www to the bare domain (scripts/redirect-setup.mjs)",
      expression: `(http.host eq "www.${ZONE}")`,
      action: "redirect",
      action_parameters: {
        from_value: {
          status_code: 301,
          target_url: { expression: `concat("https://${ZONE}", http.request.uri.path)` },
          preserve_query_string: true,
        },
      },
    },
  ],
});
console.log(`www.${ZONE} now redirects (301) to ${ZONE}, keeping the path and query.`);
