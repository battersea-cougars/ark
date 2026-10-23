// Playwright for the team app's journeys (ADR 0124). Run through `npm run journeys` (journeys.mjs), which makes the
// fresh database, starts the app on its own port (JOURNEY_PORT) and stops it after.
import { defineConfig, devices } from "@playwright/test";

const out = process.env.JOURNEY_OUT ?? ".journeys";

export default defineConfig({
  testDir: ".",
  testMatch: "*.journey.ts",
  outputDir: `${out}/run`,
  // A journey is one story, its steps in order on one database: one at a time, never retried (a retry would meet the
  // database the first try left behind)
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["./journeys.report.ts", { summary: `${out}/summary.md` }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${process.env.JOURNEY_PORT}`,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
