import { describe, expect, it } from "vitest";
import { cspViolations } from "./csp-reports";

const SITE = "https://batterseacougars.com";

describe("a browser reports that the policy refused something", () => {
  it("is read from Chrome's Reporting API list", () => {
    const body = [
      {
        type: "csp-violation",
        url: `${SITE}/events/kumite/`,
        body: {
          documentURL: `${SITE}/events/kumite/?utm=x`,
          blockedURL: "https://evil.example/x.js?token=abc",
          effectiveDirective: "script-src-elem",
          sourceFile: `${SITE}/_astro/page.js`,
          lineNumber: 3,
          disposition: "enforce",
        },
      },
      { type: "deprecation", body: {} },
    ];
    expect(cspViolations(body, SITE)).toEqual([
      {
        directive: "script-src-elem",
        blocked: "evil.example/x.js",
        page: "/events/kumite/",
        source: "batterseacougars.com/_astro/page.js:3",
      },
    ]);
  });

  it("is read from the older report-uri shape (Firefox, Safari)", () => {
    const body = {
      "csp-report": {
        "document-uri": `${SITE}/`,
        "blocked-uri": "inline",
        "violated-directive": "script-src 'self'",
      },
    };
    expect(cspViolations(body, SITE)).toEqual([
      { directive: "script-src", blocked: "inline", page: "/", source: null },
    ]);
  });

  it("is ignored when it's about another site's page, or caused by a browser extension", () => {
    const report = (r: Record<string, unknown>) => ({ "csp-report": { "effective-directive": "script-src", ...r } });
    expect(cspViolations(report({ "document-uri": "https://elsewhere.example/" }), SITE)).toEqual([]);
    expect(
      cspViolations(report({ "document-uri": `${SITE}/`, "blocked-uri": "chrome-extension://abc/x.js" }), SITE),
    ).toEqual([]);
    expect(
      cspViolations(report({ "document-uri": `${SITE}/`, "source-file": "moz-extension://abc/content.js" }), SITE),
    ).toEqual([]);
  });

  it("is ignored when it isn't a report at all", () => {
    expect(cspViolations(null, SITE)).toEqual([]);
    expect(cspViolations("nonsense", SITE)).toEqual([]);
    expect(cspViolations({ "csp-report": { "document-uri": `${SITE}/` } }, SITE)).toEqual([]);
  });
});
