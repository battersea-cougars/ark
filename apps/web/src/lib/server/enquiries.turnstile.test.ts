// The join form's Turnstile token is the enquiry form's only (ADR 0028): the one widget covers the website and the
// team app, so a token rendered for the team app's sign-in or Ask to join isn't spent here, nor this form's there.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ENQUIRY_ACTION, verifyTurnstile } from "@cougars/shared/turnstile";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the join form's Turnstile check", () => {
  it("its widget is rendered for the enquiry, and the server checks for that", () => {
    expect(read("../../pages/join/index.astro")).toContain(`action: "${ENQUIRY_ACTION}"`);
    expect(read("../../pages/api/join.ts")).toMatch(/verifyTurnstile\([^;]*action: ENQUIRY_ACTION/s);
  });

  it("is none of the team app's", () => {
    const team = read("../../../../team/worker/auth/auth.turnstile.ts").match(/HumanAction = ([^;]+);/)![1];
    expect(team).not.toContain(`"${ENQUIRY_ACTION}"`);
  });

  it("a token from the team app's Ask to join doesn't count as a person here", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetch = (async () => Response.json({ success: true, action: "join" })) as unknown as typeof globalThis.fetch;
    expect(await verifyTurnstile("tok", "secret", "1.2.3.4", { fetch, action: ENQUIRY_ACTION })).toBe(false);
  });
});
