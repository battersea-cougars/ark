// Members at the edges: names the bank can't spell, emails in capitals, two people of the same name, a role nobody
// has heard of, and a member who goes while they still have places on what's to come. Driven through the real
// handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
  { name: "Wes Waiting", position: "D", rating: 50, email: "wes@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const one = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) => w.db.raw.prepare(sql).get(...p) as T;

async function admin() {
  const b = await w.signedIn("dana@example.com");
  const sees = async () => (await b.call("GET", "/api/bootstrap")).body as Json;
  const member = async (name: string) => (await sees()).members.find((m: Json) => m.name === name);
  const add = (o: Record<string, unknown>) => b.call("POST", "/api/members", { position: "F", ...o });
  return { call: b.call, sees, member, add };
}

describe("an admin adds a member, at the edges", () => {
  it("an email typed in capitals is kept in small letters, and the member signs in with either", async () => {
    const dana = await admin();
    const r = await dana.add({ name: "Cara Caps", email: "  Cara.Caps@Example.COM " });
    expect(r.status).toBe(201);
    expect(one("SELECT email FROM members WHERE id = ?", r.body.id)).toEqual({ email: "cara.caps@example.com" });
    expect((await w.ask(w.browser(), "CARA.CAPS@example.com")).devCode).toMatch(/^\d{6}$/);
  });

  it("two people of the same name get references of their own: the second takes a 2", async () => {
    const dana = await admin();
    const first = await dana.add({ name: "Adrian Kaczmarczyk", email: "adrian1@example.com" });
    const second = await dana.add({ name: "Adrian Kowalski", email: "adrian2@example.com" });
    const ref = (id: number) => one<{ r: string }>("SELECT payment_reference r FROM members WHERE id = ?", id).r;
    expect(ref(first.body.id)).toBe("COUGARS ADRIAN K");
    expect(ref(second.body.id)).toBe("COUGARS ADRIAN K2");
  });

  it("a name in another script or emoji is kept as typed, and the reference is still one a bank takes", async () => {
    const dana = await admin();
    for (const [name, email] of [
      ["Søren Ødegård", "soren@example.com"],
      ["Łukasz Żółć", "lukasz@example.com"],
      ["Mia 🏒 Puck", "mia@example.com"],
    ]) {
      const r = await dana.add({ name, email });
      expect(r.status).toBe(201);
      const row = one<{ name: string; ref: string }>(
        "SELECT name, payment_reference ref FROM members WHERE id = ?",
        r.body.id,
      );
      expect(row.name).toBe(name);
      expect(row.ref).toMatch(/^[A-Z0-9 ]{1,18}$/);
    }
    expect(one("SELECT payment_reference r FROM members WHERE email = 'lukasz@example.com'")).toEqual({
      r: "COUGARS LUKASZ Z",
    });
  });

  it("a very long first name still makes a reference short enough for a UK bank (18 characters)", async () => {
    const dana = await admin();
    const r = await dana.add({ name: "Bartholomew-Maximilian Featherstonehaugh", email: "bart@example.com" });
    const ref = one<{ r: string }>("SELECT payment_reference r FROM members WHERE id = ?", r.body.id).r;
    expect(ref.length).toBeLessThanOrEqual(18);
    expect(ref).toMatch(/^COUGARS BARTHOL F$/);
  });

  it("without a name, an email or a position, nobody is added, and nothing is sent", async () => {
    const dana = await admin();
    expect((await dana.add({ email: "x@example.com" })).status).toBe(400);
    expect((await dana.add({ name: "No Email" })).status).toBe(400);
    expect((await dana.call("POST", "/api/members", { name: "No Position", email: "np@example.com" })).status).toBe(
      400,
    );
    expect((await dana.add({ name: "Wrong Position", email: "wp@example.com", position: "C" })).status).toBe(400);
    expect((await dana.add({ name: ["A list"], email: "list@example.com" })).status).toBe(400);
    expect(w.mails).toHaveLength(0);
  });

  // https://github.com/battersea-cougars/ark/issues/133
  // #133: text() checked for an empty name before trimming it, so "   " went through as ""
  it("a name of only spaces is refused, like no name (#133)", async () => {
    const dana = await admin();
    expect((await dana.add({ name: "   ", email: "blank@example.com" })).status).toBe(400);
  });
});

describe("an admin edits a member, at the edges", () => {
  it("a role nobody has heard of is refused and changes nothing", async () => {
    const dana = await admin();
    const reg = await dana.member("Reg Player");
    const r = await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, rating: 99, roles: ["Member", "Wizard"] });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("Wizard");
    expect((await dana.member("Reg Player")).rating).toBe(60);
  });

  it("a rating from 0 to 100 is fine; 101, -1 or 7.5 is refused", async () => {
    const dana = await admin();
    const reg = await dana.member("Reg Player");
    const put = (rating: unknown) => dana.call("PUT", `/api/members/${reg.id}`, { ...reg, rating });
    expect((await put(0)).status).toBe(200);
    expect((await put(100)).status).toBe(200);
    for (const bad of [101, -1, 7.5, "60", null]) expect((await put(bad)).status, String(bad)).toBe(400);
  });

  it("someone who isn't in the club is a 404, for an edit, their email, attendance or deleting them", async () => {
    const dana = await admin();
    const reg = await dana.member("Reg Player");
    expect((await dana.call("PUT", "/api/members/9999", reg)).status).toBe(404);
    expect((await dana.call("PUT", "/api/members/9999/contact", { email: "x@example.com" })).status).toBe(404);
    expect((await dana.call("GET", "/api/members/9999/attendance")).status).toBe(404);
    expect((await dana.call("DELETE", "/api/members/9999")).status).toBe(404);
  });

  it("an email another member has, in other capitals, is refused; a blank one leaves them none", async () => {
    const dana = await admin();
    const paul = await dana.member("Paul Payg");
    const taken = await dana.call("PUT", `/api/members/${paul.id}/contact`, { email: "Reg@Example.com" });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toContain("Reg Player");
    expect((await dana.call("PUT", `/api/members/${paul.id}/contact`, { email: "" })).status).toBe(200);
    expect(one("SELECT email FROM members WHERE id = ?", paul.id)).toEqual({ email: null });
    // With no email there's no way to sign in, and no code for the old one
    expect((await w.ask(w.browser(), "paul@example.com")).devCode).toBeUndefined();
  });

  it("an attendance year that isn't a year is refused", async () => {
    const dana = await admin();
    const reg = await dana.member("Reg Player");
    expect((await dana.call("GET", `/api/members/${reg.id}/attendance?year=26`)).status).toBe(400);
    expect((await dana.call("GET", `/api/members/${reg.id}/attendance?year=2026`)).status).toBe(200);
  });
});

