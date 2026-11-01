// A member can delete their account, or ask an admin to (#30, ADR 0029): everything that says who they are goes, now,
// and they're signed out everywhere. What the club must keep (a payment, that someone played last Friday) stays,
// about a "Former member" nobody can name. A member can also download everything the app holds about them. Driven
// through the real handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Gil Goalie", position: "G", rating: 55, email: "gil@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const one = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) => w.db.raw.prepare(sql).get(...p) as T;
const count = (sql: string, ...p: unknown[]) => one<{ n: number }>(sql, ...p).n;
const idOf = (name: string) => one<{ id: number }>("SELECT id FROM members WHERE name = ?", name).id;

/** Reg's history: last Friday played and paid for, next Friday signed up for, a phone and a bio. */
async function regWithHistory() {
  const reg = await w.signedIn("reg@example.com");
  expect((await reg.call("PUT", "/api/me", { position: "F", phone: "07700 900123", bio: "Fast skater" })).status).toBe(
    200,
  );
  const id = idOf("Reg Player");
  // Friday Training's sessions, there already or made now
  const session = (heldOn: string) => {
    w.db.raw.prepare("INSERT OR IGNORE INTO training_sessions (series_id, held_on) VALUES (1, ?)").run(heldOn);
    return one<{ id: number }>("SELECT id FROM training_sessions WHERE series_id = 1 AND held_on = ?", heldOn).id;
  };
  const last = session("2026-10-02");
  const next = session("2026-10-16");
  for (const s of [last, next])
    w.db.raw
      .prepare("INSERT INTO attendance (session_id, member_id, signup, signed_up_at) VALUES (?, ?, 'in', ?)")
      .run(s, id, NOW.toISOString());
  w.db.raw
    .prepare(
      "INSERT INTO payments (member_id, amount_pence, received_on, via, created_at) VALUES (?, 1200, '2026-10-02', 'bank', ?)",
    )
    .run(id, NOW.toISOString());
  return { reg, id, last, next };
}

describe("a member deletes their account", () => {
  it("everything that says who they are goes, and the club keeps that someone played and paid", async () => {
    const { reg, id, last, next } = await regWithHistory();
    expect((await reg.call("DELETE", "/api/me")).status).toBe(200);

    expect(
      one("SELECT name, email, phone, bio, web_name, photo, payment_reference, status FROM members WHERE id = ?", id),
    ).toEqual({
      name: "Former member",
      email: null,
      phone: null,
      bio: "",
      web_name: null,
      photo: null,
      payment_reference: null,
      status: "erased",
    });
    expect(count("SELECT count(*) n FROM member_roles WHERE member_id = ?", id)).toBe(0);
    // Last Friday still counts, and the money's still in the club's accounts; next Friday's place is given up
    expect(count("SELECT count(*) n FROM attendance WHERE member_id = ? AND session_id = ?", id, last)).toBe(1);
    expect(count("SELECT count(*) n FROM attendance WHERE member_id = ? AND session_id = ?", id, next)).toBe(0);
    expect(count("SELECT count(*) n FROM payments WHERE member_id = ?", id)).toBe(1);
  });

  it("signs them out on every device, and their email can't sign in any more", async () => {
    const { reg } = await regWithHistory();
    const phone = await w.signedIn("reg@example.com");
    await reg.call("DELETE", "/api/me");
    expect((await phone.club()).status).toBe(401);
    expect((await reg.club()).status).toBe(401);
    await expect(w.signedIn("reg@example.com")).rejects.toThrow();
    expect(count("SELECT count(*) n FROM auth_sessions WHERE member_id = ?", idOf("Former member"))).toBe(0);
  });

  it("they're gone from everyone's roster", async () => {
    await (await regWithHistory()).reg.call("DELETE", "/api/me");
    const gil = await w.signedIn("gil@example.com");
    const names = (await gil.club()).body.members.map((m: { name: string }) => m.name);
    expect(names).not.toContain("Reg Player");
    expect(names).not.toContain("Former member");
  });

  it("goes on the record without their email, and earlier entries stop naming it", async () => {
    const { reg, id } = await regWithHistory();
    w.db.raw
      .prepare("INSERT INTO audit_log (at, member_id, action, detail) VALUES (?, ?, 'member.updated', ?)")
      .run(NOW.toISOString(), id, JSON.stringify({ before: { email: "reg@example.com" }, memberId: id }));
    await reg.call("DELETE", "/api/me");
    const log = w.db.raw.prepare("SELECT action, detail FROM audit_log").all() as { action: string; detail: string }[];
    expect(log.map((e) => e.action)).toContain("member.erased");
    expect(JSON.stringify(log)).not.toMatch(/reg@example\.com|Reg Player|07700/);
  });

  it("the club's last admin can't, until someone else is one", async () => {
    const dana = await w.signedIn("dana@example.com");
    const r = await dana.call("DELETE", "/api/me");
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/last admin/);
    expect(one("SELECT status FROM members WHERE id = ?", idOf("Dana Admin"))).toEqual({ status: "active" });
  });
});

