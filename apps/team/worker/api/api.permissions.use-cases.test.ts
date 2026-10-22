// Who may do what (ADR 0024), from the other side of api.security.test.ts: a role that's been given an action opens
// exactly the routes that ask for it, and nothing else; roles change under a signed-in member at once; and the club
// always keeps someone who can do everything, even when two admins act at the same moment. Driven through the real
// handler in the fake world (testing.ts, ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "./api";
import { testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import type { Action } from "../../src/access/actions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Ada Admin", position: "F", rating: 70, email: "ada@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Pat Plain", position: "D", rating: 40, email: "pat@example.com" },
];
const REFUSED = "Your role can't do that.";
let w: ReturnType<typeof testWorld>;

beforeEach(() => {
  w = testWorld(ROSTER);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** A path each route answers, its numbers filled with 1 (as api.security.test.ts does). */
const sample = (path: RegExp) =>
  path.source
    .replace(/^\^|\$$/g, "")
    .replace(/\(\\d\+\)/g, "1")
    .replace(/\\\//g, "/");

const members = async (b: Awaited<ReturnType<typeof w.signedIn>>) =>
  (await b.call("GET", "/api/bootstrap")).body.members as Json[];
const byName = async (b: Awaited<ReturnType<typeof w.signedIn>>, name: string) =>
  (await members(b)).find((m) => m.name === name);

/** Reg, given one more role with these actions beside Member, signed in afresh. */
async function regWith(actions: string[], role = "Helper") {
  const dana = await w.signedIn("dana@example.com");
  const made = await dana.call("POST", "/api/roles", { name: role, description: "", actions });
  expect(made.status).toBe(201);
  const reg = await byName(dana, "Reg Player");
  expect((await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, roles: [role, "Member"] })).status).toBe(200);
  return { dana, regId: reg.id as number, roleId: made.body.id as number, reg: await w.signedIn("reg@example.com") };
}

describe("a role with one action", () => {
  const guarded = [...new Set(ROUTES.map((r) => r.action).filter((a) => a !== "authenticated"))] as Action[];

  it.each(guarded)("given %s, a member gets past the door of every route that asks for it", async (action) => {
    const { reg } = await regWith([action]);
    for (const r of ROUTES.filter((r) => r.action === action)) {
      const res = await reg.call(r.method, sample(r.path), r.method === "GET" ? undefined : {});
      // Whatever the route then makes of an empty request (a 400, a 404 for route 1), it isn't the role refusing
      expect(res.body?.error, `${r.method} ${sample(r.path)} for ${action}`).not.toBe(REFUSED);
    }
  });

  it.each(guarded)("given %s, a member is still refused every route that asks for something else", async (action) => {
    const { reg } = await regWith([action]);
    const memberCan = new Set(
      (await (await w.signedIn("pat@example.com")).call("GET", "/api/bootstrap")).body.actions as string[],
    );
    for (const r of ROUTES.filter(
      (r) => r.action !== "authenticated" && r.action !== action && !memberCan.has(r.action),
    )) {
      const res = await reg.call(r.method, sample(r.path), r.method === "GET" ? undefined : {});
      expect(res.status, `${r.method} ${sample(r.path)} needs ${r.action}, not ${action}`).toBe(403);
    }
  });
});

describe("roles changing under someone signed in", () => {
  it("a role taken away works no more on their very next request, with no signing in again", async () => {
    const { dana, regId, reg } = await regWith(["read:Audit"]);
    expect((await reg.call("GET", "/api/audit")).status).toBe(200);
    const me = (await members(dana)).find((m) => m.id === regId);
    expect((await dana.call("PUT", `/api/members/${regId}`, { ...me, roles: ["Member"] })).status).toBe(200);
    expect((await reg.call("GET", "/api/audit")).status).toBe(403);
  });

  it("an action taken off a role is gone for everyone who holds it, at once", async () => {
    const { dana, roleId, reg } = await regWith(["read:Audit"]);
    expect((await dana.call("PUT", `/api/roles/${roleId}`, { name: "Helper", actions: [] })).status).toBe(200);
    expect((await reg.call("GET", "/api/audit")).status).toBe(403);
  });

  it("an action the database names but the app doesn't know any more grants nothing", async () => {
    const { roleId, reg } = await regWith([]);
    w.db.raw.prepare("INSERT INTO role_actions (role_id, action) VALUES (?, 'delete:Everything')").run(roleId);
    w.db.raw.prepare("INSERT INTO role_actions (role_id, action) VALUES (?, 'manage:All')").run(roleId);
    const boot = (await reg.call("GET", "/api/bootstrap")).body;
    expect(boot.actions).not.toContain("delete:Everything");
    expect((await reg.call("GET", "/api/audit")).status).toBe(403);
  });

  it("a member with no roles at all can still open the app and see their own things, and nothing more", async () => {
    const dana = await w.signedIn("dana@example.com");
    const pat = await byName(dana, "Pat Plain");
    expect((await dana.call("PUT", `/api/members/${pat.id}`, { ...pat, roles: [] })).status).toBe(200);
    const patPhone = await w.signedIn("pat@example.com");
    expect((await patPhone.call("GET", "/api/bootstrap")).status).toBe(200);
    expect((await patPhone.call("GET", "/api/me/data")).status).toBe(200);
    expect((await patPhone.call("GET", "/api/audit")).status).toBe(403);
  });
});

describe("an everyday role is how the app opens, not what the server allows (ADR 0024)", () => {
  it("an admin who opens the app as a member can still do an admin's job when they ask for it", async () => {
    const dana = await w.signedIn("dana@example.com");
    const member = (await dana.call("GET", "/api/bootstrap")).body.roles.find((r: Json) => r.name === "Member");
    expect((await dana.call("PUT", "/api/me/everyday-role", { roleId: member.id })).status).toBe(200);
    expect((await dana.call("GET", "/api/audit")).status).toBe(200);
  });

  it("an everyday role that's no role at all, or not a number, is refused", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("PUT", "/api/me/everyday-role", { roleId: 9999 })).status).toBe(404);
    expect((await dana.call("PUT", "/api/me/everyday-role", { roleId: "1" })).status).toBe(400);
    expect((await dana.call("PUT", "/api/me/everyday-role", { roleId: 1.5 })).status).toBe(400);
    expect((await dana.call("PUT", "/api/me/everyday-role", {})).status).toBe(400);
  });

  it("someone who manages members can't set an admin's everyday role", async () => {
    const { reg } = await regWith(["manage:Member"]);
    const dana = await byName(reg, "Dana Admin");
    const member = (await reg.call("GET", "/api/bootstrap")).body.roles.find((r: Json) => r.name === "Member");
    expect((await reg.call("PUT", `/api/members/${dana.id}/everyday-role`, { roleId: member.id })).status).toBe(403);
  });
});