describe("roles, at the edges", () => {
  it("a role named like one there is already is refused; a role needs a name and a list of known actions", async () => {
    const dana = await admin();
    const role = (o: Record<string, unknown>) =>
      dana.call("POST", "/api/roles", { name: "Door", description: "", actions: ["record:Attendance"], ...o });
    expect((await role({})).status).toBe(201);
    expect((await role({})).status).toBe(409);
    expect((await role({ name: "Member" })).status).toBe(409);
    expect((await role({ name: "" })).status).toBe(400);
    expect((await role({ name: "Bad", actions: ["fly:Kite"] })).status).toBe(400);
    expect((await role({ name: "Bad", actions: "record:Attendance" })).status).toBe(400);
    expect((await role({ name: "A".repeat(41) })).status).toBe(400);
  });

  it("an action ticked twice is kept once", async () => {
    const dana = await admin();
    const r = await dana.call("POST", "/api/roles", {
      name: "Door",
      actions: ["record:Attendance", "record:Attendance"],
    });
    expect(r.status).toBe(201);
    expect(one("SELECT count(*) n FROM role_actions WHERE role_id = ?", r.body.id)).toEqual({ n: 1 });
  });

  it("renaming a role to another's name is refused; a role that isn't there is a 404", async () => {
    const dana = await admin();
    const r = await dana.call("POST", "/api/roles", { name: "Door", actions: [] });
    expect((await dana.call("PUT", `/api/roles/${r.body.id}`, { name: "Member", actions: [] })).status).toBe(409);
    expect((await dana.call("PUT", "/api/roles/9999", { name: "Ghost", actions: [] })).status).toBe(404);
  });
});

