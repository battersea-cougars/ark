// What `npm run merge:check` runs for a branch (ADR 0115): docs alone get a format check; code gets lint, knip, the tests,
// and the checks and builds of every app the diff can reach.
import { describe, expect, it } from "vitest";
import { plan } from "./merge-check.mjs";

describe("merge:check's tier", () => {
  it("is nothing for a branch that is main", () => {
    expect(plan([])).toEqual({ tier: "none", steps: [] });
  });

  it("is a format check for docs alone, the ADRs and READMEs included", () => {
    expect(plan(["docs/adr/0115-worktrees-and-the-show-switch.md", "README.md", "db/README.md"]).tier).toBe("docs");
  });

  it("is everything for a change outside the apps: shared code, scripts, the schema, root config", () => {
    const every = ["lint", "knip", "test", "checkWeb", "checkTeam", "buildWeb", "buildTeam", "buildStudio"];
    for (const file of [
      "packages/shared/d1.ts",
      "scripts/app.mjs",
      "db/schema.sql",
      "package.json",
      ".github/workflows/pr.yml",
    ])
      expect(plan([file]), file).toEqual({ tier: "full", steps: every });
  });

  it("checks the team app too when the website changes, as the team app imports it", () => {
    expect(plan(["apps/web/src/lib/server/whats-on.ts"])).toEqual({
      tier: "web",
      steps: ["lint", "knip", "test", "checkWeb", "checkTeam", "buildWeb", "buildTeam"],
    });
  });

  it("checks only the app changed when nothing imports it", () => {
    expect(plan(["apps/team/src/app/App.svelte", "docs/testing.md"]).steps).toEqual([
      "lint",
      "knip",
      "test",
      "checkTeam",
      "buildTeam",
    ]);
    expect(plan(["apps/studio/schemaTypes/settings.ts"]).steps).toEqual(["lint", "knip", "test", "buildStudio"]);
    expect(plan(["apps/studio/README.md"]).steps).toEqual(["lint", "knip", "test", "buildStudio"]);
  });
});
