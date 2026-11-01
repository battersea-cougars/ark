#!/usr/bin/env node
// Break glass (ADR 0023, README "Locked out"): one sign-in code for an admin, for when Gmail is down, every admin has
// lost their passkeys and none is signed in. Never a web route: it takes the club's Bitwarden (for the environment's
// Cloudflare token) and writes to that environment's D1 over Cloudflare's API. The code is printed here, on this
// terminal, and nowhere else; the admin types their email and the code on the team app's usual sign-in page within
// 15 minutes. It's on the record, and every admin is told when it's used.
//
//   npm run admin:break-glass -- <admin's email>                     (dev)
//   npm run admin:break-glass -- <admin's email> --env production    (asks you to type the email again)
//   npm run admin:break-glass -- <admin's email> --env local         (your own D1: COUGARS_LOCAL_STATE, or main's)
import { execFileSync } from "node:child_process";
import { hostname, userInfo } from "node:os";
import { createInterface } from "node:readline/promises";
import { ensureToken, loadSecrets } from "./lib/bitwarden.mjs";
import { settingsFor } from "./lib/settings.mjs";
import { issueBreakGlass } from "./lib/break-glass.mjs";
import { remoteD1 } from "./lib/d1-api.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const environment = opt("--env", "dev");
const email = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--env");
if (!email || !["dev", "production", "local"].includes(environment)) {
  console.error("Usage: npm run admin:break-glass -- <admin's email> [--env dev|production|local]");
  process.exit(2);
}

/** Who ran it, for the record: this machine's user, and their git email when there is one. */
function operator() {
  let git = "";
  try {
    git = execFileSync("git", ["config", "user.email"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // No git here: the machine's user will do
  }
  return [`${userInfo().username}@${hostname()}`, git].filter(Boolean).join(" ");
}

/** Your own machine's D1, through wrangler (no parameters there, so each is written in as an SQL literal). */
function localQuery() {
  const web = new URL("../apps/web/", import.meta.url);
  const persist = process.env.COUGARS_LOCAL_STATE ? ["--persist-to", process.env.COUGARS_LOCAL_STATE] : [];
  const literal = (v) =>
    v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  return async (sql, params = []) => {
    let i = 0;
    const command = sql.replace(/\?/g, () => literal(params[i++]));
    const out = execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "DB", "--local", ...persist, "--json", "--command", command],
      {
        cwd: web,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    return JSON.parse(out)[0]?.results ?? [];
  };
}

async function remoteQuery() {
  // The environment's Cloudflare token, from Bitwarden into this process only (never printed or written), and its
  // account's ID, a committed setting
  ensureToken();
  const found = { ...loadSecrets(environment), ...settingsFor(environment) };
  for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (!found[key]) throw new Error(`${key} isn't set for ${environment} (docs/secrets.md#cloudflare).`);
    process.env[key] = found[key];
  }
  return remoteD1(environment);
}

if (environment === "production") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const again = await rl.question(`Production: a break-glass code for ${email}. Type the email again to go on: `);
  rl.close();
  if (again.trim().toLowerCase() !== email.trim().toLowerCase()) {
    console.error("Not the same email: nothing was made.");
    process.exit(1);
  }
}

try {
  const query = environment === "local" ? localQuery() : await remoteQuery();
  const { code, name, expiresAt } = await issueBreakGlass(query, { email, by: operator() });
  const until = new Date(expiresAt).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
  console.log(`\nBreak-glass code for ${name} (${environment}): ${code.slice(0, 3)} ${code.slice(3)}`);
  console.log(`It works once, until ${until} (London). On the team app's sign-in page: their email, then this code.`);
  console.log("Every admin is told when it's used. Any earlier break-glass code for them is called off.\n");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
