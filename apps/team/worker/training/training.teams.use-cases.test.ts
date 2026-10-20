// Friday's teams (ADR 0076): only some people make them. Making and publishing teams is a role, Session lead, that an
// admin gives a member; everyone else sees the teams once they're out. Driven through the real Worker handlers
// (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Tess Teams", position: "F", rating: 60, email: "tess@example.com", roles: ["Session lead"] },
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Mo Member", position: "D", rating: 55, email: "mo@example.com" },
  { name: "Reg Player", position: "F", rating: 50, email: "reg@example.com" },
  { name: "Wes Waiting", position: "F", rating: 45, email: "wes@example.com" },
];

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

// The next Friday session, and two teams from whoever's on the roster
async function teamsFor(b: Awaited<ReturnType<typeof w.signedIn>>) {
  const boot = (await b.call("GET", "/api/bootstrap")).body;
  const session = boot.sessions.at(-1);
  const id = (name: string) => boot.members.find((m: { name: string }) => m.name === name).id;
  const [tess, mo] = [id("Tess Teams"), id("Mo Member")];
  return {
    session,
    teams: [
      { name: "Black", players: [tess] },
      { name: "White", players: [mo] },
    ],
  };
}

describe("making Friday's teams", () => {
  it("a team maker sees ratings, and publishes teams everyone then sees", async () => {
    const tess = await w.signedIn("tess@example.com");
    const boot = (await tess.call("GET", "/api/bootstrap")).body;
    expect(boot.actions).toEqual(expect.arrayContaining(["generate:Teams", "publish:Teams", "read:Rating"]));
    expect(boot.members.every((m: { rating?: number }) => typeof m.rating === "number")).toBe(true);
    const { session, teams } = await teamsFor(tess);
    expect((await tess.call("POST", `/api/sessions/${session.id}/teams`, { teams })).status).toBe(200);

    const mo = await w.signedIn("mo@example.com");
    const seen = (await mo.call("GET", "/api/bootstrap")).body.sessions.find(
      (s: { id: number }) => s.id === session.id,
    );
    expect(seen.teams.map((t: { name: string }) => t.name)).toEqual(["Black", "White"]);
  });

  // No drafts (ADR 0076): each move a team maker makes is saved as they make it, and everyone sees it
  it("a team maker moves a player and everyone sees it straight away", async () => {
    const tess = await w.signedIn("tess@example.com");
    const { session, teams } = await teamsFor(tess);
    await tess.call("POST", `/api/sessions/${session.id}/teams`, { teams });
    const [black, white] = teams;
    const moved = [
      { name: "Black", players: [] },
      { name: "White", players: [...white.players, ...black.players] },
    ];
    expect((await tess.call("POST", `/api/sessions/${session.id}/teams`, { teams: moved })).status).toBe(200);

    const mo = await w.signedIn("mo@example.com");
    const seen = (await mo.call("GET", "/api/bootstrap")).body.sessions.find(
      (s: { id: number }) => s.id === session.id,
    );
    expect(seen.teams).toEqual(moved);
  });

  it("a member can't make or publish them", async () => {
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("GET", "/api/bootstrap")).body.actions).not.toContain("publish:Teams");
    const { session, teams } = await teamsFor(mo);
    expect((await mo.call("POST", `/api/sessions/${session.id}/teams`, { teams })).status).toBe(403);
  });
});

