// The website's results are pages built from a snapshot of D1 (apps/team/worker/website/README.md), so a result that changes in the app asks
// for a rebuild: once the last game of a tournament is played, an award is confirmed or a finished one is changed.
// The Worker waits for five quiet minutes, so a results day is one rebuild, then asks GitHub (as the club's GitHub
// App) to run the website's deploy from its own environment's branch, with a token that can do only that (#71).
// Driven through the real Worker handlers (ADR 0031), GitHub faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rebuildWebsite } from "./website";
import { NOW, minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
/** What GitHub was asked: each run of the deploy workflow, the App's signed request, checked against its public key,
 * and what the token it asked for may do. */
let dispatches: Json[];
let scopes: Json[];
let github: "up" | "down";
let publicKey: CryptoKey;
let privatePem: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  dispatches = [];
  scopes = [];
  github = "up";
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const der = Buffer.from((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer).toString("base64");
  privatePem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (github === "down") return new Response("unavailable", { status: 503 });
    if (url === "https://api.github.com/app/installations/169599165/access_tokens") {
      // The App's request: a JWT it signed, from its Client ID
      const [head, body, sig] = auth.replace("Bearer ", "").split(".");
      const signed = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        Buffer.from(sig, "base64url"),
        new TextEncoder().encode(`${head}.${body}`),
      );
      const claims = JSON.parse(Buffer.from(body, "base64url").toString());
      if (!signed || claims.iss !== "Iv23liuUhxYcTesso0TW") return new Response("bad JWT", { status: 401 });
      scopes.push(JSON.parse(String(init?.body)));
      return Response.json({ token: "ghs_installation", expires_at: "2026-10-06T12:00:00Z" }, { status: 201 });
    }
    if (url === "https://api.github.com/repos/battersea-cougars/ark/actions/workflows/deploy.yml/dispatches") {
      if (auth !== "Bearer ghs_installation") return new Response("no", { status: 401 });
      dispatches.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    return new Response("unexpected", { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

/** The dev Worker, as deployed: its environment, the App's settings and key. */
const deployed = () => ({
  ...w.env,
  TEAM_ENV: undefined,
  SITE_ENV: "dev",
  GITHUB_APP_CLIENT_ID: "Iv23liuUhxYcTesso0TW",
  GITHUB_APP_INSTALLATION_ID: "169599165",
  GITHUB_APP_PRIVATE_KEY: privatePem,
});

/** A cup two teams entered, one game between them, with Champions to give out. */
async function cup() {
  const dana = await w.signedIn("dana@example.com");
  const one = (sql: string, ...p: unknown[]) => (w.db.raw.prepare(sql).get(...p) as { id: number }).id;
  const idOf = (name: string) => one("SELECT id FROM members WHERE name = ?", name);
  const res = await dana.call("POST", "/api/tournaments", {
    name: "Summer Cup",
    location: "Battersea Park",
    heldOn: "2026-10-06",
    startTime: "10:00",
    endTime: "15:00",
    status: "planned",
    feePence: 0,
    kind: "teams",
    playoffs: [],
    awards: [{ name: "Champions", about: "" }],
    teams: [
      { name: "Ants", logo: null, captainMemberId: idOf("Cara Captain"), players: [] },
      { name: "Bees", logo: null, captainMemberId: idOf("Cole Captain"), players: [] },
    ],
  });
  const id = res.body.id as number;
  await dana.call("POST", `/api/tournaments/${id}/fixtures`);
  const game = one("SELECT id FROM tournament_games WHERE tournament_id = ?", id);
  const ants = one("SELECT id FROM tournament_teams WHERE tournament_id = ? AND name = 'Ants'", id);
  return {
    id,
    score: (now = NOW) =>
      dana.call("PUT", `/api/tournaments/${id}/games/${game}`, { homeGoals: 2, awayGoals: 1 }, { now }),
    confirm: (now = NOW) =>
      dana.call("PUT", `/api/tournaments/${id}/winners`, { winners: [{ award: "Champions", teamId: ants }] }, { now }),
  };
}

describe("a result that changes in the app rebuilds the website", () => {
  it("once the last game's played and things are quiet for five minutes, GitHub is asked once to rebuild dev's site", async () => {
    const { score } = await cup();
    expect((await score()).status).toBe(200);
    // Still settling: the admin may correct the score, confirm the awards
    expect(await rebuildWebsite(deployed(), minutes(4))).toBe("waiting");
    expect(dispatches).toEqual([]);
    expect(await rebuildWebsite(deployed(), minutes(6))).toBe("sent");
    expect(dispatches).toEqual([{ ref: "main", inputs: { apps: "web" } }]);
    // A token for that alone: it can start a workflow, never push to the repo
    expect(scopes).toEqual([{ repositories: ["ark"], permissions: { actions: "write" } }]);
    // Done: the next check has nothing to do
    expect(await rebuildWebsite(deployed(), minutes(11))).toBe("nothing");
    expect(dispatches).toHaveLength(1);
  });

  it("each change in a busy spell restarts the five minutes, so a results day is one rebuild", async () => {
    const { score, confirm } = await cup();
    await score(NOW);
    await confirm(minutes(4));
    expect(await rebuildWebsite(deployed(), minutes(6))).toBe("waiting");
    expect(await rebuildWebsite(deployed(), minutes(9))).toBe("sent");
    expect(dispatches).toHaveLength(1);
  });

  it("a tournament still being set up or played doesn't ask", async () => {
    await cup();
    expect(await rebuildWebsite(deployed(), minutes(30))).toBe("nothing");
    expect(dispatches).toEqual([]);
  });

  it("a finished tournament changed later asks again", async () => {
    const { score, confirm } = await cup();
    await score();
    await rebuildWebsite(deployed(), minutes(6));
    await confirm(minutes(60));
    expect(await rebuildWebsite(deployed(), minutes(66))).toBe("sent");
    expect(dispatches).toHaveLength(2);
  });

  it("if GitHub can't be reached, the next check tries again", async () => {
    const { score } = await cup();
    await score();
    github = "down";
    expect(await rebuildWebsite(deployed(), minutes(6))).toBe("failed");
    github = "up";
    expect(await rebuildWebsite(deployed(), minutes(11))).toBe("sent");
    expect(dispatches).toHaveLength(1);
  });

  it("production rebuilds production's site, from release", async () => {
    const { score } = await cup();
    await score();
    expect(await rebuildWebsite({ ...deployed(), SITE_ENV: "production" }, minutes(6))).toBe("sent");
    expect(dispatches).toEqual([{ ref: "release", inputs: { apps: "web" } }]);
  });

  it("a laptop's server never asks GitHub", async () => {
    const { score } = await cup();
    await score();
    expect(await rebuildWebsite({ ...deployed(), TEAM_ENV: "local" }, minutes(6))).toBe("nothing");
    expect(dispatches).toEqual([]);
  });
});
