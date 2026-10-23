// A game scored live reaches every phone with nothing read (ADR 0072, #161): at the rink everyone shares one wifi
// address, and a goal used to be a read on every phone following the game within the same second. A live match is
// the same for every member, so the Worker builds it once and the hub sends it with the change's names; a phone that
// holds the version just before puts it in place as it is. Anything else (a phone that missed a change, a part that's
// someone's own, the draft) is names only, and read as before. Phones here hold the app's own copy of the club
// (src/app/catch-up.ts), through the real Worker and the real hub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";
import { phoneOn as livePhone, type LivePhone } from "./live.testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Captain", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Member", position: "G", rating: 55, email: "mo@example.com" },
  { name: "Ash Member", position: "F", rating: 58, email: "ash@example.com" },
];
/** NOW's day in London: the tournament's day. */
const TODAY = "2026-10-06";

let w: ReturnType<typeof testWorld>;
const open: LivePhone[] = [];
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.stop()));
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Long enough for the hub's second and every phone's wait before a read, and the read itself. */
const settled = () => wait(1500);

async function phoneOn(email: string, parts: readonly string[] = ["tournaments"]) {
  const phone = await livePhone(w, email, parts);
  open.push(phone);
  return phone;
}

/** A cup three captains entered, held on `heldOn`, its fixtures made; the first game's keeper holding the sheet. */
async function cupOn(heldOn = TODAY) {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const made = await dana.call("POST", "/api/tournaments", {
    name: "Summer Cup",
    location: "Battersea Park",
    heldOn,
    startTime: "10:00",
    endTime: "15:00",
    status: "planned",
    feePence: 0,
    kind: "teams",
    playoffs: [],
    teams: ["Cara Captain", "Cole Captain", "Reg Captain"].map((name) => ({
      name: name.split(" ")[0],
      logo: null,
      captainMemberId: idOf(name),
      players: [],
    })),
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
  const t = ((await dana.call("GET", "/api/bootstrap")).body as Json).tournaments.find((x: Json) => x.id === id);
  const game = t.games[0];
  const captain = t.teams.find((x: Json) => x.id === game.scoringTeamId).captainMemberId;
  const keeperEmail = ROSTER.find((r) => idOf(r.name) === captain)!.email;
  const keeper = await w.signedIn(keeperEmail);
  const path = `/api/tournaments/${id}/games/${game.id}`;
  expect((await keeper.call("POST", `${path}/scorer`, { action: "claim" })).status).toBe(200);
  expect((await keeper.call("POST", `${path}/clock`, { action: "start" })).status).toBe(200);
  const goal = async (teamId = game.homeTeamId) =>
    expect((await keeper.call("POST", `${path}/goals`, { teamId })).status).toBe(200);
  /** The game as a member reads it from the Worker, the yardstick for what a phone shows. */
  const asRead = async () =>
    ((await (await w.signedIn("ash@example.com")).call("GET", "/api/bootstrap")).body as Json).tournaments.find(
      (x: Json) => x.id === id,
    ).games;
  const shown = (p: LivePhone) => p.club().tournaments.find((x: Json) => x.id === id).games;
  return { dana, id, game, keeperEmail, path, goal, asRead, shown };
}

describe("a game scored live, everyone following it", () => {
  it("a goal reaches a following phone with nothing read: the game comes with the event, as a read would show it", async () => {
    const cup = await cupOn();
    const mo = await phoneOn("mo@example.com");
    await cup.goal();
    await settled();
    expect(mo.asked.slice(1)).toEqual([]);
    expect(cup.shown(mo)).toEqual(await cup.asRead());
    expect(cup.shown(mo)[0].homeGoals).toBe(1);
    // ...and the copy holds the change's version: the page's check on its beat is a 304
    await mo.whole();
    expect(mo.asked.at(-1)).toBe("whole: unchanged");
  });

  it("every phone following has it, the admin's and a captain's too, each with nothing read", async () => {
    const cup = await cupOn();
    const phones = [
      await phoneOn("mo@example.com"),
      await phoneOn("dana@example.com"),
      await phoneOn("cole@example.com"),
    ];
    await cup.goal();
    await cup.goal(cup.game.awayTeamId);
    await settled();
    const read = await cup.asRead();
    for (const p of phones) {
      expect(p.asked.slice(1), p.email).toEqual([]);
      expect(cup.shown(p), p.email).toEqual(read);
    }
  });

  it("goals in the same second go as one event carrying each, and the phone puts both in place", async () => {
    const cup = await cupOn();
    const mo = await phoneOn("mo@example.com");
    await cup.goal();
    await cup.goal();
    await cup.goal();
    await settled();
    expect(mo.events.length).toBeLessThan(3);
    expect(mo.events.flatMap((e: Json) => e.parts.map((p: Json) => p.version))).toEqual(
      mo.events.flatMap((e: Json) => e.versions),
    );
    expect(mo.asked.slice(1)).toEqual([]);
    expect(cup.shown(mo)[0].homeGoals).toBe(3);
  });

  it("a phone a version behind (a change nobody was told of) reads the game, as before, and shows it right", async () => {
    const cup = await cupOn();
    const mo = await phoneOn("mo@example.com");
    // A change that told nobody (a cron's): the copy never hears of that version
    w.db.raw.exec("UPDATE data_version SET version = version + 1");
    await cup.goal();
    await settled();
    expect(mo.asked.slice(1)).toEqual(["parts: tournaments"]);
    expect(cup.shown(mo)).toEqual(await cup.asRead());
  });

  it("the scorekeeper's own phone reads nothing: its reply brought the goal, and the event's match is no newer", async () => {
    const cup = await cupOn();
    const keeper = await phoneOn(cup.keeperEmail);
    expect((await keeper.change("POST", `${cup.path}/goals`, { teamId: cup.game.homeTeamId })).status).toBe(200);
    await settled();
    expect(keeper.asked.slice(1)).toEqual([]);
    expect(cup.shown(keeper)).toEqual(await cup.asRead());
  });

  it("a game scored on another day (a result put right afterwards) is names only: the phones read it", async () => {
    const cup = await cupOn("2026-10-03");
    const mo = await phoneOn("mo@example.com");
    await cup.goal();
    await settled();
    expect(mo.events.every((e: Json) => e.parts === undefined)).toBe(true);
    expect(mo.asked.slice(1)).toEqual(["parts: tournaments"]);
  });
});

describe("what's someone's own never comes with the event", () => {
  it("an answer In (the sign-ups, what's owed) is names only: no member's data on anyone's stream", async () => {
    const dana = await w.signedIn("dana@example.com");
    const session = ((await dana.call("GET", "/api/bootstrap")).body as Json).sessions.find(
      (s: Json) => s.heldOn >= TODAY,
    );
    const ash = await phoneOn("ash@example.com", ["sessions"]);
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" })).status).toBe(200);
    await settled();
    expect(ash.events).toHaveLength(1);
    expect(ash.events[0]).toEqual({ changed: expect.arrayContaining(["sessions"]), versions: [expect.any(Number)] });
    expect(ash.asked.slice(1)).toEqual([expect.stringMatching(/^parts: sessions/)]);
  });

  it("the draft stays names only: who went when is the captains' and the admins', so everyone reads their own view", async () => {
    const dana = await w.signedIn("dana@example.com");
    const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
    const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
    const made = await dana.call("POST", "/api/tournaments", {
      name: "Winter Cup",
      location: "",
      heldOn: "2026-12-12",
      startTime: "11:00",
      endTime: "16:00",
      capacity: 24,
      status: "planned",
      feePence: 1000,
      kind: "draft",
      signupClosesOn: "2026-12-05",
      draftOn: TODAY,
      teams: ["Cara Captain", "Cole Captain"].map((n) => ({
        name: "",
        logo: null,
        captainMemberId: idOf(n),
        players: [],
      })),
    });
    expect(made.status).toBe(201);
    const ash = await phoneOn("ash@example.com");
    expect((await dana.call("POST", `/api/tournaments/${made.body.id}/draft/draw`, {})).status).toBe(200);
    await settled();
    expect(ash.events.length).toBeGreaterThan(0);
    expect(ash.events.every((e: Json) => e.parts === undefined)).toBe(true);
    expect(ash.asked.slice(1)).toEqual(["parts: tournaments"]);
  });
});
