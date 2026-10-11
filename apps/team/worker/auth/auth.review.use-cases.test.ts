// Apple's App Review signs in to the store app (ADR 0108): our sign-in emails a code, and a reviewer can't read our
// email. So one review account, set by secrets in production only, takes a fixed code instead of an emailed one;
// everything else about signing in stays as it is (the browser's nonce, the tries, the limits).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "App Review", position: "F", rating: 50, email: "review@example.com" },
];
// A deployed server: no code comes back on screen, it's emailed
const LIVE = { host: "https://team.batterseacougars.com" };

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  Object.assign(w.env, { TEAM_ENV: undefined, APP_REVIEW_EMAIL: "Review@Example.com", APP_REVIEW_CODE: "246810" });
});

const signIn = async (b: ReturnType<typeof w.browser>, email: string, code: string) => {
  await b.call("POST", "/api/auth/start", { email }, LIVE);
  return (await b.call("POST", "/api/auth/verify", { code }, LIVE)).status;
};

describe("App Review signs in", () => {
  it("with the review account's fixed code, and nothing is emailed", async () => {
    expect(await signIn(w.browser(), "review@example.com", "246810")).toBe(200);
    expect(w.mails).toEqual([]);
  });

  it("the code is only the review account's: anyone else's sign-in is emailed as ever", async () => {
    expect(await signIn(w.browser(), "dana@example.com", "246810")).not.toBe(200);
    // (outside production it lands in the safe inbox)
    expect(w.mails.length).toBeGreaterThan(0);
  });

  it("only where it's set: without the secrets the review account is a member like any other", async () => {
    Object.assign(w.env, { APP_REVIEW_EMAIL: undefined, APP_REVIEW_CODE: undefined });
    expect(await signIn(w.browser(), "review@example.com", "246810")).not.toBe(200);
    expect(w.mails.length).toBeGreaterThan(0);
  });

  it("still needs the browser that asked: the code alone, somewhere else, gets nobody in", async () => {
    const asked = w.browser();
    await asked.call("POST", "/api/auth/start", { email: "review@example.com" }, LIVE);
    const elsewhere = w.browser();
    expect((await elsewhere.call("POST", "/api/auth/verify", { code: "246810" }, LIVE)).status).not.toBe(200);
  });
});