describe("your own things are only yours", () => {
  it("changing your profile with someone else's id in it changes only yours", async () => {
    const reg = await w.signedIn("reg@example.com");
    const pat = await byName(reg, "Pat Plain");
    const r = await reg.call("PUT", "/api/me", { id: pat.id, memberId: pat.id, position: "G", bio: "Not Pat" });
    expect(r.status).toBe(200);
    const after = await members(reg);
    expect(after.find((m) => m.id === pat.id)).toMatchObject({ position: "D", bio: "" });
    expect(after.find((m) => m.name === "Reg Player")).toMatchObject({ position: "G", bio: "Not Pat" });
  });

  it("deleting your account with someone else's id in the path isn't a route at all", async () => {
    const reg = await w.signedIn("reg@example.com");
    const pat = await byName(reg, "Pat Plain");
    expect((await reg.call("DELETE", `/api/me/${pat.id}`)).status).toBe(404);
    // And the admin route for it refuses a member
    expect((await reg.call("DELETE", `/api/members/${pat.id}`)).status).toBe(403);
    expect((await byName(reg, "Pat Plain")).name).toBe("Pat Plain");
  });
});

describe("routes that aren't there", () => {
  it("a path nobody answers is a 404, and a known path with the wrong method a 405, signed in or not", async () => {
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("GET", "/api/nothing-here")).status).toBe(404);
    expect((await reg.call("DELETE", "/api/bootstrap")).status).toBe(405);
    expect((await w.browser().call("GET", "/api/nothing-here")).status).toBe(404);
    expect((await reg.call("GET", "/api/auth/nothing-here")).status).toBe(404);
  });

  it("an id that isn't a number never reaches a route", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("DELETE", "/api/members/abc")).status).toBe(404);
    expect((await dana.call("DELETE", "/api/members/-1")).status).toBe(404);
  });
});

