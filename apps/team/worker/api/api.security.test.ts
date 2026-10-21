// The API's security rules (ADR 0036), as someone would try to get round them: no session, a plain member poking
// at admin routes, a member manager reaching for Admin, another site's form, and a member reading bootstrap in
// devtools. Driven through the real handler in the fake world (testing.ts, ADR 0031).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { SECURITY_HEADERS } from "../index";
import { ROUTES } from "./api";
import { testWorld } from "../testing";
import { parseHeadersFile } from "@cougars/shared/testing/headers-file";
import { all } from "@cougars/shared/d1";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Pat Plain", position: "D", rating: 40, email: "pat@example.com" },
];
let w: ReturnType<typeof testWorld>;

beforeEach(() => {
  w = testWorld(ROSTER);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/** A path each route answers, its numbers filled with 1. */
const sample = (path: RegExp) =>
  path.source
    .replace(/^\^|\$$/g, "")
    .replace(/\(\\d\+\)/g, "1")
    .replace(/\\\//g, "/");

describe("every change", () => {
  it("says which parts of the club it touches, so the app gets them back (ADR 0053)", () => {
    const silent = ROUTES.filter((r) => r.method !== "GET" && !r.changes?.length).map((r) => `${r.method} ${r.path}`);
    expect(silent).toEqual([]);
  });
});

describe("every route", () => {
  it("answers no one who isn't signed in", async () => {
    const stranger = w.browser();
    for (const r of ROUTES) {
      const res = await stranger.call(r.method, sample(r.path), r.method === "GET" ? undefined : {});
      expect(res.status, `${r.method} ${sample(r.path)}`).toBe(401);
    }
  });

  it("refuses a plain member every route their role doesn't allow", async () => {
    const reg = await w.signedIn("reg@example.com");
    const allowed = new Set<string>((await reg.call("GET", "/api/bootstrap")).body.actions);
    for (const r of ROUTES.filter((r) => r.action !== "authenticated" && !allowed.has(r.action))) {
      const res = await reg.call(r.method, sample(r.path), r.method === "GET" ? undefined : {});
      expect(res.status, `${r.method} ${sample(r.path)} needs ${r.action}`).toBe(403);
    }
  });
});

describe("what bootstrap tells a plain member", () => {
  it("leaves out people asking to join, people who've left, and how to reach anyone else", async () => {
    await w
      .browser()
      .call("POST", "/api/auth/request", { name: "Nosy Stranger", email: "nosy@example.com", position: "F" });
    const admin = await w.signedIn("dana@example.com");
    const all = (await admin.call("GET", "/api/bootstrap")).body.members;
    const pat = all.find((m: { name: string }) => m.name === "Pat Plain");
    await admin.call("PUT", `/api/members/${pat.id}`, { ...pat, status: "inactive", roles: ["Member"] });
    expect(all.find((m: { name: string }) => m.name === "Nosy Stranger").email).toBe("nosy@example.com");

    const reg = await w.signedIn("reg@example.com");
    const b = (await reg.call("GET", "/api/bootstrap")).body;
    const names = b.members.map((m: { name: string }) => m.name);
    expect(names).toEqual(["Dana Admin", "Reg Player"]);
    const me = b.members.find((m: { id: number }) => m.id === b.me);
    const dana = b.members.find((m: { name: string }) => m.name === "Dana Admin");
    expect(me).toMatchObject({ email: "reg@example.com", paymentReference: expect.stringMatching(/^COUGARS [A-Z]+/) });
    expect(dana).toMatchObject({ email: null, paymentReference: null, phone: null, rating: 0 });
  });
});

describe("what bootstrap tells a plain member about everyone else (ADR 0036)", () => {
  it("who's in and waiting, but not who said no, who didn't turn up, who pays quarterly, or anyone's roles", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await w.signedIn("reg@example.com");
    const pat = await w.signedIn("pat@example.com");
    const b = (await dana.call("GET", "/api/bootstrap")).body;
    const patId = b.members.find((m: { name: string }) => m.name === "Pat Plain").id;
    const regId = b.members.find((m: { name: string }) => m.name === "Reg Player").id;
    const past = b.sessions.find((s: { heldOn: string }) => s.heldOn < "2026-10-06");
    const next = b.sessions.find((s: { heldOn: string }) => s.heldOn >= "2026-10-06");
    // Pat said no to the next one; at a past one, Pat didn't turn up and Dana walked in
    await pat.call("POST", `/api/sessions/${next.id}/answer`, { answer: "out" });
    await dana.call("POST", `/api/sessions/${past.id}/players`, { memberId: patId, in: true });
    await dana.call("POST", `/api/sessions/${past.id}/register`, { memberId: patId, here: false });
    await dana.call("POST", `/api/sessions/${past.id}/register`, { memberId: b.me, here: true });
    await dana.call("POST", `/api/members/${patId}/quarterly`, { quarterly: true });
    await reg.call("POST", `/api/sessions/${next.id}/answer`, { answer: "in" });

    const seen = (await reg.call("GET", "/api/bootstrap")).body;
    const at = (id: number) => seen.sessions.find((s: { id: number }) => s.id === id);
    expect(at(next.id)).toMatchObject({ going: [regId], out: [] });
    expect(at(past.id)).toMatchObject({ going: [patId, b.me], noShows: [], walkIns: [] });
    const patSeen = seen.members.find((m: { id: number }) => m.id === patId);
    expect(patSeen).toMatchObject({ quarterly: false, roles: [] });
    expect(seen.members.find((m: { id: number }) => m.id === regId).roles).toEqual(["Member"]);
    // Of the roles, only the ones Reg holds or could open the app as: not Admin
    expect(seen.roles.map((r: { name: string }) => r.name)).toEqual(["Member"]);

    // Pat sees their own no and no-show; Dana, who runs the register, sees everyone's
    const own = (await pat.call("GET", "/api/bootstrap")).body;
    expect(own.sessions.find((s: { id: number }) => s.id === next.id).out).toEqual([patId]);
    expect(own.sessions.find((s: { id: number }) => s.id === past.id).noShows).toEqual([patId]);
    expect(own.members.find((m: { id: number }) => m.id === patId).quarterly).toBe(true);
    const all = (await dana.call("GET", "/api/bootstrap")).body;
    expect(all.sessions.find((s: { id: number }) => s.id === past.id)).toMatchObject({
      noShows: [patId],
      walkIns: [b.me],
    });
    expect(all.roles.map((r: { name: string }) => r.name)).toContain("Admin");
  });

  it("not how to reach a team that entered from outside the club", async () => {
    const dana = await w.signedIn("dana@example.com");
    const made = await dana.call("POST", "/api/tournaments", {
      name: "Open Cup",
      location: "Battersea Park",
      heldOn: "2026-11-01",
      startTime: "10:00",
      endTime: "15:00",
      status: "planned",
      feePence: 0,
      kind: "teams",
      playoffs: [],
      awards: [],
      teams: [{ name: "Visitors", logo: null, captainName: "Vic", contact: "07700 900123", players: [] }],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const team = (b: { tournaments: { name: string; teams: { contact: string }[] }[] }) =>
      b.tournaments.find((t) => t.name === "Open Cup")!.teams[0];
    expect(team((await dana.call("GET", "/api/bootstrap")).body).contact).toBe("07700 900123");
    const reg = await w.signedIn("reg@example.com");
    expect(team((await reg.call("GET", "/api/bootstrap")).body).contact).toBe("");
  });
});

describe("you can't grant what you don't have", () => {
  /** Reg, given a role with these actions (plus Member's), signed in. */
  async function regWith(actions: string[]) {
    const admin = await w.signedIn("dana@example.com");
    const { id } = (await admin.call("POST", "/api/roles", { name: "Helper", description: "", actions })).body;
    const reg = (await admin.call("GET", "/api/bootstrap")).body.members.find(
      (m: { name: string }) => m.name === "Reg Player",
    );
    expect((await admin.call("PUT", `/api/members/${reg.id}`, { ...reg, roles: ["Helper", "Member"] })).status).toBe(
      200,
    );
    return { roleId: id as number, regId: reg.id as number, reg: await w.signedIn("reg@example.com") };
  }

  it("lets a member manager change plain members but never make an admin or touch one", async () => {
    const { reg, regId } = await regWith(["manage:Member", "read:Event"]);
    const members = (await reg.call("GET", "/api/bootstrap")).body.members;
    const me = members.find((m: { id: number }) => m.id === regId);
    const pat = members.find((m: { name: string }) => m.name === "Pat Plain");
    const dana = members.find((m: { name: string }) => m.name === "Dana Admin");

    expect((await reg.call("PUT", `/api/members/${pat.id}`, { ...pat, rating: 55 })).status).toBe(200);
    expect((await reg.call("PUT", `/api/members/${regId}`, { ...me, roles: ["Admin", "Member"] })).status).toBe(403);
    expect((await reg.call("PUT", `/api/members/${pat.id}`, { ...pat, roles: ["Admin"] })).status).toBe(403);
    expect((await reg.call("PUT", `/api/members/${dana.id}`, { ...dana, status: "inactive" })).status).toBe(403);
    // An admin's email signs them in: setting it would be a way to become them
    const takeOver = await reg.call("PUT", `/api/members/${dana.id}/contact`, { email: "reg2@example.com" });
    expect(takeOver.status).toBe(403);
  });

  it("lets a role manager make roles only as strong as they are", async () => {
    const { reg, roleId } = await regWith(["manage:Role", "read:Event"]);
    const role = (actions: string[]) => ({ name: "Helper", description: "", actions });
    expect((await reg.call("PUT", `/api/roles/${roleId}`, role(["manage:Role", "manage:all"]))).status).toBe(403);
    expect((await reg.call("POST", "/api/roles", { ...role(["manage:all"]), name: "Boss" })).status).toBe(403);
    expect((await reg.call("POST", "/api/roles", { ...role(["read:Event"]), name: "Readers" })).status).toBe(201);
  });
});

describe("requests from somewhere else", () => {
  it("refuses another site's request, and anything that isn't JSON", async () => {
    const reg = await w.signedIn("reg@example.com");
    const evil = await reg.call("POST", "/api/me", {}, { headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    const sibling = await w
      .browser()
      .call("POST", "/api/auth/start", { email: "reg@example.com" }, { headers: { origin: "https://www.team.test" } });
    expect(sibling.status).toBe(403);
    const form = await reg.call("PUT", "/api/me", { position: "D" }, { headers: { "content-type": "text/plain" } });
    expect(form.status).toBe(415);
    const ours = await reg.call(
      "PUT",
      "/api/me",
      { position: "D", phone: "", bio: "" },
      { headers: { origin: "https://team.test" } },
    );
    expect(ours.status).toBe(200);
  });

  it("refuses a change that says nothing about where it came from (#42)", async () => {
    const reg = await w.signedIn("reg@example.com");
    const change = { position: "D", phone: "", bio: "" };
    const silent = await reg.call("PUT", "/api/me", change, { headers: { origin: null } });
    expect(silent.status).toBe(403);
    const typed = await reg.call("PUT", "/api/me", change, { headers: { origin: null, "sec-fetch-site": "none" } });
    expect(typed.status).toBe(403);
    const ownPage = await reg.call("PUT", "/api/me", change, {
      headers: { origin: null, "sec-fetch-site": "same-origin" },
    });
    expect(ownPage.status).toBe(200);
    expect((await reg.call("GET", "/api/bootstrap", undefined, { headers: { origin: null } })).status).toBe(200);
  });

  it("is never framed, sniffed or told where it came from, from the Worker or the asset layer (ADR 0036)", async () => {
    const res = await worker.fetch(
      new Request("https://team.test/api/health"),
      { DB: w.db, ASSETS: { fetch: async () => new Response("<!doctype html>") } as unknown as Fetcher },
      { waitUntil: () => {} } as unknown as ExecutionContext,
    );
    expect(Object.fromEntries(res.headers)).toMatchObject(SECURITY_HEADERS);
    expect(SECURITY_HEADERS["content-security-policy"]).toContain("frame-ancestors 'none'");
    // The app's own page is served without the Worker (run_worker_first is /api/* only): the same set, from the file
    const file = parseHeadersFile(readFileSync(new URL("../../public/_headers", import.meta.url).pathname, "utf8"));
    expect(file["/*"]).toEqual(SECURITY_HEADERS);
  });

  it("runs only the page's own inline script, the one that reads the club at once (ADR 0120)", () => {
    const page = readFileSync(new URL("../../index.html", import.meta.url).pathname, "utf8");
    const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline).toHaveLength(1);
    const hash = `'sha256-${createHash("sha256").update(inline[0]).digest("base64")}'`;
    // Edited index.html's script? Put this hash in SECURITY_HEADERS (worker/index.ts) and public/_headers. The one
    // other source is Turnstile's, on the sign-in page (#13)
    const scripts = SECURITY_HEADERS["content-security-policy"].split("; ").find((d) => d.startsWith("script-src"));
    expect(scripts).toBe(`script-src 'self' https://challenges.cloudflare.com ${hash}`);
  });

  it("frames nothing but Turnstile's check, and talks to no one but itself (#13)", () => {
    const policy = SECURITY_HEADERS["content-security-policy"].split("; ");
    expect(policy).toContain("frame-src https://challenges.cloudflare.com");
    expect(policy).toContain("connect-src 'self'");
  });
});

describe("an everyday role (ADR 0024)", () => {
  const roleId = (b: { roles: { id: number; name: string }[] }, name: string) =>
    b.roles.find((r) => r.name === name)!.id;

  it("an admin opens the app as a plain member day to day, and can go back to their full role", async () => {
    const dana = await w.signedIn("dana@example.com");
    const b = (await dana.call("GET", "/api/bootstrap")).body;
    expect(b.everydayRole).toBeNull();
    const member = roleId(b, "Member");
    expect((await dana.call("PUT", "/api/me/everyday-role", { roleId: member })).status).toBe(200);
    expect((await dana.call("GET", "/api/bootstrap")).body.everydayRole).toBe(member);
    // Still an admin underneath: the server goes by their real role
    expect((await dana.call("GET", "/api/bootstrap")).body.actions).toContain("manage:all");
    await dana.call("PUT", "/api/me/everyday-role", { roleId: null });
    expect((await dana.call("GET", "/api/bootstrap")).body.everydayRole).toBeNull();
  });

  it("is never a way up: a plain member can't make Admin their everyday role", async () => {
    const reg = await w.signedIn("reg@example.com");
    // They aren't sent the Admin role (ADR 0036), so they guess its id, as anyone could
    const admin = w.db.raw.prepare("SELECT id FROM roles WHERE name = 'Admin'").get() as { id: number };
    const res = await reg.call("PUT", "/api/me/everyday-role", { roleId: admin.id });
    expect(res.status).toBe(403);
    expect((await reg.call("GET", "/api/bootstrap")).body.everydayRole).toBeNull();
  });
});

describe("what's on the record (ADR 0024, ADR 0095)", () => {
  const record = async () =>
    (await all<{ action: string; member_id: number; detail: string }>(w.db, "SELECT * FROM audit_log ORDER BY id")).map(
      (r) => ({ event: r.action, by: r.member_id, ...JSON.parse(r.detail) }),
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const named = (members: any[], name: string) => members.find((m) => m.name === name);

  it("every change to who can do what, and every refused request, says who did it, before and after", async () => {
    const dana = await w.signedIn("dana@example.com");
    const b = (await dana.call("GET", "/api/bootstrap")).body;
    const reg = named(b.members, "Reg Player");
    const { id: roleId } = (
      await dana.call("POST", "/api/roles", { name: "Helper", description: "", actions: ["manage:Member"] })
    ).body;
    await dana.call("PUT", `/api/roles/${roleId}`, { name: "Helper", description: "", actions: ["manage:Role"] });
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, roles: ["Helper", "Member"] });
    // The same again changes nothing, so it isn't a record; nor is a rating, which isn't who can do what
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, roles: ["Helper", "Member"], rating: 61 });
    await dana.call("PUT", `/api/members/${reg.id}/contact`, { email: "reg.new@example.com", phone: "" });
    const { id: ninaId } = (
      await dana.call("POST", "/api/members", { name: "Nina New", email: "nina@example.com", position: "G" })
    ).body;
    const pat = await w.signedIn("pat@example.com");
    expect((await pat.call("GET", "/api/usage")).status).toBe(403);

    const rows = (await record()).filter((r) => !r.event.startsWith("sign_"));
    const me = b.me;
    expect(rows).toEqual([
      { event: "role.created", by: me, roleId, from: null, to: { name: "Helper", actions: ["manage:Member"] } },
      {
        event: "role.updated",
        by: me,
        roleId,
        from: { name: "Helper", actions: ["manage:Member"] },
        to: { name: "Helper", actions: ["manage:Role"] },
      },
      {
        event: "member.updated",
        by: me,
        memberId: reg.id,
        from: { status: "active", roles: ["Member"] },
        to: { status: "active", roles: ["Helper", "Member"] },
      },
      { event: "member.email", by: me, memberId: reg.id, from: "reg@example.com", to: "reg.new@example.com" },
      {
        event: "member.added",
        by: me,
        memberId: ninaId,
        from: null,
        to: { name: "Nina New", email: "nina@example.com" },
      },
      {
        event: "refused",
        by: named(b.members, "Pat Plain").id,
        method: "GET",
        path: "/api/usage",
        action: "read:Usage",
      },
    ]);
  });

  it("is declared on every change: what it puts on the record, or that it puts nothing and why (ADR 0095)", () => {
    const silent = ROUTES.filter((r) => r.method !== "GET" && r.audit === undefined).map(
      (r) => `${r.method} ${r.path}`,
    );
    expect(silent).toEqual([]);
    // An opt-out says why, so a reviewer reads the reason in the diff
    const unexplained = ROUTES.filter((r) => r.audit && "none" in r.audit && r.audit.none.trim().length < 10).map(
      (r) => `${r.method} ${r.path}`,
    );
    expect(unexplained).toEqual([]);
  });

  it("puts every change made with more than being signed in on the record, but for the few that say why (ADR 0095)", () => {
    // The only opt-outs beyond being signed in: a member's own sign-up (it needs signup:Event, and the sign-ups are
    // their own record). Anything an admin, a team maker, a scorer or a treasurer does is on it
    const optedOut = ROUTES.filter((r) => r.action !== "authenticated" && r.audit && "none" in r.audit).map(
      (r) => `${r.method} ${r.path}`,
    );
    expect(optedOut).toEqual([
      "POST /^\\/api\\/sessions\\/(\\d+)\\/answer$/",
      "POST /^\\/api\\/tournaments\\/(\\d+)\\/answer$/",
      "POST /^\\/api\\/club-events\\/(\\d+)\\/answer$/",
    ]);
  });

  it("writes nothing when a change is refused or fails", async () => {
    const dana = await w.signedIn("dana@example.com");
    const before = (await record()).length;
    expect((await dana.call("PUT", "/api/members/999", { name: "x" })).status).toBe(404);
    expect((await dana.call("PUT", "/api/roles/1", { name: "Admin", actions: [] })).status).toBe(409);
    expect((await record()).length).toBe(before);
  });
});

describe("the last admin", () => {
  it("can neither lose the role nor go inactive, so the club always has one", async () => {
    const dana = await w.signedIn("dana@example.com");
    const b = (await dana.call("GET", "/api/bootstrap")).body;
    const me = b.members.find((m: { id: number }) => m.id === b.me);
    expect((await dana.call("PUT", `/api/members/${me.id}`, { ...me, roles: ["Member"] })).status).toBe(409);
    expect((await dana.call("PUT", `/api/members/${me.id}`, { ...me, status: "inactive" })).status).toBe(409);
    expect((await dana.call("GET", "/api/bootstrap")).status).toBe(200);
  });
});
