#!/usr/bin/env node
// First-time setup, and the terminal fallback when no admin can sign in: let the website and the team app send email
// as the developer Gmail account, through the Gmail API (not
// SMTP, not a password). One token for both environments: production sends from the same account, as the club's
// address (its "Send mail as" alias), so a reset of the club account's password breaks nothing (ADR 0027).
//   node scripts/gmail-auth.mjs              sign in as the developer account -> GMAIL_REFRESH_TOKEN
// Needs the Web client, GMAIL_WEB_CLIENT_ID and GMAIL_WEB_CLIENT_SECRET, in Bitwarden, with http://localhost:4590/
// among its authorised redirect URIs (docs/secrets.md#gmail): the Workers refresh the token with that client, the only
// one there is. Opens Google's consent page, catches the answer on http://localhost:4590, swaps it for a refresh token
// (send-only), and saves that straight to Bitwarden. Nothing is printed or written to disk. When Google cancels the token (a password change), an admin
// reconnects it in the team app instead (Settings → Email, ADR 0027), which needs no deploy; re-running this needs one,
// and only counts in an environment with no reconnected token in D1.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { ensureToken, loadSecrets, setSecret } from "./lib/bitwarden.mjs";
import { SANITY_PROJECTS } from "../packages/shared/sanity.ts";

// The club's own inbox (each Studio's Club → Contact email): no token is ever made for it.
async function clubInboxes() {
  const query = encodeURIComponent(`*[_id == "club"][0].contactEmail`);
  const found = await Promise.all(
    Object.values(SANITY_PROJECTS).map(({ projectId, dataset }) =>
      fetch(`https://${projectId}.apicdn.sanity.io/v2025-01-01/data/query/${dataset}?query=${query}`)
        .then((r) => r.json())
        .then((b) => (typeof b.result === "string" ? b.result.trim().toLowerCase() : null))
        .catch(() => null),
    ),
  );
  return new Set(found.filter(Boolean));
}
const PORT = 4590;
const REDIRECT = `http://localhost:${PORT}/`;
// Send only (can't read mail), plus the account's address so we can check who signed in.
const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"];

if (process.argv.length > 2) {
  console.error("Usage: gmail-auth.mjs");
  process.exit(2);
}
const key = "GMAIL_REFRESH_TOKEN";

ensureToken();
const { GMAIL_WEB_CLIENT_ID: clientId, GMAIL_WEB_CLIENT_SECRET: clientSecret } = loadSecrets("dev");
if (!clientId || !clientSecret) {
  throw new Error("GMAIL_WEB_CLIENT_ID and GMAIL_WEB_CLIENT_SECRET aren't in Bitwarden yet (docs/secrets.md#gmail).");
}

const state = randomBytes(16).toString("hex");
const verifier = randomBytes(32).toString("base64url");
const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
consent.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPES.join(" "),
  access_type: "offline", // a refresh token, not just an hour's access
  prompt: "consent select_account", // always a refresh token, and always ask which account
  state,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
}).toString();

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", REDIRECT);
    if (url.pathname !== "/") return void res.writeHead(404).end();
    const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(ok ? "Done. You can close this tab and go back to the terminal." : "That didn't work. See the terminal.");
    server.close();
    if (ok) resolve(url.searchParams.get("code"));
    else reject(new Error(`Google said: ${url.searchParams.get("error") ?? "state mismatch"}`));
  });
  server.listen(PORT, () => {
    console.log(`\nSign in as the developer Gmail account (not the club's):\n\n${consent}\n`);
    console.log('Google warns the app isn\'t verified: choose "Advanced", then "Go to … (unsafe)", then Continue.');
    console.log(
      `If Google says redirect_uri_mismatch, add ${REDIRECT} to the Web client's Authorised redirect URIs ` +
        "(Google Auth Platform → Clients → GMAIL_WEB_CLIENT_ID), wait a few minutes, and run this again.\n",
    );
  });
});

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT,
    grant_type: "authorization_code",
    code_verifier: verifier,
  }),
});
const token = await res.json();
if (!res.ok) throw new Error(`Token exchange failed: ${token.error ?? res.status} ${token.error_description ?? ""}`);
if (!token.refresh_token) throw new Error("Google sent no refresh token. Run it again.");
if (!token.scope?.split(" ").includes(SCOPES[0])) {
  throw new Error('Sending wasn\'t allowed. Run it again and tick "Send email on your behalf".');
}

// Who signed in (the id_token comes straight from Google over TLS, so reading it without verifying is fine here).
const email = JSON.parse(Buffer.from(token.id_token.split(".")[1], "base64url").toString()).email?.toLowerCase();
if ((await clubInboxes()).has(email.toLowerCase())) {
  throw new Error(
    `That's the club's account: the apps send from the developer account, never the club's. Nothing saved.`,
  );
}

console.log(`${setSecret(key, token.refresh_token)} ${key}: ${email} can now send through the Gmail API.`);