describe("starting a session again", () => {
  const fridayOf = async (b: Awaited<ReturnType<typeof w.signedIn>>, id: number) =>
    (await b.call("GET", "/api/bootstrap")).body.sessions.find((s: { id: number }) => s.id === id);

  it("a team maker takes the teams down; the sign-ups stay", async () => {
    const tess = await w.signedIn("tess@example.com");
    const { session, teams } = await teamsFor(tess);
    await tess.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await tess.call("POST", `/api/sessions/${session.id}/teams`, { teams });
    expect((await tess.call("DELETE", `/api/sessions/${session.id}/teams`)).status).toBe(200);
    const after = await fridayOf(tess, session.id);
    expect(after.teams).toEqual([]);
    expect(after.going.length).toBe(1);
  });

  it("an admin resets it: nobody's in or waiting, and no teams", async () => {
    const dana = await w.signedIn("dana@example.com");
    const { session, teams } = await teamsFor(dana);
    await dana.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await dana.call("POST", `/api/sessions/${session.id}/teams`, { teams });
    expect((await dana.call("POST", `/api/sessions/${session.id}/reset`)).status).toBe(200);
    const after = await fridayOf(dana, session.id);
    expect(after.teams).toEqual([]);
    expect(after.going).toEqual([]);
    expect(after.waitlist).toEqual([]);
  });

  it("a member can do neither", async () => {
    const mo = await w.signedIn("mo@example.com");
    const { session } = await teamsFor(mo);
    expect((await mo.call("DELETE", `/api/sessions/${session.id}/teams`)).status).toBe(403);
    expect((await mo.call("POST", `/api/sessions/${session.id}/reset`)).status).toBe(403);
  });
});

// The team maker's two jobs on Friday's page (ADR 0076): Make teams, and Clear teams when they want to start again.
// Members on the page see either at once, without a refresh: the change reaches their open stream (ADR 0072)
describe("the team maker makes the teams, then clears them, with everyone watching", () => {
  const fridayOf = async (b: Awaited<ReturnType<typeof w.signedIn>>, id: number) =>
    (await b.call("GET", "/api/bootstrap")).body.sessions.find((s: { id: number }) => s.id === id);

  it("a member watching the page hears the teams come out", async () => {
    const tess = await w.signedIn("tess@example.com");
    const { session, teams } = await teamsFor(tess);
    const moPhone = await w.listening("mo@example.com");
    expect((await tess.call("POST", `/api/sessions/${session.id}/teams`, { teams })).status).toBe(200);
    expect((await moPhone.next()).data.changed).toContain("sessions");
    expect((await fridayOf(moPhone, session.id)).teams.map((t: { name: string }) => t.name)).toEqual([
      "Black",
      "White",
    ]);
    await moPhone.close();
  });

  it("the team maker clears the teams: everyone's back to unassigned, it's on the record, and phones hear it", async () => {
    const tess = await w.signedIn("tess@example.com");
    const { session, teams } = await teamsFor(tess);
    await tess.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await tess.call("POST", `/api/sessions/${session.id}/teams`, { teams });
    const moPhone = await w.listening("mo@example.com");

    expect((await tess.call("DELETE", `/api/sessions/${session.id}/teams`)).status).toBe(200);
    expect((await moPhone.next()).data.changed).toContain("sessions");
    const after = await fridayOf(moPhone, session.id);
    expect(after.teams).toEqual([]);
    expect(after.going.length).toBe(1);

    const tessId = (await tess.call("GET", "/api/bootstrap")).body.members.find(
      (m: { name: string }) => m.name === "Tess Teams",
    ).id;
    const record = w.db.raw
      .prepare("SELECT member_id memberId FROM audit_log WHERE action = 'teams.removed'")
      .all() as { memberId: number }[];
    expect(record).toEqual([{ memberId: tessId }]);
    await moPhone.close();
  });

  it("a member can't clear them, and the teams stay", async () => {
    const tess = await w.signedIn("tess@example.com");
    const { session, teams } = await teamsFor(tess);
    await tess.call("POST", `/api/sessions/${session.id}/teams`, { teams });
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("DELETE", `/api/sessions/${session.id}/teams`)).status).toBe(403);
    expect((await fridayOf(mo, session.id)).teams.length).toBe(2);
  });
});