describe("a member who goes while they still have places on what's to come", () => {
  /** Next Friday with room for one skater: Reg in, Wes waiting. */
  async function fullFriday() {
    const dana = await admin();
    const b = await dana.sees();
    const series = b.series[0];
    expect((await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 1 })).status).toBe(200);
    const friday = (await dana.sees()).sessions.find((s: Json) => s.heldOn >= "2026-10-06");
    const answer = async (email: string) =>
      (await w.signedIn(email)).call("POST", `/api/sessions/${friday.id}/answer`, { answer: "in" });
    expect((await answer("reg@example.com")).status).toBe(200);
    expect((await answer("wes@example.com")).status).toBe(200);
    const signup = (name: string) =>
      one<{ s: string } | undefined>(
        "SELECT a.signup s FROM attendance a JOIN members m ON m.id = a.member_id WHERE a.session_id = ? AND m.name = ?",
        friday.id,
        name,
      )?.s;
    expect([signup("Reg Player"), signup("Wes Waiting")]).toEqual(["in", "waitlist"]);
    return { dana, friday, signup };
  }

  it("saying out gives the place to the first one waiting (as it should for deleting the account, below)", async () => {
    const { friday, signup } = await fullFriday();
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/sessions/${friday.id}/answer`, { answer: "out" })).status).toBe(200);
    expect(signup("Wes Waiting")).toBe("in");
  });

  // https://github.com/battersea-cougars/ark/issues/137
  // #137: deleting an account deleted its places for what's to come straight from the table, without the move-up
  // that saying out does, so Friday had a free place and the first waiting still waited
  it("a member in for a full Friday deletes their account, and the first one waiting moves up (#137)", async () => {
    const { signup } = await fullFriday();
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("DELETE", "/api/me")).status).toBe(200);
    expect(signup("Wes Waiting")).toBe("in");
  });

  // https://github.com/battersea-cougars/ark/issues/137
  // #137: the same when an admin deletes the account for them
  it("an admin deletes the account of a member in for a full Friday, and the first one waiting moves up (#137)", async () => {
    const { dana, signup } = await fullFriday();
    const reg = await dana.member("Reg Player");
    expect((await dana.call("DELETE", `/api/members/${reg.id}`)).status).toBe(200);
    expect(signup("Wes Waiting")).toBe("in");
  });

  // https://github.com/battersea-cougars/ark/issues/138
  // Known bug #138: their entry for a tournament still to come goes, but their place on its team stays, as
  // "Former member" in the lineup
  it.fails(
    "a member on a team for a tournament still to come deletes their account, and comes off the team (known bug #138)",
    async () => {
      const dana = await admin();
      const reg = await dana.member("Reg Player");
      const paul = await dana.member("Paul Payg");
      const cup = await dana.call("POST", "/api/tournaments", {
        typeId: null,
        kind: "teams",
        name: "Charity Cup",
        location: "",
        heldOn: "2027-03-20",
        startTime: "10:00",
        endTime: "15:00",
        capacity: null,
        status: "open",
        feePence: 0,
        teams: [{ name: "Cougars B", logo: null, captainMemberId: paul.id, players: [{ memberId: reg.id }] }],
      });
      expect(cup.status).toBe(201);
      const onTeam = () =>
        one<{ n: number }>("SELECT count(*) n FROM tournament_team_players WHERE member_id = ?", reg.id).n;
      expect(onTeam()).toBe(1);
      expect((await (await w.signedIn("reg@example.com")).call("DELETE", "/api/me")).status).toBe(200);
      expect(onTeam()).toBe(0);
    },
  );

  it("a member who played and paid last month deletes their account: the money and the night stay, about nobody", async () => {
    const dana = await admin();
    const reg = await dana.member("Reg Player");
    w.db.raw
      .prepare(
        "INSERT INTO payments (member_id, amount_pence, received_on, via, created_at) VALUES (?, 1200, '2026-09-04', 'bank', '2026-09-04T12:00:00Z')",
      )
      .run(reg.id);
    expect((await dana.call("DELETE", `/api/members/${reg.id}`)).status).toBe(200);
    expect(one("SELECT count(*) n FROM payments WHERE member_id = ?", reg.id)).toEqual({ n: 1 });
    // Asked again, it's already done: no second erasing
    expect((await dana.call("DELETE", `/api/members/${reg.id}`)).status).toBe(404);
  });
});

describe("an admin imports a file, at the edges", () => {
  const check = async (file: unknown) => (await admin()).call("POST", "/api/members/import", { file });

  it("a file with only its header row, an empty file, or no file at all is refused, saying why", async () => {
    expect((await check("name,email,position")).body.error).toMatch(/nobody in that file/);
    expect((await check("   ")).status).toBe(400);
    expect((await check(undefined)).status).toBe(400);
    expect((await check(42)).status).toBe(400);
  });

  it("JSON that isn't a list, or isn't JSON, is refused; a null among the players is a row with no name", async () => {
    expect((await check('{"name":"Nina"}')).status).toBe(400);
    expect((await check("[{")).body.error).toMatch(/isn't valid JSON/);
    const r = await check('[null, {"name": "Nina New", "email": "nina@example.com"}]');
    expect(r.status).toBe(200);
    expect(r.body.problems).toEqual([{ row: 1, name: "", why: "A name is needed" }]);
  });

  it("someone in the club whose email the file writes in capitals is in already, not added twice", async () => {
    const r = await check("name,email\nRegina Player,REG@EXAMPLE.COM");
    expect(r.body.add).toEqual([]);
    expect(r.body.skip).toEqual([{ row: 2, name: "Regina Player", why: "Already in the club" }]);
  });

  it("the same email twice in the file, in different capitals, is a problem on the second row", async () => {
    const r = await check("name,email\nNina New,nina@example.com\nNina Again,NINA@example.com");
    expect(r.body.problems).toEqual([expect.objectContaining({ row: 3, name: "Nina Again" })]);
  });

  it("a name of 80 letters is fine and 81 is a problem; a name in emoji is fine", async () => {
    const r = await check(`name\n${"A".repeat(80)}\n${"B".repeat(81)}\n🏒 Puck`);
    expect(r.body.add.map((p: Json) => p.name)).toEqual(["A".repeat(80), "🏒 Puck"]);
    expect(r.body.problems).toEqual([expect.objectContaining({ row: 3 })]);
  });

  it("a file over half a megabyte is refused before it's read", async () => {
    const r = await check(`name\n${"x".repeat(500_001)}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/too big/);
  });
});
