// Each page's data when it's opened, not the whole club (#178, ADR 0053). Opening the app sends a small core: who you
// are and what you may do, the club's settings and menus, and what Home needs (your next things, the announcements,
// what you owe). The rest is each page's own, asked for when it's opened, in one request: the whole roster, the weeks
// just held, each series' last one played, everyone's dues. Asked again with its tag while that part is unchanged,
// it's an empty 304, even when the club has changed elsewhere. What's the same for everyone who sees the club alike is
// read from D1 once and kept at the edge, keyed by its part's version and what they may see; what's someone's own is
// read for them each time, so it never reaches anyone else. Driven through the real Worker handlers (ADR 0031).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld, type Reply } from "../testing";
import { clubWithHistory } from "./bootstrap.testing";
import { OWN, partsSql } from "./api.club";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Lee Lead", position: "F", rating: 60, email: "lee@example.com", roles: ["Session lead"] },
  ...["Ash", "Bo", "Cy", "Di", "Ed", "Flo"].map((name) => ({
    name: `${name} Player`,
    position: "F",
    rating: 50,
    email: `${name.toLowerCase()}@example.com`,
  })),
];

/** What opening the app sends: who you are, the club's settings and menus, and Home's. */
const CORE = [
  "me",
  "viewingAs",
  "actions",
  "devTools",
  "unfinished",
  "simulator",
  "everydayRole",
  "people",
  "roles",
  "venues",
  "series",
  "sessions",
  "tournamentTypes",
  "tournaments",
  "clubEvents",
  "charges",
  "dues",
  "subscriptionFees",
  "quips",
  "announcements",
  "settings",
  "notifications",
  "forAdmins",
  "agenda",
];

/** The SQL a request sent D1, whole. */
async function sqlOf(w: ReturnType<typeof testWorld>, request: () => Promise<Reply>) {
  const sent: string[] = [];
  w.db.onRoundTrip = (sql) => void sent.push(...sql);
  const reply = await request();
  w.db.onRoundTrip = null;
  return { reply, read: (table: string) => sent.some((sql) => sql.includes(table)) };
}

describe("opening the app", () => {
  let w: ReturnType<typeof testWorld>;
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    w = testWorld(ROSTER);
  });

  it("sends the core only: the roster, the weeks just held, last Kumites and everyone's dues are each page's own", async () => {
    const dana = await w.signedIn("dana@example.com");
    const boot = (await dana.call("GET", "/api/bootstrap")).body;
    expect(Object.keys(boot).sort()).toEqual([...CORE].sort());
    for (const page of ["members", "pastSessions", "lastPlayed", "clubDues", "reminders"])
      expect(boot[page]).toBe(undefined);
  });

  it("names the people Home shows: you, whoever's in your next things, and who you really are while viewing as someone", async () => {
    const dana = await w.signedIn("dana@example.com");
    const ash = await w.signedIn("ash@example.com");
    const boot = (await dana.call("GET", "/api/bootstrap")).body;
    const friday = boot.sessions.find((s: Json) => s.heldOn >= "2026-10-06");
    expect((await ash.call("POST", `/api/sessions/${friday.id}/answer`, { answer: "in" })).status).toBe(200);
    const bo = await w.signedIn("bo@example.com");
    const seen = (await bo.call("GET", "/api/bootstrap")).body;
    expect(seen.people.map((p: Json) => p.name).sort()).toEqual(["Ash Player", "Bo Player"]);
    // Your own row in full; anyone else's, their name and what a card shows, nothing private
    const own = seen.people.find((p: Json) => p.name === "Bo Player");
    expect(own.email).toBe("bo@example.com");
    const other = seen.people.find((p: Json) => p.name === "Ash Player");
    expect(other).toMatchObject({ email: null, phone: null, paymentReference: null });
    // Viewing as Bo, Dana is still named (the app says who's really signed in)
    const boId = own.id;
    expect((await dana.call("PUT", "/api/me/view-as", { memberId: boId })).status).toBe(200);
    const viewing = (await dana.call("GET", "/api/bootstrap")).body;
    expect(viewing.people.map((p: Json) => p.name).sort()).toEqual(["Ash Player", "Bo Player", "Dana Admin"]);
    expect(viewing.people.find((p: Json) => p.name === "Dana Admin").email).toBe(null);
  });

  it("tells an admin on Home what the club is owed in all, without sending everyone's dues", async () => {
    const dana = await w.signedIn("dana@example.com");
    const ids = (w.db.raw.prepare("SELECT id FROM members ORDER BY id").all() as { id: number }[]).map((m) => m.id);
    const charge = (member: number, pence: number, due: string) =>
      w.db.raw
        .prepare("INSERT INTO charges (member_id, reason, amount_pence, due_on, created_at) VALUES (?, 'Kit', ?, ?, ?)")
        .run(member, pence, due, "2026-01-01T00:00:00Z");
    charge(ids[2], 800, "2026-10-01");
    charge(ids[3], 1600, "2026-01-01");
    w.db.raw.prepare("UPDATE data_version SET version = version + 1").run();
    const after = (await dana.call("GET", "/api/bootstrap")).body;
    expect(after.dues).toEqual([]);
    expect(after.forAdmins.owed).toEqual({ total: 2400, people: 2, worst: 1600 });
    const ashBoot = (await (await w.signedIn("ash@example.com")).call("GET", "/api/bootstrap")).body;
    expect(ashBoot.forAdmins.owed).toBe(null);
  });
});

