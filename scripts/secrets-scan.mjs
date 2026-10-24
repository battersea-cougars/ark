// Secrets in the git history (#104, ADR 0002): gitleaks over the commits, with what it finds redacted, so a scan never
// prints a secret it found. Rules and the known non-secrets it lets through, each with why: .gitleaks.toml.
//
//   npm run secrets:scan                  every commit on this branch, from the first
//   npm run secrets:scan -- --since main  only the commits since main (what a push or a PR adds)
//
// The gitleaks binary is a pinned release, checked against its published checksum before it runs (as the Bitwarden
// CLI is, .github/actions/secrets), and kept in node_modules/.cache. Not gitleaks-action: it needs a licence key for
// a repo owned by an organisation. Exits non-zero on a find: each one's rule, file, line and commit, never its value.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "8.30.1";
// From gitleaks_8.30.1_checksums.txt; a new version means new sums here
const SHA256 = {
  "linux-x64": "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
  "linux-arm64": "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
  "darwin-x64": "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
  "darwin-arm64": "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
};

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const since = process.argv.includes("--since") ? process.argv[process.argv.indexOf("--since") + 1] : null;
if (process.argv.includes("--since") && !since) throw new Error("Usage: secrets-scan.mjs [--since <commit>]");

/** The pinned gitleaks, fetched and checked the first time. */
async function gitleaks() {
  const platform = `${process.platform}-${process.arch}`;
  const sum = SHA256[platform];
  if (!sum) throw new Error(`No pinned gitleaks for ${platform}: add its checksum to scripts/secrets-scan.mjs`);
  const dir = join(root, "node_modules", ".cache", `gitleaks-${VERSION}`);
  const binary = join(dir, "gitleaks");
  if (existsSync(binary)) return binary;

  const asset = `gitleaks_${VERSION}_${platform.replace("-", "_")}.tar.gz`;
  const res = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${asset}`);
  if (!res.ok) throw new Error(`Couldn't download ${asset}: ${res.status}`);
  const archive = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(archive).digest("hex");
  if (got !== sum) throw new Error(`${asset} doesn't match its pinned checksum: not running it`);
  mkdirSync(dir, { recursive: true });
  const tarball = join(dir, asset);
  writeFileSync(tarball, archive);
  execFileSync("tar", ["-xzf", tarball, "-C", dir, "gitleaks"]);
  rmSync(tarball);
  return binary;
}

const args = ["git", "--config", join(root, ".gitleaks.toml"), "--redact", "--no-banner", "--verbose"];
if (since) args.push("--log-opts", `${since}..HEAD`);
args.push(root);
const scan = spawnSync(await gitleaks(), args, { stdio: "inherit" });
process.exit(scan.status ?? 1);
