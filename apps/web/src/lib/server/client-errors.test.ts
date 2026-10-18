import { describe, expect, it } from "vitest";
import { browserErrorEvent } from "./client-errors";

const SITE = "https://batterseacougars.com";
const report = (over: Record<string, unknown> = {}) => ({
  name: "TypeError",
  message: "Cannot read properties of null (reading 'value')",
  stack: [
    "TypeError: Cannot read properties of null (reading 'value')",
    `    at submit (${SITE}/_astro/index.CmQ2.js:1:2345)`,
    `    at HTMLFormElement.<anonymous> (${SITE}/_astro/index.CmQ2.js:1:99)`,
  ].join("\n"),
  page: "/join/",
  ...over,
});

describe("a visitor's browser hits an error in our scripts", () => {
  it("it becomes a Sentry event with the stack, oldest call first, for source maps to map", () => {
    expect(browserErrorEvent(report(), SITE)).toEqual({
      level: "error",
      platform: "javascript",
      tags: { source: "browser", page: "/join/" },
      request: { url: `${SITE}/join/` },
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Cannot read properties of null (reading 'value')",
            stacktrace: {
              frames: [
                {
                  function: "HTMLFormElement.<anonymous>",
                  abs_path: `${SITE}/_astro/index.CmQ2.js`,
                  filename: `${SITE}/_astro/index.CmQ2.js`,
                  lineno: 1,
                  colno: 99,
                  in_app: true,
                },
                {
                  function: "submit",
                  abs_path: `${SITE}/_astro/index.CmQ2.js`,
                  filename: `${SITE}/_astro/index.CmQ2.js`,
                  lineno: 1,
                  colno: 2345,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    });
  });

  it("reads Safari's and Firefox's way of writing a stack too", () => {
    const event = browserErrorEvent(
      report({ stack: `submit@${SITE}/_astro/index.CmQ2.js:1:2345\n@${SITE}/_astro/index.CmQ2.js:1:99` }),
      SITE,
    );
    expect(event?.exception.values[0].stacktrace.frames.map((f) => [f.function, f.colno])).toEqual([
      ["?", 99],
      ["submit", 2345],
    ]);
  });

  it("an error that isn't from our scripts (an extension, another site's script) is ignored", () => {
    expect(
      browserErrorEvent(report({ stack: "Error: x\n    at chrome-extension://abc/content.js:1:1" }), SITE),
    ).toBeNull();
  });

  it('a cross-origin "Script error." with no stack is ignored', () => {
    expect(browserErrorEvent(report({ message: "Script error.", stack: "" }), SITE)).toBeNull();
  });

  it("anything that isn't a report, or is too long, is ignored", () => {
    expect(browserErrorEvent("hello", SITE)).toBeNull();
    expect(browserErrorEvent({ message: 5 }, SITE)).toBeNull();
    expect(browserErrorEvent(report({ page: "https://elsewhere.example/" }), SITE)).toBeNull();
    expect(browserErrorEvent(report({ message: "x".repeat(2_000) }), SITE)?.exception.values[0].value).toHaveLength(
      500,
    );
  });

  it("an email address in the message never leaves", () => {
    expect(browserErrorEvent(report({ message: "Invalid: ada@club.org" }), SITE)?.exception.values[0].value).toBe(
      "Invalid: a…@club.org",
    );
  });
});