describe("a page's own data", () => {
  let w: ReturnType<typeof testWorld>;
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    w = testWorld(ROSTER);
  });
  const page = (b: Awaited<ReturnType<typeof w.signedIn>>, names: string, tag?: string | null) =>
    b.call("GET", `/api/slices?names=${names}`, undefined, tag ? { headers: { "if-none-match": tag } } : {});

  it("is one request, as this member may see it", async () => {
    const dana = await w.signedIn("dana@example.com");
    const ash = await w.signedIn("ash@example.com");
    const admin = await page(dana, "members,clubDues,reminders");
    expect(admin.status).toBe(200);
    expect(admin.body.slices.members.map((m: Json) => m.name)).toContain("Flo Player");
    expect(admin.body.slices.members.find((m: Json) => m.name === "Flo Player").email).toBe("flo@example.com");
    const member = await page(ash, "members");
    const flo = member.body.slices.members.find((m: Json) => m.name === "Flo Player");
    expect(flo.email).toBe(null);
    // Someone else's private details never come, even for the roster everyone of their role shares
    expect(member.body.slices.members.find((m: Json) => m.name === "Ash Player").email).toBe(null);
  });

  it("asked again unchanged is an empty 304, even after a change to another part of the club", async () => {
    const dana = await w.signedIn("dana@example.com");
    const ash = await w.signedIn("ash@example.com");
    // The day's first open makes the day's sessions, and with them everything's new: before the page is read
    const boot = (await dana.call("GET", "/api/bootstrap")).body;
    const first = await page(ash, "members,lastPlayed");
    const tag = first.headers.get("etag");
    expect(tag).toBeTruthy();
    expect((await page(ash, "members,lastPlayed", tag)).status).toBe(304);
    // A tap on Friday changes the night, not the roster nor last year's Kumite
    const friday = boot.sessions.find((s: Json) => s.heldOn >= "2026-10-06");
    expect((await dana.call("POST", `/api/sessions/${friday.id}/answer`, { answer: "in" })).status).toBe(200);
    expect((await page(ash, "members,lastPlayed", tag)).status).toBe(304);
    // A new member is a new roster
    expect(
      (
        await dana.call("POST", "/api/members", {
          name: "Gil New",
          email: "gil@example.com",
          position: "F",
          emailThem: false,
        })
      ).status,
    ).toBe(201);
    const changed = await page(ash, "members,lastPlayed", tag);
    expect(changed.status).toBe(200);
    expect(changed.body.slices.members.map((m: Json) => m.name)).toContain("Gil New");
  });

  it("is new after a change made outside the app (a script that only moves the data version on)", async () => {
    const ash = await w.signedIn("ash@example.com");
    const tag = (await page(ash, "members")).headers.get("etag");
    w.db.raw.prepare("UPDATE members SET name = 'Flo Renamed' WHERE email = 'flo@example.com'").run();
    w.db.raw.prepare("UPDATE data_version SET version = version + 1").run();
    const again = await page(ash, "members", tag);
    expect(again.status).toBe(200);
    expect(again.body.slices.members.map((m: Json) => m.name)).toContain("Flo Renamed");
  });

  it("has someone asking to join on the roster at once, though they asked at sign-in, not through a page", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await page(dana, "members")).status).toBe(200);
    const asked = await w
      .browser()
      .call("POST", "/api/auth/request", { name: "Jo New", email: "jo@example.com", position: "F" });
    expect(asked.status).toBeLessThan(300);
    const roster = (await page(dana, "members")).body.slices.members;
    expect(roster.find((m: Json) => m.name === "Jo New")?.status).toBe("pending");
    expect((await dana.call("GET", "/api/bootstrap")).body.forAdmins.asking).toEqual(["Jo New"]);
  });

  it("has someone who asked to join long ago gone from the roster once the hourly run forgets them", async () => {
    const dana = await w.signedIn("dana@example.com");
    const longAgo = new Date(NOW.getTime() - 40 * 86_400_000);
    const asking = { name: "Jo Old", email: "jo@example.com", position: "F" };
    expect((await w.browser().call("POST", "/api/auth/request", asking, { now: longAgo })).status).toBeLessThan(300);
    expect((await page(dana, "members")).body.slices.members.map((m: Json) => m.name)).toContain("Jo Old");
    await w.scheduled("7 * * * *", NOW);
    expect((await page(dana, "members")).body.slices.members.map((m: Json) => m.name)).not.toContain("Jo Old");
  });

  it("asks D1 once for what's the same for everyone of a role, and each member's own every time", async () => {
    const ash = await w.signedIn("ash@example.com");
    const bo = await w.signedIn("bo@example.com");
    const first = await sqlOf(w, () => page(ash, "members,pastSessions"));
    expect(first.read("FROM members m")).toBe(true);
    expect(first.read("session_teams")).toBe(true);
    const second = await sqlOf(w, () => page(bo, "members,pastSessions"));
    expect(second.reply.status).toBe(200);
    // The roster's and the nights' shared rows came from the edge, not D1; Bo's own answers did
    expect(second.read("FROM members m")).toBe(false);
    expect(second.read("session_teams")).toBe(false);
    expect(second.read("attendance")).toBe(true);
    expect(second.reply.body.slices.members).toEqual(first.reply.body.slices.members);
    // A session lead sees more (everyone's out and no-shows), so it's read for them
    const lee = await w.signedIn("lee@example.com");
    expect((await sqlOf(w, () => page(lee, "members,pastSessions"))).read("session_teams")).toBe(true);
  });

  it("keeps someone's own answers theirs, when the rest of a night comes from the edge", async () => {
    const dana = await w.signedIn("dana@example.com");
    const ash = await w.signedIn("ash@example.com");
    const bo = await w.signedIn("bo@example.com");
    const boot = (await dana.call("GET", "/api/bootstrap")).body;
    const friday = boot.sessions.find((s: Json) => s.heldOn >= "2026-10-06");
    expect((await ash.call("POST", `/api/sessions/${friday.id}/answer`, { answer: "out" })).status).toBe(200);
    const ashSees = (await ash.call("GET", "/api/slices?names=sessions")).body.slices.sessions;
    const boSees = (await bo.call("GET", "/api/slices?names=sessions")).body.slices.sessions;
    const ashId = (w.db.raw.prepare("SELECT id FROM members WHERE email = 'ash@example.com'").get() as { id: number })
      .id;
    expect(ashSees.find((s: Json) => s.id === friday.id).out).toContain(ashId);
    expect(boSees.find((s: Json) => s.id === friday.id).out ?? []).not.toContain(ashId);
  });

  it("comes back with a change that touched it, for a phone that holds it", async () => {
    const dana = await w.signedIn("dana@example.com");
    const ash = await w.signedIn("ash@example.com");
    const boot = (await dana.call("GET", "/api/bootstrap")).body;
    const friday = boot.sessions.find((s: Json) => s.heldOn >= "2026-10-06");
    const holding = await ash.call(
      "POST",
      `/api/sessions/${friday.id}/answer`,
      { answer: "in" },
      { headers: { "x-club-holds": "pastSessions,members" } },
    );
    expect(Object.keys(holding.body.changed)).toEqual(expect.arrayContaining(["sessions", "pastSessions"]));
    const notHolding = await ash.call(
      "POST",
      `/api/sessions/${friday.id}/answer`,
      { answer: "out" },
      { headers: { "x-club-holds": null } },
    );
    expect(Object.keys(notHolding.body.changed)).toContain("sessions");
    expect(Object.keys(notHolding.body.changed)).not.toContain("pastSessions");
  });
});

