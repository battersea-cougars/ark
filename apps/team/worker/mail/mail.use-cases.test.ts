// The club's email, looked after from the app (#101, ADR 0027): Google cancels the sending account's token when its
// password changes, its access is removed or it goes unused for 6 months, and then every email fails, sign-in codes
// too. An admin sees it on Home and in Settings → Email, and reconnects it there: Google's consent in the browser, back
// to the app, which keeps the new token sealed in D1. It works at once, with no terminal and no deploy. Driven through
// the real Worker handlers, with Google faked (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBreakers } from "@cougars/shared/breaker";
import { clubContactFake } from "@cougars/shared/club-contact";
import { NOW, minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Mo Member", position: "G", rating: 55, email: "mo@example.com" },
];

let w: ReturnType<typeof testWorld>;
let google: ReturnType<ReturnType<typeof testWorld>["gmail"]>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.unstubAllGlobals();
  resetBreakers();
  clubContactFake.value = "club@example.com";
  w = testWorld(ROSTER);
  google = w.gmail();
});

/** The admin, signed in on their own phone before anything went wrong, and what they do about the email. */
async function admin() {
  const b = await w.signedIn("dana@example.com");
  // From here on a sign-in code is emailed, as on a deployed app (on your own machine it's shown on screen)
  w.env.TEAM_ENV = undefined;
  return {
    ...b,
    /** Settings → Email. */
    email: async () => (await b.call("GET", "/api/mail")).body,
    /** "Reconnect email": where the app sends the browser (Google's consent page). */
    reconnect: async () => b.call("POST", "/api/mail/reconnect", {}),
    /** Back from Google: the app's answer, and the page it lands on. */
    back: async (path: string, now = NOW) => {
      const res = await b.open("GET", path, { now });
      return { status: res.status, landsOn: res.headers.get("location") };
    },
  };
}

const rows = (sql: string) => w.db.raw.prepare(sql).all();

/** Mo asks for a sign-in code, as anyone does; whether it reached Gmail. */
async function moSignsIn(now = NOW) {
  const before = google.sent.length;
  await w.ask(w.browser(), "mo@example.com", now);
  return google.sent.length > before;
}

describe("Settings → Email says whether email works", () => {
  it("the sending account, the From address and the last send", async () => {
    const dana = await admin();
    expect(await moSignsIn()).toBe(true);
    expect(await dana.email()).toMatchObject({
      account: "dev@example.com",
      from: "dev@example.com",
      source: "deployed",
      lastSentAt: expect.any(String),
      failure: null,
      canReconnect: true,
    });
  });

  it("in production it sends as the club's address, the account's alias", async () => {
    const dana = await admin();
    w.env.SITE_ENV = "production";
    w.turnstile();
    expect(await moSignsIn()).toBe(true);
    expect(google.sent.at(-1)!.from).toBe("Battersea Cougars <club@example.com>");
    expect(await dana.email()).toMatchObject({ account: "dev@example.com", from: "club@example.com" });
  });

  it("a member can't see it or reconnect", async () => {
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("GET", "/api/mail")).status).toBe(403);
    expect((await mo.call("POST", "/api/mail/reconnect", {})).status).toBe(403);
  });
});

