// Playwright for the team app's journeys (ADR 0031): `npm run journeys`, `npx playwright test` and VS Code's Testing
// panel (the Playwright Test extension finds this file by its name) all run them through it. The global setup makes
// the journeys' own fresh database and starts the team app on it on a free port (JOURNEY_PORT), so a run is safe in
// any checkout, main's too, and its teardown stops the app.
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const out = process.env.JOURNEY_OUT ?? join(import.meta.dirname, ".journeys");
const support = "./apps/team/tests/journeys/support";

export default defineConfig({
  testDir: "apps/team/tests/journeys",
  testMatch: "*.journey.test.ts",
  outputDir: `${out}/run`,
  globalSetup: `${support}/journeys.setup.mjs`,
  // A journey is one story, its steps in order on one database: one at a time, never retried (a retry would meet the
  // database the first try left behind)
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], [`${support}/journeys.report.ts`, { summary: `${out}/summary.md` }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${process.env.JOURNEY_PORT}`,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
