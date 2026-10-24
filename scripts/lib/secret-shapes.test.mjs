// Made-up values of each shape: none is a real secret.
import { describe, expect, it } from "vitest";
import { fingerprint, shapeWarnings } from "./secret-shapes.mjs";
import { documentedNames } from "./secret-names.mjs";

const UUID = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
const PKCS8 = "-----BEGIN PRIVATE KEY-----\nTUFERVVQS0VZTUFERVVQS0VZ\nTUFERVVQ\n-----END PRIVATE KEY-----";

describe("shapeWarnings", () => {
  it("passes values of the known forms", () => {
    expect(shapeWarnings("GMAIL_WEB_CLIENT_SECRET", `GOCSPX-${"Ab3_-".repeat(5)}abc`)).toEqual([]);
    expect(shapeWarnings("BWS_ACCESS_TOKEN__DEV", `0.${UUID}.${"a".repeat(30)}:${"B".repeat(24)}==`)).toEqual([]);
    expect(shapeWarnings("APP_STORE_CONNECT_KEY", PKCS8)).toEqual([]);
    const account = { type: "service_account", client_email: "x@y.iam.gserviceaccount.com", private_key: PKCS8 };
    expect(shapeWarnings("FIREBASE_SERVICE_ACCOUNT", JSON.stringify(account))).toEqual([]);
    expect(shapeWarnings("BACKUP_KEY__PRODUCTION", "A".repeat(43) + "=")).toEqual([]);
  });

  it("warns about a value of the wrong form", () => {
    expect(shapeWarnings("GMAIL_WEB_CLIENT_SECRET", "abc")[0]).toMatch(/GOCSPX-/);
    expect(shapeWarnings("BWS_ACCESS_TOKEN__PRODUCTION", "abc")[0]).toMatch(/0\.<id>/);
    expect(shapeWarnings("GITHUB_APP_PRIVATE_KEY", PKCS8.replaceAll("PRIVATE KEY", "RSA PRIVATE KEY"))[0]).toMatch(
      /PKCS#8/,
    );
    expect(shapeWarnings("FIREBASE_SERVICE_ACCOUNT", '{"type":"user"}')[0]).toMatch(/service_account/);
  });

  it("warns about what pasting often brings along", () => {
    expect(shapeWarnings("SMOKE_TOKEN", "SMOKE_TOKEN=abc")).toContain("It starts with a NAME=: paste only the value.");
    expect(shapeWarnings("SMOKE_TOKEN", '"abc"')).toContain("It's in quotes: paste it without them.");
    expect(shapeWarnings("SMOKE_TOKEN", "ab c")[0]).toMatch(/space or a line break/);
    expect(shapeWarnings("SMOKE_TOKEN", "")).toEqual(["It's empty."]);
  });

  it("knows nothing of a secret with no known form", () => {
    expect(shapeWarnings("SMOKE_TOKEN", "anything-at-all")).toEqual([]);
  });
});

describe("fingerprint", () => {
  it("shows the length, the last 4 and 12 hex digits of SHA-256, and no last 4 of a short value", () => {
    expect(fingerprint("hello world, a value")).toEqual({ length: 20, last4: "alue", sha: "85d471bdb4ed" });
    expect(fingerprint("short").last4).toBe("");
  });
});

describe("documentedNames", () => {
  it("reads the Overview's Secrets Manager names, not settings, GitHub's, the vault's or never-stored ones", () => {
    const md = [
      "## Overview",
      "| Name | System | Env | Secret? | Used by |",
      "| --- | --- | --- | --- | --- |",
      "| [`BWS_ACCESS_TOKEN__DEV`](#x) | Bitwarden | dev | yes (in GitHub) | CI |",
      "| [`COUGARS_LOCAL_BW_TOKEN`](#x) | Bitwarden | both | yes (your vault) | You |",
      "| [`CLOUDFLARE_ACCOUNT_ID`](#x) (dev's) | Cloudflare | dev | no (`settings.mjs`) | Deploys |",
      "| [`GMAIL_REFRESH_TOKEN`](#x) | Google | both | yes | Email |",
      "| [`SENTRY_ISSUES_TOKEN`](#x) (not set yet) | Sentry | both | yes | Errors |",
      "| [`SMOKE_TOKEN`](#x) (never stored) | Us | both | yes | Smoke |",
      "## After",
      "| [`NOT_HERE`](#x) | Us | both | yes | Nothing |",
    ].join("\n");
    expect(documentedNames(md).map((d) => d.name)).toEqual(["GMAIL_REFRESH_TOKEN", "SENTRY_ISSUES_TOKEN"]);
  });
});