it("never keeps for others a part that reads who's asking or the moment", () => {
  const personal = /v\.(member_id|viewed_by|now)\b|(member_id|viewed_by|now) FROM viewer/;
  const shared = partsSql().filter(([part]) => !OWN.has(part));
  expect(shared.filter(([, sql]) => personal.test(sql)).map(([part]) => part)).toEqual([]);
});

it("keeps to D1's five terms in a compound SELECT, which the tests' SQLite doesn't hold it to", () => {
  const over = partsSql().filter(([, sql]) => (sql.match(/\bUNION\b/g) ?? []).length > 4);
  expect(over.map(([part]) => part)).toEqual([]);
});

describe("a club of 120 with a year of Fridays and Kumites behind it", () => {
  let small: string;
  let large: string;
  let adminLarge: string;
  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const few = await clubWithHistory(2, { weeks: 4, everyone: false, paying: false });
    small = await (await (await few.w.signedIn("m30@example.com")).open("GET", "/api/bootstrap")).text();
    const many = await clubWithHistory(12, { weeks: 52, everyone: true, paying: true });
    large = await (await (await many.w.signedIn("m30@example.com")).open("GET", "/api/bootstrap")).text();
    adminLarge = await (await many.dana.open("GET", "/api/bootstrap")).text();
  }, 60_000);

  it("opens the app the same size, however long its history", () => {
    expect(Math.abs(large.length - small.length)).toBeLessThan(1024);
  });

  it("opens the app in a few kilobytes, for a member and an admin", () => {
    expect(large.length).toBeLessThan(20 * 1024);
    expect(adminLarge.length).toBeLessThan(24 * 1024);
  });
});
