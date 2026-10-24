// Made-up values only.
import { describe, expect, it } from "vitest";
import { secretLines } from "./env-guard.mjs";

describe("secretLines", () => {
  it("lets non-secret settings through", () => {
    expect(secretLines("# a note\nDEMO_CONTENT=true\nSANITY_PROJECT_ID=ah165efl\nEMPTY_TOKEN=\n")).toEqual([]);
  });

  it("refuses a documented secret's name, with or without its environment", () => {
    const text = "DEMO_CONTENT=true\nGMAIL_REFRESH_TOKEN__DEV=abc\nexport BACKUP_KEY='xyz'\n";
    expect(secretLines(text, ["GMAIL_REFRESH_TOKEN", "BACKUP_KEY__PRODUCTION"])).toEqual([
      { line: 2, name: "GMAIL_REFRESH_TOKEN__DEV", why: "a secret's name (docs/secrets.md)" },
      { line: 3, name: "BACKUP_KEY", why: "a secret's name (docs/secrets.md)" },
    ]);
  });

  it("refuses a secret-looking name or value, and never says the value", () => {
    const text = [
      "COUGARS_LOCAL_BW_TOKEN=0.made-up",
      "MY_PASSWORD=hunter2",
      `WHATEVER=GOCSPX-${"a".repeat(28)}`,
      "-----BEGIN PRIVATE KEY-----",
    ].join("\n");
    const found = secretLines(text);
    expect(found.map((f) => [f.line, f.why])).toEqual([
      [1, "a secret-looking name"],
      [2, "a secret-looking name"],
      [3, "a secret-looking value"],
      [4, "a secret-looking value"],
    ]);
    expect(JSON.stringify(found)).not.toMatch(/hunter2|GOCSPX|made-up/);
  });
});