describe("the club always has someone who can do everything", () => {
  // The last-admin rule is decided inside the statements that write the roles (ADR 0121), so two admins demoting each
  // other at once can't both see the other still there (#135; seeds 2-5 found it)
  it.each(seeds(5))(
    "two admins taking Admin off each other at the same moment leave at least one admin, the other told (seed %i)",
    async (seed) => {
      const dana = await w.signedIn("dana@example.com");
      const ada = await w.signedIn("ada@example.com");
      const all = await members(dana);
      const danaRow = all.find((m) => m.name === "Dana Admin");
      const adaRow = all.find((m) => m.name === "Ada Admin");
      w.db.interleave(seed);
      const replies = await Promise.all([
        dana.call("PUT", `/api/members/${adaRow.id}`, { ...adaRow, roles: ["Member"] }),
        ada.call("PUT", `/api/members/${danaRow.id}`, { ...danaRow, roles: ["Member"] }),
      ]);
      w.db.interleave(null);
      // The other's refused: as the last admin (409), or, when the first went in before their own request was
      // checked, as no longer an admin at all (403, seed 43 of 200)
      const [ok, refused] = replies.map((r) => r.status).sort();
      expect(ok).toBe(200);
      expect([403, 409]).toContain(refused);
      const admins = w.db.raw
        .prepare(
          `SELECT count(*) n FROM member_roles mr JOIN roles r ON r.id = mr.role_id JOIN members m ON m.id = mr.member_id
           WHERE r.name = 'Admin' AND m.status = 'active'`,
        )
        .get() as { n: number };
      expect(admins.n).toBeGreaterThanOrEqual(1);
    },
  );

  // The same, deleting an account: the erasing happens only while another admin's there, in the same batch (#135;
  // seed 3 found it)
  it.each(seeds(5))(
    "two admins deleting their own accounts at the same moment leave at least one admin, the other told (seed %i)",
    async (seed) => {
      const dana = await w.signedIn("dana@example.com");
      const ada = await w.signedIn("ada@example.com");
      w.db.interleave(seed);
      const replies = await Promise.all([dana.call("DELETE", "/api/me"), ada.call("DELETE", "/api/me")]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      const admins = w.db.raw
        .prepare(
          `SELECT count(*) n FROM member_roles mr JOIN roles r ON r.id = mr.role_id JOIN members m ON m.id = mr.member_id
           WHERE r.name = 'Admin' AND m.status = 'active'`,
        )
        .get() as { n: number };
      expect(admins.n).toBeGreaterThanOrEqual(1);
    },
  );

  it("the last admin can't be made pending either", async () => {
    const dana = await w.signedIn("dana@example.com");
    const adaRow = await byName(dana, "Ada Admin");
    expect((await dana.call("PUT", `/api/members/${adaRow.id}`, { ...adaRow, roles: ["Member"] })).status).toBe(200);
    const me = await byName(dana, "Dana Admin");
    expect((await dana.call("PUT", `/api/members/${me.id}`, { ...me, status: "pending" })).status).toBe(409);
  });

  it("an admin who's inactive doesn't count: the only active one still can't step down", async () => {
    const dana = await w.signedIn("dana@example.com");
    const adaRow = await byName(dana, "Ada Admin");
    expect((await dana.call("PUT", `/api/members/${adaRow.id}`, { ...adaRow, status: "inactive" })).status).toBe(200);
    const me = await byName(dana, "Dana Admin");
    expect((await dana.call("PUT", `/api/members/${me.id}`, { ...me, roles: ["Member"] })).status).toBe(409);
    expect((await dana.call("DELETE", "/api/me")).status).toBe(409);
  });

  // Through any role (#136): the rule is about whoever can do everything, not the role called Admin
  const canDoEverything = () =>
    (
      w.db.raw
        .prepare(
          `SELECT count(DISTINCT m.id) n FROM members m JOIN member_roles mr ON mr.member_id = m.id
             JOIN role_actions ra ON ra.role_id = mr.role_id
           WHERE ra.action = 'manage:all' AND m.status = 'active'`,
        )
        .get() as { n: number }
    ).n;

  /** Reg can do everything through a role of his own, Boss, and is the only one left who can: Dana took Admin off
   * Ada, then deleted her own account (allowed, since Reg can do everything too). */
  async function onlyBossLeft() {
    const { dana, reg, regId, roleId } = await regWith(["manage:all"], "Boss");
    const ada = await byName(dana, "Ada Admin");
    expect((await dana.call("PUT", `/api/members/${ada.id}`, { ...ada, roles: ["Member"] })).status).toBe(200);
    expect((await dana.call("DELETE", "/api/me")).status).toBe(200);
    return { reg, regId, roleId };
  }

  it("the last one who can do everything, through a role of its own, can't drop that role", async () => {
    const { reg, regId } = await onlyBossLeft();
    const me = (await members(reg)).find((m) => m.id === regId);
    const r = await reg.call("PUT", `/api/members/${regId}`, { ...me, roles: ["Member"] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/last admin/);
    expect((await reg.call("GET", "/api/bootstrap")).body.actions).toContain("manage:all");
  });

  it("the last one who can do everything, through a role of its own, can't take everything off that role", async () => {
    const { reg, roleId } = await onlyBossLeft();
    const r = await reg.call("PUT", `/api/roles/${roleId}`, { name: "Bossy", actions: ["read:Event"] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Nobody else can do everything/);
    expect((await reg.call("GET", "/api/bootstrap")).body.actions).toContain("manage:all");
    // Nothing of the change went in: not its name, not its actions
    expect(w.db.raw.prepare("SELECT name FROM roles WHERE id = ?").get(roleId)).toEqual({ name: "Boss" });
  });

  it("the last one who can do everything, through a role of its own, can't be made inactive or delete their account", async () => {
    const { reg, regId } = await onlyBossLeft();
    const me = (await members(reg)).find((m) => m.id === regId);
    expect((await reg.call("PUT", `/api/members/${regId}`, { ...me, status: "inactive" })).status).toBe(409);
    expect((await reg.call("DELETE", "/api/me")).status).toBe(409);
    expect(canDoEverything()).toBe(1);
  });

  it("they can still rename the role, or swap it for Admin, keeping everything", async () => {
    const { reg, regId, roleId } = await onlyBossLeft();
    expect((await reg.call("PUT", `/api/roles/${roleId}`, { name: "Gaffer", actions: ["manage:all"] })).status).toBe(
      200,
    );
    const me = (await members(reg)).find((m) => m.id === regId);
    expect((await reg.call("PUT", `/api/members/${regId}`, { ...me, roles: ["Admin"] })).status).toBe(200);
    // And with Admin, the role of their own can go
    expect((await reg.call("PUT", `/api/roles/${roleId}`, { name: "Gaffer", actions: [] })).status).toBe(200);
    expect((await reg.call("GET", "/api/bootstrap")).body.actions).toContain("manage:all");
  });

  it("while someone else can do everything, the role of their own can go", async () => {
    // Ada's still an Admin here
    const { reg, roleId } = await regWith(["manage:all"], "Boss");
    expect((await reg.call("PUT", `/api/roles/${roleId}`, { name: "Boss", actions: ["read:Event"] })).status).toBe(200);
    expect((await reg.call("GET", "/api/bootstrap")).body.actions).not.toContain("manage:all");
  });

  // Two at once, each check decided in its statements (ADR 0121): whatever order their round trips interleave in, one
  // goes and the other's told
  it.each(seeds(5))(
    "the last two who can do everything, one through Admin and one through a role of its own, stepping down at once leave one (seed %i)",
    async (seed) => {
      const { dana, reg, regId, roleId } = await regWith(["manage:all"], "Boss");
      const ada = await byName(dana, "Ada Admin");
      expect((await dana.call("PUT", `/api/members/${ada.id}`, { ...ada, roles: ["Member"] })).status).toBe(200);
      const regRow = (await members(reg)).find((m) => m.id === regId);
      w.db.interleave(seed);
      const replies = await Promise.all([
        reg.call("PUT", `/api/roles/${roleId}`, { name: "Boss", actions: [] }),
        dana.call("DELETE", "/api/me"),
        reg.call("PUT", `/api/members/${regId}`, { ...regRow, roles: ["Member"] }),
      ]);
      w.db.interleave(null);
      expect(canDoEverything()).toBe(1);
      expect(replies.filter((r) => r.status === 409).length).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(seeds(5))(
    "one member who can do everything through two roles, both taken off at once, keeps one (seed %i)",
    async (seed) => {
      const { dana, reg, regId, roleId: boss } = await regWith(["manage:all"], "Boss");
      const chief = (await dana.call("POST", "/api/roles", { name: "Chief", description: "", actions: ["manage:all"] }))
        .body.id as number;
      const regRow = (await members(reg)).find((m) => m.id === regId);
      expect((await dana.call("PUT", `/api/members/${regId}`, { ...regRow, roles: ["Boss", "Chief"] })).status).toBe(
        200,
      );
      const ada = await byName(dana, "Ada Admin");
      expect((await dana.call("PUT", `/api/members/${ada.id}`, { ...ada, roles: ["Member"] })).status).toBe(200);
      expect((await dana.call("DELETE", "/api/me")).status).toBe(200);
      w.db.interleave(seed);
      const replies = await Promise.all([
        reg.call("PUT", `/api/roles/${boss}`, { name: "Boss", actions: [] }),
        reg.call("PUT", `/api/roles/${chief}`, { name: "Chief", actions: [] }),
      ]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(canDoEverything()).toBe(1);
    },
  );
});
