// The club's agenda (ADR 0042): one list of what's on and when, which every part of the club pushes to when it
// changes (trainings, tournaments with their draft night and sign-up deadline, one-off events). The website's What's
// on and the app's calendar both read it, so they can't disagree. Driven through the real Worker handlers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsOn, ALL_LIMITS } from "../../../web/src/lib/server/whats-on";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "F", rating: 66, email: "cole@example.com" },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Player", position: "D", rating: 58, email: "mo@example.com" },
  { name: "Ash Player", position: "F", rating: 55, email: "ash@example.com" },
  { name: "Bo Player", position: "G", rating: 57, email: "bo@example.com" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

async function as(email: string) {
  const b = await w.signedIn(email);
  const sees = async () => (await b.club()).body as Json;
  return { call: b.call, sees, agenda: async () => (await sees()).agenda as Json[] };
}

/** An admin schedules the Winter Cup: a draft, with Cara and Cole as captains, sign-up closing on the 5th. */
async function winterCup(changes: object = {}) {
  const dana = await as("dana@example.com");
  const ids = Object.fromEntries((await dana.sees()).members.map((m: Json) => [m.name, m.id]));
  const body = {
    name: "Winter Cup",
    location: "Battersea Park",
    heldOn: "2026-12-12",
    startTime: "11:00",
    endTime: "16:00",
    status: "open",
    feePence: 0,
    kind: "draft",
    signupClosesOn: "2026-12-05",
    draftOn: "2026-12-08",
    teams: [ids["Cara Captain"], ids["Cole Captain"]].map((captainMemberId) => ({ name: "", captainMemberId })),
    ...changes,
  };
  const res = await dana.call("POST", "/api/tournaments", body);
  expect(res.status).toBe(201);
  return { dana, id: res.body.id as number, body };
}

const kinds = (rows: Json[], title: RegExp) => rows.filter((r) => title.test(r.title)).map((r) => r.kind);

describe("the club's agenda", () => {
  it("a tournament an admin schedules is on the website and in everyone's calendar", async () => {
    await winterCup();
    const site = await whatsOn(w.db, NOW, ALL_LIMITS);
    expect(site.find((i) => i.title === "Winter Cup")).toMatchObject({
      kind: "tournament",
      startsAt: "2026-12-12T11:00:00.000Z",
      venue: "Battersea Park",
    });
    const reg = await as("reg@example.com");
    expect((await reg.agenda()).find((r) => r.kind === "tournament" && r.title === "Winter Cup")).toMatchObject({
      startsAt: "2026-12-12T11:00:00.000Z",
      group: "tournament",
    });
  });

  it("its sign-up deadline is in members' calendars, not on the website", async () => {
    await winterCup();
    const reg = await as("reg@example.com");
    expect((await reg.agenda()).find((r) => r.kind === "signup_closes")).toMatchObject({
      title: "Winter Cup: sign-up closes",
      day: "2026-12-05",
    });
    expect((await whatsOn(w.db, NOW, ALL_LIMITS)).some((i) => /sign-up/.test(i.title))).toBe(false);
  });

  it("its draft day shows only to its captains and the admins, as a day: a reminder, with no time", async () => {
    await winterCup();
    const cara = await as("cara@example.com");
    expect((await cara.agenda()).find((r) => r.kind === "draft")).toMatchObject({ day: "2026-12-08", allDay: true });
    const draftFor = async (email: string) => kinds(await (await as(email)).agenda(), /Winter Cup/).includes("draft");
    expect(await draftFor("cara@example.com")).toBe(true);
    expect(await draftFor("dana@example.com")).toBe(true);
    expect(await draftFor("reg@example.com")).toBe(false);
    expect((await whatsOn(w.db, NOW, ALL_LIMITS)).some((i) => /draft/i.test(i.title))).toBe(false);
  });

  it("moving the tournament moves it everywhere at once", async () => {
    const { dana, id, body } = await winterCup();
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...body, heldOn: "2026-12-19" })).status).toBe(200);
    const rows = (await dana.agenda()).filter((r) => r.kind === "tournament" && r.title === "Winter Cup");
    expect(rows.map((r) => r.day)).toEqual(["2026-12-19"]);
    expect((await whatsOn(w.db, NOW, ALL_LIMITS)).find((i) => i.title === "Winter Cup")?.startsAt).toBe(
      "2026-12-19T11:00:00.000Z",
    );
  });

  it("a closed draft leaves the calendar; a finished tournament leaves it altogether", async () => {
    const { dana, id } = await winterCup();
    // Enough to draft: two captains, two picks each
    for (const who of ["reg", "mo", "ash", "bo"])
      await (await as(`${who}@example.com`)).call("POST", `/api/tournaments/${id}/answer`, { answer: "in" });
    expect((await dana.call("POST", `/api/tournaments/${id}/draft/draw`, {})).status).toBe(200);
    expect((await dana.call("POST", `/api/tournaments/${id}/draft/open`, {})).status).toBe(200);
    await dana.call("POST", `/api/tournaments/${id}/draft/close`, { leaveOut: true });
    expect(kinds(await dana.agenda(), /Winter Cup/)).not.toContain("draft");
    const saved = (await dana.sees()).tournaments.find((t: Json) => t.id === id);
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...saved, status: "finished" })).status).toBe(200);
    expect(kinds(await dana.agenda(), /Winter Cup/)).toEqual([]);
  });

  it("a tournament that's only a season so far shows its season, not a date", async () => {
    await winterCup({ heldOn: "2027-08-31", season: "summer", signupClosesOn: null, draftOn: null });
    const row = (await (await as("reg@example.com")).agenda()).find((r) => r.title === "Winter Cup");
    expect(row).toMatchObject({ season: "Summer 2027", dateTbc: true });
  });

  it("training sessions are on it; cancelling one keeps it there, marked", async () => {
    const dana = await as("dana@example.com");
    const fridays = (await dana.agenda()).filter((r) => r.kind === "training");
    expect(fridays.length).toBeGreaterThan(3);
    expect(fridays[0]).toMatchObject({ title: "Friday Training", group: "series:1", cancelled: false });
    const session = (await dana.sees()).sessions.find((s: Json) => s.heldOn === fridays[0].day);
    expect((await dana.call("POST", `/api/sessions/${session.id}/cancelled`, { cancelled: true })).status).toBe(200);
    expect((await dana.agenda()).find((r) => r.kind === "training" && r.day === fridays[0].day).cancelled).toBe(true);
  });

  it("a private one-off event is in the app's calendar but not on the website", async () => {
    const dana = await as("dana@example.com");
    const res = await dana.call("POST", "/api/club-events", {
      title: "Committee",
      startsAt: "2026-10-20T18:00:00.000Z",
      endsAt: "2026-10-20T19:00:00.000Z",
      venue: "The pub",
      description: "",
      public: false,
      signup: false,
      capacity: null,
    });
    expect(res.status).toBe(201);
    expect((await dana.agenda()).find((r) => r.title === "Committee")).toMatchObject({
      kind: "event",
      group: "social",
    });
    expect((await whatsOn(w.db, NOW, ALL_LIMITS)).some((i) => i.title === "Committee")).toBe(false);
  });
});
