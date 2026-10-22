// Bitwarden Secrets Manager is the single source of truth for secrets
// (docs/adr/0002-secrets-in-bitwarden.md). Every secret is documented in
// docs/secrets.md.
//
// Naming rule (from gwenda-hackney/ark): NAME applies to both environments;
// NAME__PRODUCTION / NAME__DEV override it for that one. Code only ever reads NAME.
// Production values live in the `cougars` project, dev and shared values in
// `cougars-dev`; the dev CI token can't read `cougars` at all.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { parseEnv } from "node:util";

export const ENVIRONMENTS = ["production", "dev"];

// Secrets Manager projects (docs/adr/0002-secrets-in-bitwarden.md), shared by every app.
export const PROJECTS = { production: "cougars", dev: "cougars-dev" };

/** The project a secret belongs in: NAME__PRODUCTION in `cougars`, everything else in `cougars-dev`. */
export function projectFor(key) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`"${key}" isn't a secret name: use UPPER_SNAKE_CASE.`);
  const env = key.match(/__([A-Z]+)$/)?.[1];
  if (env && !ENVIRONMENTS.includes(env.toLowerCase())) {
    throw new Error(`"${key}" ends in __${env}: use __PRODUCTION, __DEV or no suffix.`);
  }
  return env === "PRODUCTION" ? PROJECTS.production : PROJECTS.dev;
}

// On your machine the Secrets Manager token lives only in your vault, in the secure note `cougars/.env.local`
// (a line COUGARS_LOCAL_BW_TOKEN=...). `bw-unlock` (.devcontainer/bw-session.bashrc, as in Ark) is the login:
// it keeps the session in RAM for the container's life, and every script reads it from there.
const VAULT_NOTE = "cougars/.env.local";
const sessionFile = () =>
  process.env.BW_SESSION_FILE || join("/dev/shm", `ark-secrets-${process.getuid?.() ?? "user"}`, "bw-session");

function vaultToken() {
  if (!process.env.BW_SESSION) {
    try {
      process.env.BW_SESSION = readFileSync(sessionFile(), "utf8").trim();
    } catch {
      return ""; // never unlocked in this container
    }
  }
  const res = spawnSync("bw", ["get", "item", VAULT_NOTE, "--nointeraction"], { encoding: "utf8" });
  if (res.status !== 0) return "";
  const notes = parseEnv(JSON.parse(res.stdout).notes ?? "");
  return notes.COUGARS_LOCAL_BW_TOKEN?.trim() ?? "";
}

/** At a terminal with the vault locked, ask for the master password once and save the session like bw-unlock. */
function unlock() {
  if (process.env.CI || !process.stdin.isTTY) return false;
  console.error("Bitwarden vault is locked. Unlock it to load secrets (same as bw-unlock).");
  const res = spawnSync("bw", ["unlock", "--raw"], { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
  const session = res.status === 0 ? res.stdout.trim() : "";
  if (!session) return false;
  process.env.BW_SESSION = session;
  mkdirSync(dirname(sessionFile()), { recursive: true, mode: 0o700 });
  writeFileSync(sessionFile(), `${session}\n`, { mode: 0o600 });
  return true;
}

/** Make sure there's a Secrets Manager token: BWS_ACCESS_TOKEN in CI, else from your unlocked vault. */
export function ensureToken() {
  if (process.env.BWS_ACCESS_TOKEN || process.env.COUGARS_LOCAL_BW_TOKEN) return;
  let token = vaultToken();
  if (!token && unlock()) token = vaultToken();
  if (!token) {
    throw new Error(
      `No Bitwarden token. Run bw-unlock, and check your vault has the secure note ${VAULT_NOTE} ` +
        "with a line COUGARS_LOCAL_BW_TOKEN=... (docs/secrets.md#bitwarden-tokens).",
    );
  }
  process.env.COUGARS_LOCAL_BW_TOKEN = token;
}

/** Ask for a value on the terminal without echoing it. */
export async function promptHidden(label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write(label);
  rl._writeToOutput = () => {}; // hide what's typed or pasted
  const line = await new Promise((resolve) => rl.once("line", resolve));
  rl.close();
  process.stdout.write("\n");
  return line.trim();
}

/**
 * Run bws and parse its JSON output.
 * Our organisation is on the EU server, the default when BWS_SERVER_URL is empty.
 */
export function bws(args) {
  const token = process.env.BWS_ACCESS_TOKEN || process.env.COUGARS_LOCAL_BW_TOKEN;
  if (!token) throw new Error("No Bitwarden token: call ensureToken() first.");
  const env = { ...process.env, BWS_ACCESS_TOKEN: token };
  env.BWS_SERVER_URL ||= "https://vault.bitwarden.eu";
  // Options before a `--`: after it everything is a plain value, even one that starts with dashes (a PEM key)
  const end = args.indexOf("--");
  const argv =
    end < 0 ? [...args, "--output", "json"] : [...args.slice(0, end), "--output", "json", ...args.slice(end)];
  const res = spawnSync("bws", argv, { encoding: "utf8", env });
  if (res.error) throw new Error(`Could not run bws: ${res.error.message}. Is the Bitwarden CLI installed?`);
  if (res.status !== 0) throw new Error(`bws failed: ${res.stderr.trim().split("\n")[0]}`);
  return JSON.parse(res.stdout);
}

/** Create or update a secret in the project its name says. Returns "Created" or "Updated". Never prints the value. */
export function setSecret(key, value) {
  const projectName = projectFor(key);
  const project = bws(["project", "list"]).find((p) => p.name.trim().toLowerCase() === projectName);
  if (!project) {
    throw new Error(`This token can't see the project "${projectName}". Check the machine account's project access.`);
  }
  const existing = bws(["secret", "list", project.id]).find((s) => s.key === key);
  if (existing) bws(["secret", "edit", existing.id, `--value=${value}`]);
  else bws(["secret", "create", "--", key, value, project.id]);
  return existing ? "Updated" : "Created";
}

export function loadSecrets(environment) {
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`Unknown environment "${environment}": use ${ENVIRONMENTS.join(" or ")}.`);
  }
  const suffix = `__${environment.toUpperCase()}`;
  const base = {};
  const overrides = {};
  for (const { key, value } of bws(["secret", "list"])) {
    if (key.endsWith(suffix)) overrides[key.slice(0, -suffix.length)] = value;
    else if (!/__[A-Z]+$/.test(key)) base[key] = value;
  }
  if (environment === "production" && !Object.keys(overrides).length) {
    throw new Error("This token can't read production secrets (no NAME__PRODUCTION values visible).");
  }
  return { ...base, ...overrides };
}