describe("when Google cancels the token", () => {
  it("the admin sees it, reconnects, and email goes again at once, with no deploy", async () => {
    const dana = await admin();
    expect(await moSignsIn()).toBe(true);
    // The developer account's password is changed: Google cancels its token
    google.cancel();
    expect(await moSignsIn(minutes(10))).toBe(false);
    expect(await dana.email()).toMatchObject({ failure: "cancelled", failedAt: expect.any(String) });

    const { status, body } = await dana.reconnect();
    expect(status).toBe(200);
    const consent = new URL(body.url);
    expect(consent.searchParams.get("redirect_uri")).toBe("https://team.test/api/mail/callback");
    expect(consent.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(consent.searchParams.get("access_type")).toBe("offline");

    expect(await dana.back(google.consent(body.url), minutes(12))).toEqual({
      status: 303,
      landsOn: "/settings/email?email=reconnected",
    });
    expect(await dana.email()).toMatchObject({
      account: "dev@example.com",
      source: "reconnected",
      failure: null,
      reconnectedAt: minutes(12).toISOString(),
      reconnectedBy: { name: "Dana Admin" },
    });
    // The new token is in D1, sealed: not there to read
    const [kept] = rows("SELECT name, sealed FROM sealed_tokens") as { name: string; sealed: string }[];
    expect(kept.name).toBe("gmail");
    for (const token of google.live()) expect(kept.sealed).not.toContain(token);
    // ...and on the record
    expect(rows("SELECT action FROM audit_log WHERE action LIKE 'mail.%'")).toEqual([{ action: "mail.reconnected" }]);

    expect(await moSignsIn(minutes(13))).toBe(true);
    expect(google.sent.at(-1)!.token).toMatch(/^reconnected-/);
  });

  it("Home tells the admins, and their phones hear it once", async () => {
    const dana = await admin();
    await dana.call("PUT", "/api/auth/device", { token: "dana-phone", platform: "ios" });
    google.cancel();
    await moSignsIn();
    await moSignsIn(minutes(1));
    expect(w.pushes.filter((p) => p.memberId === 1)).toEqual([
      expect.objectContaining({ title: "Email has stopped", path: "/settings/email" }),
    ]);
  });

  it("Gmail being busy isn't a cancelled token: it says so, and there's nothing to reconnect", async () => {
    const dana = await admin();
    google.busy = true;
    expect(await moSignsIn()).toBe(false);
    const status = await dana.email();
    expect(status.failure).toBe("paused");
    expect(status.pausedUntil).toBeTruthy();
    expect(w.pushes).toEqual([]);
  });

  it("without 'Send email on your behalf' ticked nothing is saved, and the admin is told plainly", async () => {
    const dana = await admin();
    google.cancel();
    await moSignsIn();
    const { body } = await dana.reconnect();
    expect((await dana.back(google.consent(body.url, { send: false }))).landsOn).toBe("/settings/email?email=no-send");
    expect(rows("SELECT * FROM sealed_tokens")).toEqual([]);
    expect((await dana.email()).failure).toBe("cancelled");
  });

  it("the club's own account is refused: nothing holds a token for it", async () => {
    const dana = await admin();
    const { body } = await dana.reconnect();
    expect((await dana.back(google.consent(body.url, { as: "club@example.com" }))).landsOn).toBe(
      "/settings/email?email=club",
    );
    expect(rows("SELECT * FROM sealed_tokens")).toEqual([]);
  });

  it("pressing Cancel on Google's page changes nothing", async () => {
    const dana = await admin();
    const { body } = await dana.reconnect();
    expect((await dana.back(google.consent(body.url, { deny: true }))).landsOn).toBe("/settings/email?email=denied");
    expect(rows("SELECT * FROM sealed_tokens")).toEqual([]);
  });

  it("Google's answer only counts in the browser that asked, and only once", async () => {
    const dana = await admin();
    const { body } = await dana.reconnect();
    const back = google.consent(body.url);
    // Someone else's browser, signed in as an admin too, can't land another account's token here
    w.env.TEAM_ENV = "local";
    const other = await w.signedIn("dana@example.com");
    w.env.TEAM_ENV = undefined;
    expect((await other.open("GET", back)).headers.get("location")).toBe("/settings/email?email=expired");
    expect(rows("SELECT * FROM sealed_tokens")).toEqual([]);
    // A forged state, in the browser that asked: refused, and that round trip is spent
    const forged = back.replace(/state=[^&]+/, "state=forged");
    expect((await dana.back(forged)).landsOn).toBe("/settings/email?email=expired");
    expect((await dana.back(back)).landsOn).toBe("/settings/email?email=expired");
    expect(rows("SELECT * FROM sealed_tokens")).toEqual([]);
    // Asked again, it works; Google's answer played back a second time doesn't
    const again = google.consent((await dana.reconnect()).body.url);
    expect((await dana.back(again)).landsOn).toBe("/settings/email?email=reconnected");
    expect((await dana.back(again)).landsOn).toBe("/settings/email?email=expired");
  });

  it("a reconnected token that won't open falls back to the deployed one, and says so", async () => {
    const dana = await admin();
    const { body } = await dana.reconnect();
    await dana.back(google.consent(body.url));
    w.env.GMAIL_TOKEN_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
    const errors = vi.mocked(console.error);
    errors.mockClear();
    expect(await moSignsIn()).toBe(true);
    expect(google.sent.at(-1)!.token).toBe(google.deployed);
    expect(errors.mock.calls.flat().join(" ")).toContain("mail.token_unreadable");
    expect((await dana.email()).source).toBe("deployed");
  });

  it("without the Web client set up, Settings says reconnecting isn't ready yet", async () => {
    const dana = await admin();
    w.env.GMAIL_WEB_CLIENT_ID = undefined;
    expect((await dana.email()).canReconnect).toBe(false);
    expect((await dana.reconnect()).status).toBe(503);
  });
});
