import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BreakerOpen, resetBreakers } from "./breaker";
import {
  CLUB_ADDRESS,
  clearTokenCache,
  mailPausedUntil,
  MailRefused,
  mime,
  safeMail,
  sendMail,
  type MailConfig,
} from "./email";

const gmail = { clientId: "id", clientSecret: "secret", refreshToken: "refresh" };
const enquiry = {
  to: [CLUB_ADDRESS],
  subject: "New enquiry: Zoë",
  text: "Hello",
  replyTo: "zoe@example.com",
};

const idToken = (email: string) =>
  `x.${btoa(JSON.stringify({ email })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.y`;

// The network boundary: Google's token endpoint and the Gmail API. Records every email that would leave.
function fakeGoogle({ account = "cougars.dev@gmail.com", tokenStatus = 200, sendStatus = 200 } = {}) {
  const sent: { to: string; subject: string; raw: string }[] = [];
  let tokenCalls = 0;
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      tokenCalls++;
      if (tokenStatus !== 200) return Response.json({ error: "invalid_grant" }, { status: tokenStatus });
      return Response.json({ access_token: "at", expires_in: 3600, id_token: idToken(account) });
    }
    if (sendStatus !== 200)
      return Response.json(
        { error: { message: "Too many", errors: [{ reason: "rateLimitExceeded" }] } },
        { status: sendStatus },
      );
    const raw = atob(JSON.parse(String(init?.body)).raw.replace(/-/g, "+").replace(/_/g, "/"));
    sent.push({ to: raw.match(/^To: (.*)$/m)![1], subject: raw.match(/^Subject: (.*)$/m)![1], raw });
    return Response.json({ id: `msg${sent.length}` });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, mock: fetch, sent, tokenCalls: () => tokenCalls };
}

const config = (extra: Partial<MailConfig> = {}): MailConfig => ({ siteEnv: "dev", gmail, ...extra });

describe("safeMail", () => {
  it("leaves production email alone", () => {
    expect(safeMail(enquiry, { siteEnv: "production", safeTo: "x@example.com" })).toBe(enquiry);
  });

  it("sends everything else to the safe address, saying who it was for", () => {
    for (const siteEnv of ["dev", "prod", "Production", "", undefined]) {
      const safe = safeMail({ ...enquiry, to: [CLUB_ADDRESS, "b@example.com"] }, { siteEnv, safeTo: "Me@Example.com" });
      expect(safe.to).toEqual(["me@example.com"]);
      expect(safe.subject).toBe(`[${siteEnv || "unset"}, for ${CLUB_ADDRESS}, b@example.com] New enquiry: Zoë`);
      expect(safe.headers).toEqual({ "X-Cougars-Original-To": `${CLUB_ADDRESS}, b@example.com` });
    }
  });

  it("lets through recipients on the dev allow list, as themselves; the rest still go to the safe address", () => {
    const allow = ["Dan@Example.com"];
    const one = safeMail({ ...enquiry, to: ["dan@example.com"] }, { siteEnv: "dev", safeTo: "me@example.com", allow });
    expect(one.to).toEqual(["dan@example.com"]);
    expect(one.subject).toBe("[dev, for dan@example.com] New enquiry: Zoë");
    const other = safeMail({ ...enquiry, to: ["b@example.com"] }, { siteEnv: "dev", safeTo: "me@example.com", allow });
    expect(other.to).toEqual(["me@example.com"]);
    // Mixed: the whole email goes to the safe address, so nobody off the list gets it
    const mixed = safeMail(
      { ...enquiry, to: ["dan@example.com", "b@example.com"] },
      { siteEnv: "dev", safeTo: "me@example.com", allow },
    );
    expect(mixed.to).toEqual(["me@example.com"]);
  });

  it("never lets the club's inbox through from the allow list", () => {
    const safe = safeMail(enquiry, { siteEnv: "dev", safeTo: "me@example.com", allow: [CLUB_ADDRESS] });
    expect(safe.to).toEqual(["me@example.com"]);
  });

  it("refuses without a safe address, or with the club's inbox as it", () => {
    expect(() => safeMail(enquiry, { siteEnv: "dev", safeTo: "" })).toThrow(MailRefused);
    expect(() => safeMail(enquiry, { siteEnv: "dev", safeTo: CLUB_ADDRESS.toUpperCase() })).toThrow(MailRefused);
  });
});

