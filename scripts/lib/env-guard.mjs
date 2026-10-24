// `.env` is for your own non-secret settings only (ADR 0002 point 5): this finds the lines in it that look like a
// secret, by name or by value (#149). It answers with line numbers and names, never a value. `npm run lint` and
// `npm run app` refuse to go on while there is one (scripts/env-check.mjs).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { documentedNames } from "./secret-names.mjs";

/** A name that's a secret's, or sounds like one. */
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_KEY|_KEY(__[A-Z]+)?$|BW_SESSION|ROSTER/;

/** Values that are secrets whatever they're called: the formats .gitleaks.toml knows, and a few more. */
const SECRET_VALUE = [
  /\b0\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{20,}:/, // Bitwarden access token
  /\bGOCSPX-[A-Za-z0-9_-]{20,}/, // Google client secret
  /\b1\/\/0[A-Za-z0-9_-]{40,}/, // Google refresh token
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\bsk[A-Za-z0-9]{150,}/, // Sanity token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // a private key
  /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/, // GitHub token
  /\bsntr[ysu]_[A-Za-z0-9+/=_.-]{20,}/, // Sentry token
  /"private_key"\s*:/, // a service account's JSON key
];

/**
 * The secret-looking lines of a .env file's text: [{ line, name, why }], `name` empty for a line that isn't
 * NAME=value. `secretNames` are the documented ones (docs/secrets.md), with or without their __ENV suffix.
 */
export function secretLines(text, secretNames = []) {
  const known = new Set(secretNames.map((n) => n.replace(/__[A-Z]+$/, "")));
  const found = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    const name = m?.[1] ?? "";
    const value = (m ? m[2] : line).replace(/^(["'])(.*)\1$/, "$2").trim();
    if (!value) return;
    const why = known.has(name.replace(/__[A-Z]+$/, ""))
      ? "a secret's name (docs/secrets.md)"
      : SECRET_NAME.test(name)
        ? "a secret-looking name"
        : SECRET_VALUE.some((p) => p.test(value))
          ? "a secret-looking value"
          : "";
    if (why) found.push({ line: i + 1, name, why });
  });
  return found;
}

/** Every `.env*` file at the top of each checkout (bar .env.example), as "<file> line N: NAME is …" sentences. */
export function envProblems(dirs) {
  const docs = join(import.meta.dirname, "..", "..", "docs", "secrets.md");
  const names = existsSync(docs) ? documentedNames(readFileSync(docs, "utf8")).map((d) => d.name) : [];
  const out = [];
  for (const dir of dirs)
    for (const file of readdirSync(dir).filter((f) => /^\.env(\..+)?$/.test(f) && f !== ".env.example"))
      for (const { line, name, why } of secretLines(readFileSync(join(dir, file), "utf8"), names))
        out.push(`${join(dir, file)} line ${line}: ${name || "a line"} is ${why}.`);
  return out;
}
