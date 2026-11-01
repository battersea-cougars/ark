#!/usr/bin/env node
// Add or update a secret in Bitwarden SM, in the project its name says
// (docs/adr/0002-secrets-in-bitwarden.md):
//   node scripts/secret-set.mjs CLOUDFLARE_API_TOKEN__DEV          (prompts, input hidden)
//   pbpaste | node scripts/secret-set.mjs SANITY_API_TOKEN         (reads stdin)
// NAME__PRODUCTION goes to `cougars`, anything else to `cougars-dev`. The value is never printed.
// Document the secret in docs/secrets.md in the same change.
import { ensureToken, projectFor, promptHidden, setSecret } from "./lib/bitwarden.mjs";

const key = process.argv[2];
if (!key || process.argv.length > 3) {
  console.error("Usage: secret-set.mjs NAME   (value from a hidden prompt or stdin)");
  process.exit(2);
}
const projectName = projectFor(key);
ensureToken();

const value = await readValue(`${key} (${projectName}): `);
if (!value) throw new Error("Empty value, nothing saved.");

const result = setSecret(key, value);
console.log(`${result} ${key} in ${projectName}.`);
if (result === "Created") console.log("Now document it in docs/secrets.md.");

async function readValue(prompt) {
  if (process.stdin.isTTY) return promptHidden(prompt);
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}
