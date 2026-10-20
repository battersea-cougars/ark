// Live pages hear about changes the moment they're made (ADR 0072): every phone on the draft room or a game's live
// page holds one open stream from the club's live hub, and a change made through the API reaches them all at once.
// The stream carries only the names of the parts that changed; each phone then reads its own view.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Player", position: "G", rating: 55, email: "mo@example.com" },
  { name: "Ash Player", position: "F", rating: 58, email: "ash@example.com" },
  { name: "Bo Player", position: "D", rating: 52, email: "bo@example.com" },
];
const DRAFT_DAY = new Date("2026-12-08T19:30:00Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A phone with a live page open: the events its stream brings, in order. */
const listening = (email: string) => w.listening(email, DRAFT_DAY);

/** A draft night, open, with Cara on the clock. */
async function draftNight() {
  const dana = await w.signedIn("dana@example.com");
  const sees = async (b: { call: typeof dana.call }) => (await b.call("GET", "/api/bootstrap")).body as Json;
  const idOf = async (name: string) => (await sees(dana)).members.find((m: Json) => m.name === name).id as number;
  const typeId = (
    await dana.call("POST", "/api/tournament-types", {
      name: "Summer Cup",
      shortName: "Cup",
      icon: "trophy",
      tone: "green",
      kind: "draft",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      gameMinutes: 12,
      active: true,
      defaultFeePence: 1000,
      defaultStartTime: "19:30",
      defaultEndTime: "21:30",
      awards: [],
      location: "Battersea Park courts",
    })
  ).body.id as number;
  const captains = [await idOf("Cara Captain"), await idOf("Cole Captain")];
  const made = await dana.call("POST", "/api/tournaments", {
    typeId,
    name: "Winter Cup 2026",
    location: "",
    heldOn: "2026-12-12",
    startTime: "11:00",
    endTime: "16:00",
    capacity: 24,
    status: "planned",
    feePence: 1000,
    signupClosesOn: "2026-12-05",
    draftOn: "2026-12-08",
    teams: captains.map((captainMemberId) => ({ name: "", logo: null, captainMemberId, players: [] })),
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  const t = (await sees(dana)).tournaments.find((x: Json) => x.id === id);
  expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...t, status: "open" })).status).toBe(200);
  for (const who of ["reg", "mo", "ash", "bo"])
    expect(
      (await (await w.signedIn(`${who}@example.com`)).call("POST", `/api/tournaments/${id}/answer`, { answer: "in" }))
        .status,
    ).toBe(200);
  expect((await dana.call("POST", `/api/tournaments/${id}/draft/open`, {}, { now: DRAFT_DAY })).status).toBe(200);
  const pick = (as: { call: typeof dana.call }, memberId: number) =>
    as.call("POST", `/api/tournaments/${id}/draft/picks`, { memberId }, { now: DRAFT_DAY });
  return { dana, id, pick, reg: await idOf("Reg Player") };
}

describe("a draft night, with every captain's phone on the draft room", () => {
  it("a captain's pick reaches the other captain's open stream at once, naming what changed", async () => {
    const night = await draftNight();
    const cole = await listening("cole@example.com");
    const cara = await w.signedIn("cara@example.com");
    expect((await night.pick(cara, night.reg)).status).toBe(200);
    const got = await cole.next();
    expect(got.event).toBe("changed");
    expect(got.data.changed).toContain("tournaments");
    await cole.close();
  });

  it("the captain's own other device hears it too, and so does the admin running the draft", async () => {
    const night = await draftNight();
    const caraPhone = await listening("cara@example.com");
    const danaLaptop = await listening("dana@example.com");
    const cara = await w.signedIn("cara@example.com");
    expect((await night.pick(cara, night.reg)).status).toBe(200);
    expect((await caraPhone.next()).data.changed).toContain("tournaments");
    expect((await danaLaptop.next()).data.changed).toContain("tournaments");
    await caraPhone.close();
    await danaLaptop.close();
  });

  it("a refused pick (out of turn) changes nothing, so nobody hears about it", async () => {
    const night = await draftNight();
    const cole = await listening("cole@example.com");
    const coleTapping = await w.signedIn("cole@example.com");
    expect((await night.pick(coleTapping, night.reg)).status).toBe(409);
    // Something that does change follows; it's the first thing the stream brings
    const cara = await w.signedIn("cara@example.com");
    expect((await night.pick(cara, night.reg)).status).toBe(200);
    expect((await cole.next()).data.changed).toContain("tournaments");
    await cole.close();
  });

  it("closing the page closes its stream: the hub forgets it and later changes go only to the others", async () => {
    const night = await draftNight();
    const cole = await listening("cole@example.com");
    const reg = await listening("reg@example.com");
    expect(w.live.listeners).toBe(2);
    await cole.close();
    expect(w.live.listeners).toBe(1);
    const cara = await w.signedIn("cara@example.com");
    expect((await night.pick(cara, night.reg)).status).toBe(200);
    expect((await reg.next()).data.changed).toContain("tournaments");
    expect(w.live.listeners).toBe(1);
    await reg.close();
    expect(w.live.listeners).toBe(0);
  });

  it("someone not signed in gets no stream", async () => {
    const res = await w.browser().open("GET", "/api/live", { now: NOW });
    expect(res.status).toBe(401);
  });

  it("without a live hub (a server without the binding), the page is told and falls back to checking", async () => {
    delete w.env.LIVE;
    const b = await w.signedIn("cole@example.com");
    const res = await b.call("GET", "/api/live");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/live updates/i);
  });
});
