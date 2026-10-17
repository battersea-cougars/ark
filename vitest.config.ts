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
  },
});
