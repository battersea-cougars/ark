import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/*/src/**/*.test.ts",
      "apps/team/worker/**/*.test.ts",
      "packages/shared/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
    environment: "node",
    setupFiles: ["packages/shared/testing/setup.ts"],
    // A test that hangs still fails, but a slow machine doesn't fail the club-sized ones (120 phones, a whole draft):
    // 1 to 2.5 s each on a quiet machine, past Vitest's 5 s when other suites run beside them (ADR 0121)
    testTimeout: 30_000,
  },
});
