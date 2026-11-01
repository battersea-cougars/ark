#!/usr/bin/env node
// Post-deploy check: the right build is live and the key routes work.
//   node scripts/ci/smoke-test.mjs <base-url> <expected-version>
const [base, version] = process.argv.slice(2);
if (!base || !version) throw new Error("usage: smoke-test.mjs <base-url> <expected-version>");
// Before launch production is behind Cloudflare Access; CI gets past it with its service token (ADR 0010)
const { CF_ACCESS_CLIENT_ID: accessId, CF_ACCESS_CLIENT_SECRET: accessSecret } = process.env;
const access = accessId ? { "CF-Access-Client-Id": accessId, "CF-Access-Client-Secret": accessSecret } : {};

const checks = [
  [
    "home serves this build",
    async () => {
      const html = await (await get("/")).text();
      if (!html.includes(`content="cougars ${version}"`))
        throw new Error("version meta tag not found (old build still cached?)");
    },
  ],
  ["join page", () => get("/join/")],
  ["videos page", () => get("/videos/")],
  [
    // From both layers (ADR 0036): the asset layer's _headers for a built page, the middleware for a live one
    "security policy on built and live pages",
    async () => {
      for (const path of ["/", "/videos/"]) {
        const res = await get(path);
        if (!res.headers.get("content-security-policy")?.includes("script-src 'self'"))
          throw new Error(`${path} has no content security policy`);
        if (!res.headers.get("strict-transport-security")) throw new Error(`${path} has no HSTS`);
      }
    },
  ],
  ["sitemap", () => get("/sitemap-index.xml")],
  [
    "join API validates",
    async () => {
      const res = await fetch(new URL("/api/join", base), {
        method: "POST",
        // Same-origin, like a browser: Astro rejects form posts from other origins with 403
        headers: { ...access, Accept: "application/json", Origin: new URL(base).origin },
        body: new FormData(), // empty: must be rejected, so no row is written
      });
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    },
  ],
  // A real enquiry, marked with this deploy's smoke key: saved, both emails sent (to the sending account only, even in
  // production), then deleted (apps/web/src/lib/server/smoke.ts). Production only: skipped where there's no key (dev,
  // PR previews).
  ...(process.env.SMOKE_TOKEN
    ? [
        [
          "join form sends both emails",
          async () => {
            const form = new FormData();
            form.set("name", "Smoke Test");
            form.set("email", "smoke@example.com");
            form.set("message", `Deploy smoke test, ${version}`);
            form.set("source", "/join/");
            // The key was put on the Worker moments ago: until it has spread, the site refuses it (403), so try again
            let res;
            for (let tries = 0; tries < 7; tries++) {
              if (tries) await new Promise((done) => setTimeout(done, 5_000));
              res = await fetch(new URL("/api/join", base), {
                method: "POST",
                headers: {
                  ...access,
                  Accept: "application/json",
                  Origin: new URL(base).origin,
                  "X-Cougars-Smoke": process.env.SMOKE_TOKEN,
                },
                body: form,
              });
              if (res.status !== 403) break;
            }
            const body = await res.json().catch(() => ({}));
            if (res.status !== 200 || !body.smoke) throw new Error(`expected a smoke answer, got ${res.status}`);
            const { autoReply, club } = body.smoke;
            if (autoReply !== "sent" || club !== "sent") throw new Error(`auto-reply ${autoReply}, club email ${club}`);
          },
        ],
      ]
    : []),
];

async function get(path) {
  const res = await fetch(new URL(path, base), { redirect: "follow", headers: access });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res;
}

// New deployments can take a few seconds to propagate.
for (let attempt = 1; ; attempt++) {
  const failures = [];
  for (const [name, check] of checks) {
    try {
      await check();
      if (attempt === 1 || failures.length === 0) console.log(`✓ ${name}`);
    } catch (e) {
      failures.push(`✗ ${name}: ${e.message}`);
    }
  }
  if (!failures.length) break;
  if (attempt >= 6) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`retrying in 10s (${failures.length} failing)...`);
  await new Promise((r) => setTimeout(r, 10_000));
}
console.log(`Smoke test passed for ${base} (${version})`);
