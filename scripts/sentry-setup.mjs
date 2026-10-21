#!/usr/bin/env node
// Sentry for the club's errors and down alerts (ADR 0111), made through its API and safe to run again: it changes nothing
// that's already right.
//   node scripts/env-pull.mjs -- node scripts/sentry-setup.mjs            projects, alerts, cron monitor, DSNs into Secrets Manager
//   node scripts/env-pull.mjs -- node scripts/sentry-setup.mjs --uptime   also the uptime monitors (once /health is live)
// Needs SENTRY_AUTH_TOKEN (README#secrets). The organisation is the developer account's, in the EU region.
//
// Each app is a project. Three alerts email: a new issue in production, a new issue in dev, and a spike in production.
// The team Worker's hourly cron has a cron monitor. The DSNs go to Secrets Manager, not the repo; the deploy hands them
// to the apps.
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

// When the team Worker's crons stop (a broken deploy, a trigger lost): the hourly run checks in with Sentry, and a missed
// check-in opens an issue, so the alerts below email. One cron monitor is all the free plan has, so it's the hourly
// run, the one that charges dues and watches the free allowance; the five-minutely run stops with it if the Worker's
// crons stop at all. The Worker checks in by this slug (apps/team/worker/index.ts).
const CRON = {
  project: "team",
  name: "team hourly cron",
  slug: "team-hourly",
  type: "cron_job",
  config: { schedule_type: "crontab", schedule: "7 * * * *", checkin_margin: 10, max_runtime: 10, timezone: "UTC" },
};
const crons = await sentry("GET", `/organizations/${ORG}/monitors/`);
const cron = crons.find((m) => m.slug === CRON.slug);
if (cron) await sentry("PUT", `/organizations/${ORG}/monitors/${CRON.slug}/`, CRON);
else await sentry("POST", `/organizations/${ORG}/monitors/`, CRON);
console.log(`Cron monitor "${CRON.name}": ${cron ? "kept right" : "made"}.`);

// The alerts (Sentry "workflows"), each emailing the organisation's members. They listen to each project's issue
// stream, its uptime monitor and the cron monitor, whose failures open issues too.
const detectors = await sentry("GET", `/organizations/${ORG}/detectors/`);
const projectIds = new Set(
  (await sentry("GET", `/organizations/${ORG}/projects/`))
    .filter((p) => PROJECTS.some((w) => w.slug === p.slug))
    .map((p) => p.id),
);
const detectorIds = detectors
  .filter(
    (d) =>
      projectIds.has(d.projectId) &&
      ["issue_stream", "uptime_domain_failure", "monitor_check_in_failure"].includes(d.type),
  )
  .map((d) => d.id);

// By the event's tag, not the workflow's environment: Sentry only takes an environment it has already seen
const inEnvironment = (value) => ({
  type: "tagged_event",
  comparison: { key: "environment", match: "eq", value },
  conditionResult: true,
});
const email = {
  type: "email",
  integrationId: null,
  data: { fallthroughType: "ActiveMembers" },
  config: { targetType: "issue_owners", targetIdentifier: null },
};
const firstSeen = { type: "first_seen_event", comparison: true, conditionResult: true };
const ALERTS = [
  // A new issue: production's are what members hit; dev's are caught before a release takes them there
  { name: "New issue in production", trigger: [firstSeen], filter: [inEnvironment("production")], every: 30 },
  { name: "New issue in dev", trigger: [firstSeen], filter: [inEnvironment("dev")], every: 30 },
  // A spike: an issue seen more than 10 times in 5 minutes in production (a loop, or everyone hitting the same thing),
  // new or not. At most an email an hour per issue.
  {
    name: "Spike in production",
    trigger: [],
    filter: [
      inEnvironment("production"),
      {
        type: "event_frequency_count",
        comparison: {
          interval: "5m",
          value: 10,
          filters: [{ key: "environment", match: "eq", value: "production" }],
        },
        conditionResult: true,
      },
    ],
    every: 60,
  },
];
const workflows = await sentry("GET", `/organizations/${ORG}/workflows/`);
for (const alert of ALERTS) {
  const workflow = {
    name: alert.name,
    enabled: true,
    environment: null,
    // Minutes between two emails about one issue
    config: { frequency: alert.every },
    triggers: { logicType: "any-short", conditions: alert.trigger },
    actionFilters: [{ logicType: "all", conditions: alert.filter, actions: [email] }],
    detectorIds,
  };
  const ours = workflows.find((w) => w.name === alert.name);
  if (ours) await sentry("PUT", `/organizations/${ORG}/workflows/${ours.id}/`, workflow);
  else await sentry("POST", `/organizations/${ORG}/workflows/`, workflow);
  console.log(`Alert "${alert.name}": ${ours ? "kept right" : "made"}, on ${detectorIds.length} monitors.`);
}