describe("an admin erases a member who asked", () => {
  it("the same as if they'd done it themselves", async () => {
    const { reg } = await regWithHistory();
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("DELETE", `/api/members/${idOf("Reg Player")}`)).status).toBe(200);
    expect((await reg.club()).status).toBe(401);
    expect(count("SELECT count(*) n FROM members WHERE email = 'reg@example.com'")).toBe(0);
  });

  it("a member can't erase someone else", async () => {
    const gil = await w.signedIn("gil@example.com");
    expect((await gil.call("DELETE", `/api/members/${idOf("Reg Player")}`)).status).toBe(403);
    expect(one("SELECT status FROM members WHERE id = ?", idOf("Reg Player"))).toEqual({ status: "active" });
  });

  it("a member manager can't erase an admin: they can do things the manager can't", async () => {
    w.db.raw.exec(`INSERT INTO roles (id, name, description, is_system) VALUES (9, 'Helper', 'Members', 0);
      INSERT INTO role_actions (role_id, action) VALUES (9, 'manage:Member');
      INSERT INTO member_roles (member_id, role_id) SELECT id, 9 FROM members WHERE email = 'gil@example.com';
      INSERT INTO member_roles (member_id, role_id) SELECT m.id, r.id FROM members m, roles r
        WHERE email = 'reg@example.com' AND r.name = 'Admin';`);
    const gil = await w.signedIn("gil@example.com");
    // Two admins, so the last-admin rule isn't what stops it
    expect((await gil.call("DELETE", `/api/members/${idOf("Dana Admin")}`)).status).toBe(403);
    expect(one("SELECT status FROM members WHERE id = ?", idOf("Dana Admin"))).toEqual({ status: "active" });
    // ...while someone who can do no more than them is theirs to erase
    w.db.raw.exec(`DELETE FROM member_roles WHERE member_id = (SELECT id FROM members WHERE email = 'reg@example.com')
      AND role_id = (SELECT id FROM roles WHERE name = 'Admin')`);
    expect((await gil.call("DELETE", `/api/members/${idOf("Reg Player")}`)).status).toBe(200);
  });

  it("someone already erased stays as they are", async () => {
    const dana = await w.signedIn("dana@example.com");
    const id = idOf("Reg Player");
    await dana.call("DELETE", `/api/members/${id}`);
    expect((await dana.call("DELETE", `/api/members/${id}`)).status).toBe(404);
  });
});

describe("a member downloads their data", () => {
  it("gets everything the app holds about them, and nobody else's", async () => {
    const { reg } = await regWithHistory();
    const r = await reg.call("GET", "/api/me/data");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="cougars-my-data-2026-10-06\.json"/);
    expect(r.body.profile).toMatchObject({ name: "Reg Player", email: "reg@example.com", phone: "07700 900123" });
    expect(r.body.training.map((a: { heldOn: string }) => a.heldOn)).toEqual(["2026-10-02", "2026-10-16"]);
    expect(r.body.payments).toEqual([expect.objectContaining({ amountPence: 1200, receivedOn: "2026-10-02" })]);
    expect(r.body.devices.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(/dana@example\.com|gil@example\.com|Gil Goalie/);
  });
});
