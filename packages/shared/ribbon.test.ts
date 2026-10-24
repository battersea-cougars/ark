import { describe, expect, it } from "vitest";
import { ribbonFor, ribbonHead, withRibbon } from "./ribbon";
import { checkoutFrom } from "./ribbon.checkout";

const review = { branch: "team/review", ownData: false };
const ownDb = { branch: "db/rebuild", ownData: true };

describe("ribbonFor", () => {
  it("shows nothing in production, on a machine or not, whatever the checkout", () => {
    expect(ribbonFor("production", false)).toBeUndefined();
    expect(ribbonFor("production", true, review)).toBeUndefined();
  });

  it("says DEV for a dev deploy, never with a checkout", () => {
    expect(ribbonFor("dev", false)).toEqual({ env: "DEV" });
    expect(ribbonFor("dev", true, ownDb)).toEqual({ env: "DEV" });
  });

  it("says LOCAL only with no environment and the app's own sign that it's on your machine", () => {
    expect(ribbonFor(undefined, true)).toEqual({ env: "LOCAL" });
    expect(ribbonFor("", true, null)).toEqual({ env: "LOCAL" });
    expect(ribbonFor(undefined, false, review)).toBeUndefined();
  });

  it("names the checkout's branch on LOCAL, and own data when it's on its own local D1", () => {
    expect(ribbonFor(undefined, true, review)).toEqual({ env: "LOCAL", branch: "team/review" });
    expect(ribbonFor(undefined, true, ownDb)).toEqual({ env: "LOCAL", branch: "db/rebuild", ownData: true });
  });

  it("treats an environment it doesn't know as production", () => {
    expect(ribbonFor("staging", true, review)).toBeUndefined();
    expect(ribbonFor("Production", true)).toBeUndefined();
  });
});

describe("the band and the tab", () => {
  it("heads the band LOCAL, with own data when it's the checkout's own D1", () => {
    expect(ribbonHead({ env: "LOCAL", branch: "team/review" })).toBe("LOCAL");
    expect(ribbonHead({ env: "LOCAL", branch: "db/rebuild", ownData: true })).toBe("LOCAL · own data");
    expect(ribbonHead({ env: "DEV" })).toBe("DEV");
  });

  it("puts the ribbon and branch in front of the tab's title, and leaves production's alone", () => {
    expect(withRibbon({ env: "LOCAL", branch: "team/review" }, "Home")).toBe("[LOCAL team/review] Home");
    expect(withRibbon({ env: "LOCAL", branch: "main" }, "Home")).toBe("[LOCAL main] Home");
    expect(withRibbon({ env: "LOCAL" }, "Home")).toBe("[LOCAL] Home");
    expect(withRibbon({ env: "DEV" }, "Home")).toBe("[DEV] Home");
    expect(withRibbon(undefined, "Home")).toBe("Home");
  });
});

describe("checkoutFrom", () => {
  it("is main's checkout on the shared data, and a worktree on it only with the show switch's COUGARS_LOCAL_STATE", () => {
    expect(checkoutFrom({ branch: "main", commit: "", linked: false }, undefined)).toEqual({
      branch: "main",
      ownData: false,
    });
    expect(checkoutFrom({ branch: "team/review", commit: "", linked: true }, "/src/apps/web/.wrangler/state")).toEqual(
      review,
    );
    expect(checkoutFrom({ branch: "db/rebuild", commit: "", linked: true }, undefined)).toEqual(ownDb);
  });

  it("names a detached checkout by its commit", () => {
    expect(checkoutFrom({ branch: "HEAD", commit: "03046b9", linked: true }, "x").branch).toBe("03046b9");
  });
});