describe("sendMail", () => {
  beforeEach(() => {
    clearTokenCache();
    resetBreakers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("stops sending for a while once Gmail says the account is sending too much", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const google = fakeGoogle({ sendStatus: 429 });
    await expect(sendMail(enquiry, config(), { fetch: google.fetch })).rejects.toThrow("Gmail send: 429");
    expect(await mailPausedUntil()).toBeGreaterThan(Date.now());
    const calls = google.mock.mock.calls.length;
    await expect(sendMail(enquiry, config(), { fetch: google.fetch })).rejects.toBeInstanceOf(BreakerOpen);
    expect(google.mock.mock.calls.length).toBe(calls); // Google wasn't asked again
  });

  it("doesn't pause Gmail for a refusal of ours", async () => {
    const google = fakeGoogle();
    await expect(
      sendMail(enquiry, config({ siteEnv: "dev", safeTo: CLUB_ADDRESS }), { fetch: google.fetch }),
    ).rejects.toBeInstanceOf(MailRefused);
    expect(await mailPausedUntil()).toBeNull();
  });

  it("on dev, sends from the dev account to itself, never to the club", async () => {
    const google = fakeGoogle();
    const result = await sendMail(enquiry, config(), { fetch: google.fetch });
    expect(result).toEqual({ status: "sent", id: "msg1", to: ["cougars.dev@gmail.com"] });
    expect(google.sent).toHaveLength(1);
    expect(google.sent[0].to).toBe("cougars.dev@gmail.com");
    expect(google.sent[0].raw).toMatch(/^From: Battersea Cougars <cougars\.dev@gmail\.com>$/m);
    expect(google.sent[0].raw).toMatch(/^Reply-To: zoe@example\.com$/m);
  });

  it("uses MAIL_SAFE_TO over the account when it's set", async () => {
    const google = fakeGoogle();
    await sendMail(enquiry, config({ safeTo: "dev@example.com" }), { fetch: google.fetch });
    expect(google.sent[0].to).toBe("dev@example.com");
  });

  it("in production, sends to the real recipients", async () => {
    const google = fakeGoogle({ account: CLUB_ADDRESS });
    await sendMail(enquiry, config({ siteEnv: "production", safeTo: "dev@example.com" }), { fetch: google.fetch });
    expect(google.sent[0].to).toBe(CLUB_ADDRESS);
  });

  it("in production, the developer account sends as the club's address (its Gmail alias), so replies reach the club", async () => {
    const google = fakeGoogle();
    await sendMail({ ...enquiry, replyTo: undefined }, config({ siteEnv: "production" }), { fetch: google.fetch });
    expect(google.sent[0].raw).toMatch(/^From: Battersea Cougars <batterseahockey@gmail\.com>$/m);
  });

  it("outside production, refuses to send as the club's account", async () => {
    const google = fakeGoogle({ account: CLUB_ADDRESS });
    await expect(sendMail(enquiry, config({ safeTo: "dev@example.com" }), { fetch: google.fetch })).rejects.toThrow(
      MailRefused,
    );
    expect(google.sent).toHaveLength(0);
  });

  it("logs instead of sending without credentials, and never calls Google", async () => {
    const google = fakeGoogle();
    const result = await sendMail(enquiry, config({ gmail: null }), { fetch: google.fetch });
    expect(result.status).toBe("logged");
    expect(google.mock).not.toHaveBeenCalled();
  });

  it("reuses the access token until it's nearly expired", async () => {
    const google = fakeGoogle();
    let t = 0;
    const now = () => t;
    await sendMail(enquiry, config(), { fetch: google.fetch, now });
    await sendMail(enquiry, config(), { fetch: google.fetch, now });
    expect(google.tokenCalls()).toBe(1);
    t = 3600_000;
    await sendMail(enquiry, config(), { fetch: google.fetch, now });
    expect(google.tokenCalls()).toBe(2);
  });

  it("fails with Google's error code, never the token", async () => {
    const google = fakeGoogle({ tokenStatus: 400 });
    await expect(sendMail(enquiry, config(), { fetch: google.fetch })).rejects.toThrow(
      "Gmail token: 400 invalid_grant",
    );
  });
});

describe("mime", () => {
  it("encodes non-ASCII subjects and bodies", () => {
    const raw = mime({ ...enquiry, text: "Café ☕" }, "a@example.com");
    expect(raw).toMatch(/^Subject: =\?UTF-8\?B\?.+\?=$/m);
    const body = raw.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)))).toBe("Café ☕");
  });

  it("sends an HTML version beside the text one when there is one", () => {
    const raw = mime({ ...enquiry, text: "Plain", html: "<p>Café</p>" }, "a@example.com");
    expect(raw).toMatch(/^Content-Type: multipart\/alternative; boundary="=_cougars_alt"$/m);
    const parts = raw.split("--=_cougars_alt").slice(1, 3);
    const decoded = parts.map((p) => {
      const [head, body] = p.split("\r\n\r\n");
      return [
        head.trim(),
        new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, "")), (c) => c.charCodeAt(0))),
      ];
    });
    expect(decoded[0][0]).toMatch(/^Content-Type: text\/plain/);
    expect(decoded[0][1]).toBe("Plain");
    expect(decoded[1][0]).toMatch(/^Content-Type: text\/html/);
    expect(decoded[1][1]).toBe("<p>Café</p>");
    expect(raw.trimEnd().endsWith("--=_cougars_alt--")).toBe(true);
  });

  it("keeps form input from adding headers", () => {
    const raw = mime({ ...enquiry, subject: "Hi\r\nBcc: victim@example.com" }, "a@example.com");
    expect(raw).not.toMatch(/^Bcc:/m);
    expect(() => mime({ ...enquiry, replyTo: "x@example.com\r\nBcc: v@example.com" }, "a@example.com")).toThrow(
      MailRefused,
    );
  });
});