// Spaces are what members see and what sign-up keeps to (ADR 0030), but on the night the team maker can let someone
// waiting in anyway, over the limit (ADR 0076). The one let in hears it on their phone, as when a place comes up.
describe("the team maker lets someone in from the waiting list", () => {
  /** Next Friday, room for two: Mo and Reg are in, Wes is waiting, and Wes has the app on his phone. */
  async function fullFriday() {
    const dana = await w.signedIn("dana@example.com");
    const boot = (await dana.call("GET", "/api/bootstrap")).body;
    const series = boot.series[0];
    expect((await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 2 })).status).toBe(200);
    const id = (name: string) => boot.members.find((m: { name: string }) => m.name === name).id as number;
    const session = (await dana.call("GET", "/api/bootstrap")).body.sessions.find(
      (s: { heldOn: string }) => s.heldOn >= "2026-10-06",
    );
    const wes = await w.signedIn("wes@example.com");
    expect((await wes.call("PUT", "/api/auth/device", { token: "wes-phone", platform: "ios" })).status).toBe(200);
    for (const email of ["mo@example.com", "reg@example.com", "wes@example.com"])
      expect(
        (await (await w.signedIn(email)).call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" })).status,
      ).toBe(200);
    const seen = async () =>
      (await (await w.signedIn("mo@example.com")).call("GET", "/api/bootstrap")).body.sessions.find(
        (s: { id: number }) => s.id === session.id,
      );
    const letIn = async (email: string, memberId: number) =>
      (await (await w.signedIn(email)).call("POST", `/api/sessions/${session.id}/let-in`, { memberId })).status;
    return { session, seen, letIn, mo: id("Mo Member"), reg: id("Reg Player"), wes: id("Wes Waiting") };
  }

  it("lets Wes in over the limit: he's in, in his sign-up place, nobody's waiting, and his phone hears it", async () => {
    const f = await fullFriday();
    expect((await f.seen()).waitlist).toEqual([f.wes]);
    w.pushes.length = 0;

    expect(await f.letIn("tess@example.com", f.wes)).toBe(200);

    const after = await f.seen();
    expect(after.going).toEqual([f.mo, f.reg, f.wes]);
    expect(after.waitlist).toEqual([]);
    expect(w.pushes).toEqual([
      expect.objectContaining({ token: "wes-phone", title: "You're in", path: "/training/friday" }),
    ]);
    const record = w.db.raw.prepare("SELECT action FROM audit_log WHERE action = 'signups.changed'").all();
    expect(record).toHaveLength(1);
  });

  it("the limit still holds for everyone else: someone new waits, and one dropping out doesn't let them in", async () => {
    const f = await fullFriday();
    expect(await f.letIn("tess@example.com", f.wes)).toBe(200);
    const dana = await w.signedIn("dana@example.com");
    const dee = (await dana.call("GET", "/api/bootstrap")).body.members.find(
      (m: { name: string }) => m.name === "Dana Admin",
    ).id;
    expect((await dana.call("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" })).status).toBe(200);
    expect((await f.seen()).waitlist).toEqual([dee]);

    // Three in for two places: Mo going out leaves two, still no room, so Dana waits on
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("POST", `/api/sessions/${f.session.id}/answer`, { answer: "out" })).status).toBe(200);
    let after = await f.seen();
    expect(after.going).toEqual([f.reg, f.wes]);
    expect(after.waitlist).toEqual([dee]);

    // Reg going out leaves one: now there's a place, and Dana moves up
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/sessions/${f.session.id}/answer`, { answer: "out" })).status).toBe(200);
    after = await f.seen();
    expect(after.going).toEqual([f.wes, dee]);
    expect(after.waitlist).toEqual([]);
  });

  it("only someone waiting can be let in", async () => {
    const f = await fullFriday();
    expect(await f.letIn("tess@example.com", f.mo)).toBe(409);
    const dana = (await (await w.signedIn("dana@example.com")).call("GET", "/api/bootstrap")).body.members.find(
      (m: { name: string }) => m.name === "Dana Admin",
    ).id;
    expect(await f.letIn("tess@example.com", dana)).toBe(409);
  });

  it("a member can't let anyone in", async () => {
    const f = await fullFriday();
    expect(await f.letIn("mo@example.com", f.wes)).toBe(403);
    expect(await f.letIn("wes@example.com", f.wes)).toBe(403);
    expect((await f.seen()).waitlist).toEqual([f.wes]);
  });
});
