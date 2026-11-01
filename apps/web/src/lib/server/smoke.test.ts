import { describe, expect, it, vi } from "vitest";
import { outbox, safeMail, sendMail, type Mail } from "@cougars/shared/email";
import { isSmoke, smokeMailConfig, SMOKE_HEADER } from "./smoke";

const request = (token?: string) =>
  new Request("https://site.test/api/join", { method: "POST", headers: token ? { [SMOKE_HEADER]: token } : {} });

describe("the deploy's smoke test of the form", () => {
  it("is recognised only with the right token, and never when no token is set", () => {
    expect(isSmoke(request("s3cret-token"), "s3cret-token")).toBe(true);
    expect(isSmoke(request("s3cret-tokeN"), "s3cret-token")).toBe(false);
    expect(isSmoke(request("s3cret"), "s3cret-token")).toBe(false);
    expect(isSmoke(request(), "s3cret-token")).toBe(false);
    expect(isSmoke(request("anything"), undefined)).toBe(false);
  });

  it("sends its emails only to the sending account, even in production, naming the environment", () => {
    const mail: Mail = { to: ["club@example.com"], subject: "New enquiry: Smoke", text: "Hi" };
    const config = smokeMailConfig({
      siteEnv: "production",
      gmail: null,
      safeTo: "dev@example.com",
      club: "club@example.com",
    });
    const safe = safeMail(mail, { siteEnv: config.siteEnv, safeTo: "sender@example.com", club: config.club });
    expect(safe.to).toEqual(["sender@example.com"]);
    expect(safe.subject).toBe("[production smoke test, for club@example.com] New enquiry: Smoke");
  });

  it("without Gmail set up, logs to the safe place rather than the club", async () => {
    const seen: Mail[] = [];
    outbox.capture = (m) => void seen.push(m);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const config = smokeMailConfig({ siteEnv: "production", gmail: null, club: "club@example.com" });
    await sendMail({ to: ["club@example.com"], subject: "s", text: "t" }, config);
    expect(seen[0].to).not.toContain("club@example.com");
    outbox.capture = undefined;
    vi.restoreAllMocks();
  });
});
