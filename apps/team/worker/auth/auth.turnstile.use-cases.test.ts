// Turnstile in front of the two things anyone can do without signing in (#13, ADR 0028): ask for a sign-in code and
// ask to join. A person's browser passes without noticing (the widget only asks for a tap when Cloudflare isn't sure);
// a script gets nothing, however many addresses it comes from. Cloudflare's siteverify is faked in the fake world
// (testing.ts turnstile()); everything else is the real handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { NOW, humanToken, minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "App Review", position: "F", rating: 50, email: "review@example.com" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
let cloudflare: ReturnType<typeof w.turnstile>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  cloudflare = w.turnstile();
});

const codes = () => (w.db.raw.prepare("SELECT count(*) n FROM login_challenges").get() as { n: number }).n;
const pending = () =>
  (w.db.raw.prepare("SELECT name FROM members WHERE status = 'pending' ORDER BY id").all() as Json[]).map(
    (m) => m.name,
  );
const askCode = (email: string, turnstile?: string, headers: Record<string, string> = {}) =>
  w.browser().call("POST", "/api/auth/start", { email, turnstile }, { headers });
const askToJoin = (name: string, turnstile?: string) =>
  w.browser().call("POST", "/api/auth/request", {
    name,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    position: "F",
    turnstile,
  });

describe("asking for a sign-in code", () => {
  it("a person gets their code; Cloudflare is asked once, with where they are", async () => {
    const r = await askCode("reg@example.com", humanToken("sign-in"), { "cf-connecting-ip": "203.0.113.7" });
    expect(r.status).toBe(200);
    expect(r.body.devCode).toMatch(/^\d{6}$/);
    expect(cloudflare.asked).toEqual([
      { secret: "turnstile-test-secret", response: humanToken("sign-in"), remoteip: "203.0.113.7" },
    ]);
  });

  it("a script is refused, member's email or not, and nothing is stored or sent", async () => {
    for (const email of ["reg@example.com", "nobody@example.com"]) {
      for (const token of [undefined, "made-up", humanToken("join")]) {
        const r = await askCode(email, token);
        expect(r.status, `${email} ${token}`).toBe(403);
        expect(r.body.error).toMatch(/couldn't check you're a person/i);
      }
    }
    expect(codes()).toBe(0);
    expect(w.mails).toEqual([]);
  });

  it("refuses everyone while Cloudflare can't be reached: no code without a check", async () => {
    cloudflare.down = true;
    expect((await askCode("reg@example.com", humanToken("sign-in"))).status).toBe(403);
    expect(codes()).toBe(0);
  });

  it("typing the code needs no check: it's the browser that asked, with the code from the email", async () => {
    const phone = w.browser();
    const { devCode } = (
      await phone.call("POST", "/api/auth/start", { email: "reg@example.com", turnstile: humanToken("sign-in") })
    ).body;
    expect((await phone.call("POST", "/api/auth/verify", { code: devCode })).status).toBe(200);
    expect(cloudflare.asked).toHaveLength(1);
  });

  it("App Review's account is let through without one, in the store app on production (ADR 0108)", async () => {
    Object.assign(w.env, { TEAM_ENV: undefined, APP_REVIEW_EMAIL: "review@example.com", APP_REVIEW_CODE: "246810" });
    const live = { host: "https://team.batterseacougars.com" };
    const reviewer = w.browser();
    expect((await reviewer.call("POST", "/api/auth/start", { email: "review@example.com" }, live)).status).toBe(200);
    expect((await reviewer.call("POST", "/api/auth/verify", { code: "246810" }, live)).status).toBe(200);
    expect(cloudflare.asked).toEqual([]);
    // ...and nobody else is
    expect((await w.browser().call("POST", "/api/auth/start", { email: "reg@example.com" }, live)).status).toBe(403);
  });
});

describe("where there's no secret", () => {
  it("on your machine and in tests, everyone goes through, as on the website", async () => {
    w.env.TURNSTILE_SECRET_KEY = undefined;
    expect((await askCode("reg@example.com")).status).toBe(200);
    expect((await askToJoin("Nina New")).status).toBe(200);
  });

  it("in production it's a deploy gone wrong: nobody is sent a code, and the developer hears of it", async () => {
    const reported: string[] = [];
    captureLogs({ report: (_e, entry) => void reported.push(entry.msg) });
    Object.assign(w.env, { TURNSTILE_SECRET_KEY: undefined, SITE_ENV: "production", TEAM_ENV: undefined });
    const r = await w
      .browser()
      .call("POST", "/api/auth/start", { email: "reg@example.com" }, { host: "https://team.batterseacougars.com" });
    expect(r.status).toBe(503);
    expect(codes()).toBe(0);
    expect(reported).toEqual(["turnstile.unset"]);
  });
});

describe("asking to join", () => {
  it("a person's request waits for an admin; a script's never reaches the list", async () => {
    expect((await askToJoin("Nina New", humanToken("join"))).status).toBe(200);
    expect((await askToJoin("Bot One")).status).toBe(403);
    expect((await askToJoin("Bot Two", humanToken("sign-in"))).status).toBe(403);
    expect(pending()).toEqual(["Nina New"]);
  });

  it("when the list is full it says so to everyone, member or not, so it gives no one away", async () => {
    const insert = w.db.raw.prepare(
      "INSERT INTO members (name, email, position, status, joined_on, created_at) VALUES (?, ?, 'F', 'pending', ?, ?)",
    );
    for (let i = 0; i < 50; i++) insert.run(`Waiting ${i}`, `w${i}@example.com`, "2026-10-06", NOW.toISOString());
    const stranger = await askToJoin("Nina New", humanToken("join"));
    const member = await w.browser().call("POST", "/api/auth/request", {
      name: "Reg",
      email: "reg@example.com",
      position: "F",
      turnstile: humanToken("join"),
    });
    expect([stranger.status, member.status]).toEqual([429, 429]);
    expect(member.body).toEqual(stranger.body);
  });

  it("a request nobody answers is forgotten after 30 days, so the list never fills for good", async () => {
    await askToJoin("Nina New", humanToken("join"));
    await w.scheduled("7 * * * *", minutes(29 * 24 * 60));
    expect(pending()).toEqual(["Nina New"]);
    await w.scheduled("7 * * * *", minutes(31 * 24 * 60));
    expect(pending()).toEqual([]);
  });
});
