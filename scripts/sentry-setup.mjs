#!/usr/bin/env node
// Sentry for the club's errors and down alerts (ADR 0111), made through its API and safe to run again: it changes nothing
// that's already right.
//   node scripts/env-pull.mjs -- node scripts/sentry-setup.mjs            projects, alerts, DSNs into Secrets Manager
//   node scripts/env-pull.mjs -- node scripts/sentry-setup.mjs --uptime   also the uptime monitors (once /health is live)
// Needs SENTRY_AUTH_TOKEN (README#secrets). The organisation is the developer account's, in the EU region.
//
// Each app is a project. The only alert is an email on a new issue in production: dev's errors are kept but tell
// nobody. The DSNs go to Secrets Manager, not the repo; the deploy hands them to the apps.
import { ensureToken, setSecret } from "./lib/bitwarden.mjs";

const ORG = "battersea-cougars";
const API = "https://de.sentry.io/api/0";
const SITE = "https://batterseacougars.com";

const PROJECTS = [
  { slug: "web", platform: "javascript-astro", dsnSecret: "SENTRY_DSN_WEB", health: `${SITE}/health` },
  {
    slug: "team",
    platform: "javascript-svelte",
    dsnSecret: "SENTRY_DSN_TEAM",
    health: `${SITE.replace("://", "://team.")}/api/health`,
  },
];
const ALERT = "New issue in production";

const token = process.env.SENTRY_AUTH_TOKEN;
if (!token) throw new Error("No SENTRY_AUTH_TOKEN: run it through scripts/env-pull.mjs.");
const uptime = process.argv.includes("--uptime");

async function sentry(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sentry ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const [team] = await sentry("GET", `/organizations/${ORG}/teams/`);
if (!team) throw new Error(`The organisation ${ORG} has no team to own the projects.`);

ensureToken();
const existing = await sentry("GET", `/organizations/${ORG}/projects/`);
for (const want of PROJECTS) {
  // Made without Sentry's default alert, which would email on every environment
  if (!existing.some((p) => p.slug === want.slug)) {
    await sentry("POST", `/teams/${ORG}/${team.slug}/projects/`, {
      name: want.slug,
      slug: want.slug,
      platform: want.platform,
      default_rules: false,
    });
    console.log(`Made the project ${want.slug}.`);
  } else console.log(`The project ${want.slug} is there.`);

  const [key] = await sentry("GET", `/projects/${ORG}/${want.slug}/keys/`);
  console.log(`  ${setSecret(want.dsnSecret, key.dsn.public)} ${want.dsnSecret} in Secrets Manager.`);

  if (!uptime) continue;
  // Down alerts: Sentry checks the health route every 10 minutes (about 290 requests a day for both, ADR 0003) and opens
  // an issue (so the alert above) when it fails
  const monitors = await sentry("GET", `/organizations/${ORG}/uptime/?project=${want.slug}`).catch(() => []);
  const monitor = {
    name: `${want.slug} is up`,
    url: want.health,
    intervalSeconds: 600,
    timeoutMs: 10_000,
    method: "GET",
    headers: [],
    body: null,
    environment: "production",
    traceSampling: false,
  };
  const there = monitors.find((m) => m.name === monitor.name);
  if (there) await sentry("PUT", `/projects/${ORG}/${want.slug}/uptime/${there.id}/`, monitor);
  else await sentry("POST", `/projects/${ORG}/${want.slug}/uptime/`, monitor);
  console.log(`  Uptime "${monitor.name}" on ${monitor.url}: ${there ? "kept right" : "made"}.`);
}

// The one alert (a Sentry "workflow"): a new issue in production, in either project, emails the organisation's member.
// It listens to each project's issue stream, and to its uptime monitor, whose failures open issues too.
const detectors = await sentry("GET", `/organizations/${ORG}/detectors/`);
const projectIds = new Set(
  (await sentry("GET", `/organizations/${ORG}/projects/`))
    .filter((p) => PROJECTS.some((w) => w.slug === p.slug))
    .map((p) => p.id),
);
const detectorIds = detectors
  .filter((d) => projectIds.has(d.projectId) && ["issue_stream", "uptime_domain_failure"].includes(d.type))
  .map((d) => d.id);
const workflow = {
  name: ALERT,
  enabled: true,
  // By the event's tag, not the workflow's environment: Sentry only takes an environment it has already seen
  environment: null,
  config: { frequency: 30 },
  triggers: {
    logicType: "any-short",
    conditions: [{ type: "first_seen_event", comparison: true, conditionResult: true }],
  },
  actionFilters: [
    {
      logicType: "all",
      conditions: [
        {
          type: "tagged_event",
          comparison: { key: "environment", match: "eq", value: "production" },
          conditionResult: true,
        },
      ],
      actions: [
        {
          type: "email",
          integrationId: null,
          data: { fallthroughType: "ActiveMembers" },
          config: { targetType: "issue_owners", targetIdentifier: null },
        },
      ],
    },
  ],
  detectorIds,
};
const workflows = await sentry("GET", `/organizations/${ORG}/workflows/`);
const ours = workflows.find((w) => w.name === ALERT);
if (ours) await sentry("PUT", `/organizations/${ORG}/workflows/${ours.id}/`, workflow);
else await sentry("POST", `/organizations/${ORG}/workflows/`, workflow);
console.log(`Alert "${ALERT}": ${ours ? "kept right" : "made"}, on ${detectorIds.length} monitors.`);
