// Settings → Website (#107): where the club's website is managed from the team app. An admin, or anyone allowed to
// edit the website, sees when it was last rebuilt and whether one is on its way, puts Studio changes live now with
// Rebuild now (the same rebuild a result asks for, ADR 0100, sent at once instead of after five quiet minutes), and
// gets the links to the Studio and the site. Driven through the real Worker handlers (ADR 0031), GitHub faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rebuildWebsite } from "./website";
import { NOW, minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Mo Member", position: "G", rating: 55, email: "mo@example.com" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
/** Each run of the website's deploy GitHub was asked for. */
let dispatches: Json[];
let github: "up" | "down";
let privatePem: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  dispatches = [];
  github = "up";
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = Buffer.from((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer).toString("base64");
  privatePem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  // GitHub, as the rebuild's own stories check it in full (website.rebuild.use-cases.test.ts): here, only what's asked
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (github === "down") return new Response("unavailable", { status: 503 });
    if (url.endsWith("/access_tokens")) return Response.json({ token: "ghs_installation" }, { status: 201 });
    if (url.endsWith("/actions/workflows/deploy.yml/dispatches")) {
      dispatches.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    return new Response("unexpected", { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

/** The dev Worker, as deployed, with the club's GitHub App (after signing in: a deployed Worker emails the code). */
function deployed() {
  Object.assign(w.env, {
    TEAM_ENV: undefined,
    SITE_ENV: "dev",
    GITHUB_APP_CLIENT_ID: "Iv23liuUhxYcTesso0TW",
    GITHUB_APP_INSTALLATION_ID: "169599165",
    GITHUB_APP_PRIVATE_KEY: privatePem,
  });
}

async function admin() {
  const b = await w.signedIn("dana@example.com");
  return {
    ...b,
    /** Settings → Website, as it reads. */
    website: async (now = NOW) => (await b.call("GET", "/api/website", undefined, { now })).body,
    /** Rebuild now: what the page is told. */
    rebuild: async (now = NOW) => b.call("POST", "/api/website/rebuild", {}, { now }),
  };
}

describe("Settings → Website", () => {
  it("says the site has never been rebuilt from the app, and links to the Studio and the site", async () => {
    const dana = await admin();
    deployed();
    expect(await dana.website()).toMatchObject({
      lastRebuildAt: null,
      rebuildWanted: false,
      canRebuild: true,
      siteUrl: "https://web.cougars-dev.workers.dev",
      studioUrl: "https://studio.cougars-dev.workers.dev",
    });
  });

  it("production's links are the club's own addresses", async () => {
    const dana = await admin();
    deployed();
    w.env.SITE_ENV = "production";
    expect(await dana.website()).toMatchObject({
      siteUrl: "https://batterseacougars.com",
      studioUrl: "https://studio.batterseacougars.com",
    });
  });

  it("Rebuild now asks GitHub at once, not after five quiet minutes, and the page then says when", async () => {
    const dana = await admin();
    deployed();
    const res = await dana.rebuild();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: "sent", lastRebuildAt: NOW.toISOString() });
    expect(dispatches).toEqual([{ ref: "main", inputs: { apps: "web" } }]);
    expect(await dana.website(minutes(1))).toMatchObject({ lastRebuildAt: NOW.toISOString(), rebuildWanted: false });
    // Done: the cron has nothing left to send
    expect(await rebuildWebsite(w.env, minutes(10))).toBe("nothing");
  });

  it("pressed again while that rebuild is still building, it doesn't start another", async () => {
    const dana = await admin();
    deployed();
    await dana.rebuild();
    expect((await dana.rebuild(minutes(2))).body).toMatchObject({ result: "recent", lastRebuildAt: NOW.toISOString() });
    expect(dispatches).toHaveLength(1);
    // Once it's had time to finish, it does
    expect((await dana.rebuild(minutes(6))).body.result).toBe("sent");
    expect(dispatches).toHaveLength(2);
  });

  it("if GitHub can't be reached, it says so, and the five-minute check sends it when it can", async () => {
    const dana = await admin();
    deployed();
    github = "down";
    expect((await dana.rebuild()).body).toMatchObject({ result: "failed" });
    expect(await dana.website()).toMatchObject({ rebuildWanted: true, lastRebuildAt: null });
    github = "up";
    expect(await rebuildWebsite(w.env, minutes(5))).toBe("sent");
    expect(dispatches).toHaveLength(1);
  });

  it("a rebuild a result asked for shows as on its way, and its time once it's sent", async () => {
    const dana = await admin();
    deployed();
    await w.db.raw.prepare("INSERT INTO website_rebuild (id, wanted_at) VALUES (1, ?)").run(NOW.toISOString());
    expect(await dana.website()).toMatchObject({ rebuildWanted: true });
    await rebuildWebsite(w.env, minutes(6));
    expect(await dana.website(minutes(7))).toMatchObject({
      rebuildWanted: false,
      lastRebuildAt: minutes(6).toISOString(),
    });
  });

  it("a laptop's server never asks GitHub, and the page says it can't rebuild from here", async () => {
    const dana = await admin();
    expect(await dana.website()).toMatchObject({ canRebuild: false });
    expect((await dana.rebuild()).body).toMatchObject({ result: "not-here" });
    expect(dispatches).toEqual([]);
  });

  it("each rebuild asked for is on the record, with who asked", async () => {
    const dana = await admin();
    deployed();
    await dana.rebuild();
    const entry = w.db.raw
      .prepare("SELECT action, member_id memberId FROM audit_log WHERE action = 'website.rebuilt'")
      .get() as Json;
    expect(entry).toMatchObject({ action: "website.rebuilt" });
    expect(entry.memberId).not.toBeNull();
  });

  it("a member who can't edit the website can't see it or rebuild it", async () => {
    const mo = await w.signedIn("mo@example.com");
    deployed();
    expect((await mo.call("GET", "/api/website")).status).toBe(403);
    expect((await mo.call("POST", "/api/website/rebuild", {})).status).toBe(403);
    expect(dispatches).toEqual([]);
  });
});
