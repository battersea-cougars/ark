#!/usr/bin/env node
// Sign in to the team app on your own machine without a code (ADR 0023), for tests, scripts and agents driving a
// headless browser. Writes a Playwright storage state, so a browser opens already signed in, and prints the cookie
// for curl. Only your own dev server answers it (TEAM_ENV "local", a private address); a deployed one says 404.
//
//   node scripts/dev-sign-in.mjs                          the first admin
//   node scripts/dev-sign-in.mjs reg@example.com          any active member
//   node scripts/dev-sign-in.mjs --url http://localhost:4510 --out .auth/team.json
//   node scripts/dev-sign-in.mjs --port 43273             a checkout's own team app (npm run app -- --private)
//
// Then, in Playwright: browser.newContext({ storageState: ".auth/team.json" }). Every run is a new session of its
// own, so it never touches the one in your browser.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const port = flag("--port");
const url = new URL(flag("--url", `http://localhost:${port ?? 4510}`));
const out = flag("--out", ".auth/team.json");
const email = args[0];

const res = await fetch(new URL("/api/auth/dev", url), {
  method: "POST",
  // The API takes a change only from its own page (api/api.http.ts sameOrigin)
  headers: { "content-type": "application/json", origin: url.origin },
  body: JSON.stringify(email ? { email } : {}),
}).catch((e) => {
  console.error(`Couldn't reach ${url.origin}: is the team app running (npm run app status)? ${e.message}`);
  process.exit(1);
});
if (!res.ok) {
  const why = res.status === 404 ? "not a local dev server, or no active member with that email" : res.statusText;
  console.error(`Sign-in refused (${res.status}): ${why}. ${await res.text()}`);
  process.exit(1);
}

const cookies = res.headers.getSetCookie().map((c) => {
  const [pair, ...attrs] = c.split(/;\s*/);
  const [name, ...rest] = pair.split("=");
  const attr = (k) => attrs.find((a) => a.toLowerCase().startsWith(k.toLowerCase()));
  const maxAge = Number(attr("Max-Age=")?.split("=")[1] ?? 0);
  return {
    name,
    value: rest.join("="),
    domain: url.hostname,
    path: "/",
    expires: maxAge > 0 ? Math.floor(Date.now() / 1000) + maxAge : -1,
    httpOnly: Boolean(attr("HttpOnly")),
    secure: Boolean(attr("Secure")),
    sameSite: "Lax",
  };
});
const session = cookies.filter((c) => c.value && c.expires !== -1 && c.expires > Date.now() / 1000);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ cookies: session, origins: [] }, null, 2));
const { memberId } = await res.json();
console.log(`Signed in as member ${memberId} on ${url.origin}.`);
console.log(`Playwright storage state: ${out}`);
console.log(`curl: -H 'cookie: ${session.map((c) => `${c.name}=${c.value}`).join("; ")}'`);
