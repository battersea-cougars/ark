#!/usr/bin/env node
// Point a built site at production or dev (docs/adr/0010-environments-and-deploys.md):
// make sure that environment's D1 database exists, then rewrite the config that
// `astro build` generated (apps/web/dist/server/wrangler.json, which `wrangler
// deploy` uses) with its worker name, database and SITE_ENV. The workers are `web` and `team` in both accounts, so
// dev is at web.<dev subdomain>.workers.dev and team.<dev subdomain>.workers.dev (ADR 0010). Production also gets its domain (from SITE_URL) as a
// Workers custom domain: the deploy creates the DNS records and certificate, on both the bare domain and www (the
// team app on team.<domain>).
//
//   node scripts/ci/target.mjs production|dev      (after `npm run build`)
//   node scripts/ci/target.mjs production|dev team (the team app, after `npm run build -w @cougars/team`: worker
//                                                   `team` on the same D1, ADR 0010)
//   node scripts/ci/target.mjs production|dev db   (no build: writes apps/web/dist/d1/wrangler.json, naming only the
//                                                   database and its migrations, for deploy.yml's `database` job and
//                                                   backup.yml)
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for that environment's account (scripts/env-pull.mjs).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { settingsFor } from "../lib/settings.mjs";

const TARGETS = {
  production: { db: "cougars" },
  dev: { db: "cougars-dev" },
};
const environment = process.argv[2];
const team = process.argv[3] === "team";
const dbOnly = process.argv[3] === "db";
const target = TARGETS[environment];
if (!target) throw new Error(`Usage: target.mjs ${Object.keys(TARGETS).join("|")} [team|db]`);
// The team app shares the site's database (ADR 0022), as its own worker
target.worker = team ? "team" : "web";

const cwd = new URL("../../apps/web/", import.meta.url);
const GENERATED = team
  ? new URL("../../apps/team/dist/cougars_team/wrangler.json", import.meta.url)
  : new URL("dist/server/wrangler.json", cwd);
const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", cwd });
const find = () => JSON.parse(wrangler("d1", "list", "--json")).find((d) => d.name === target.db);

let db = find();
if (!db) {
  console.log(`Creating D1 database ${target.db} (location: weur)...`);
  wrangler("d1", "create", target.db, "--location", "weur");
  db = find();
}
if (!db?.uuid) throw new Error(`D1 database ${target.db} not found after create`);

if (dbOnly) {
  const d1 = new URL("dist/d1/", cwd);
  mkdirSync(d1, { recursive: true });
  // After launch, `wrangler d1 migrations apply` reads the migrations from here (relative to this file, ADR 0050)
  const binding = {
    binding: "DB",
    database_name: target.db,
    database_id: db.uuid,
    migrations_dir: "../../../../db/migrations",
  };
  writeFileSync(
    new URL("wrangler.json", d1),
    JSON.stringify({ name: "d1", compatibility_date: "2026-10-01", d1_databases: [binding] }),
  );
  console.log(`Target ${environment}: D1 ${target.db} (${db.uuid})`);
  process.exit(0);
}

const config = JSON.parse(readFileSync(GENERATED, "utf8"));
config.name = target.worker;
config.vars = { ...config.vars, SITE_ENV: environment };
// The release Sentry files this Worker's errors under (ADR 0111): the deploy's build version, as the browser code has it
if (process.env.PUBLIC_BUILD_VERSION) config.vars.BUILD_VERSION = process.env.PUBLIC_BUILD_VERSION;
// The team Worker's plain settings (scripts/lib/settings.mjs, not secret): the account its Usage page reads the analytics
// of (worker/settings/usage.ts), the Apple team its app links name (worker/store/store.links.ts), where its errors go
if (team) {
  const { CLOUDFLARE_ACCOUNT_ID, APPLE_TEAM_ID, SENTRY_DSN_TEAM } = settingsFor(environment);
  Object.assign(config.vars, { CLOUDFLARE_ACCOUNT_ID, APPLE_TEAM_ID, SENTRY_DSN: SENTRY_DSN_TEAM });
}
if (environment === "production") {
  const host = URL.canParse(process.env.SITE_URL ?? "") ? new URL(process.env.SITE_URL).hostname : "";
  if (!host || host.endsWith(".workers.dev"))
    throw new Error(`SITE_URL isn't production's domain: "${process.env.SITE_URL}"`);
  const hosts = team ? [`team.${host}`] : [host, `www.${host}`];
  config.routes = hosts.map((pattern) => ({ pattern, custom_domain: true }));
  // Only the domain: a workers.dev address would get round Cloudflare Access before launch (ADR 0010)
  config.workers_dev = false;
  config.preview_urls = false;
}
config.d1_databases = config.d1_databases.map((d) => ({ ...d, database_name: target.db, database_id: db.uuid }));
writeFileSync(GENERATED, JSON.stringify(config));
console.log(
  `Target ${environment}: worker ${target.worker}, D1 ${target.db} (${db.uuid})` +
    (config.routes ? `, domains ${config.routes.map((r) => r.pattern).join(", ")}` : ""),
);
