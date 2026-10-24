import { describe, expect, it } from "vitest";
import { ribbonFor, withRibbon } from "./ribbon";

describe("ribbonFor", () => {
  it("shows nothing in production, on a machine or not", () => {
    expect(ribbonFor("production", false)).toBeUndefined();
    expect(ribbonFor("production", true)).toBeUndefined();
  });

  it("says DEV for a dev deploy", () => {
    expect(ribbonFor("dev", false)).toBe("DEV");
    expect(ribbonFor("dev", true)).toBe("DEV");
  });

  it("says LOCAL only with no environment and the app's own sign that it's on your machine", () => {
    expect(ribbonFor(undefined, true)).toBe("LOCAL");
    expect(ribbonFor("", true)).toBe("LOCAL");
    expect(ribbonFor(undefined, false)).toBeUndefined();
  });

  it("treats an environment it doesn't know as production", () => {
    expect(ribbonFor("staging", true)).toBeUndefined();
    expect(ribbonFor("Production", true)).toBeUndefined();
  });
});

describe("withRibbon", () => {
  it("puts the ribbon in front of the tab's title, and leaves production's alone", () => {
    expect(withRibbon("DEV", "Home")).toBe("[DEV] Home");
    expect(withRibbon(undefined, "Home")).toBe("Home");
  });
});
