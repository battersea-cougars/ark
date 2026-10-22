// The evening a Kumite ends (ADR 0074, 0044): the last match played, everyone's at The Anchor, and whoever runs it
// reveals the awards one at a time, in the order listed, to everyone watching. Members see each award face down
// until it's revealed (the Worker doesn't send them its winner before then); anyone opening the app later sees what's
// out so far. A double tap reveals one. Stepping back turns them all face down again, the results kept. Driven
// through the real Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "G", rating: 68, email: "cole@example.com" },
  { name: "Mo Member", position: "D", rating: 55, email: "mo@example.com" },
];
/** The Kumite series, as the club's seed has it: afterwards, The Anchor, for the celebration and awards. */
const KUMITE = 1;
/** Friday 13 November 2026, 21:45 GMT: the last match just played. */
const EVENING = { now: new Date("2026-11-13T21:45:00Z") };
/** Saturday, 06:30: the evening's over. */
const MORNING = { now: new Date("2026-11-14T06:30:00Z") };

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A Kumite on Friday 13 November, two teams, its one match played that evening. */
async function kumiteNight() {
  const dana = await w.signedIn("dana@example.com");
  const club = (await dana.call("GET", "/api/bootstrap", undefined, EVENING)).body as Json;
  const idOf = (name: string) => club.members.find((m: Json) => m.name === name).id as number;
  const made = await dana.call("POST", "/api/tournaments", {
    typeId: KUMITE,
    name: "Kumite Autumn 2026",
    heldOn: "2026-11-13",
    startTime: "19:30",
    endTime: "21:30",
    kind: "teams",
    playoffs: [],
    teams: [
      { name: "Ants", logo: null, captainMemberId: idOf("Cara Captain"), players: [] },
      { name: "Bees", logo: null, captainMemberId: idOf("Cole Captain"), players: [] },
    ],
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`, undefined, EVENING)).status).toBe(200);
  const tournament = async (as = dana, at = EVENING) =>
    ((await as.call("GET", "/api/bootstrap", undefined, at)).body as Json).tournaments.find((t: Json) => t.id === id);
  const t = await tournament();
  const [ants, bees] = t.teams.map((x: Json) => x.id as number);
  for (const g of t.games)
    expect(
      (await dana.call("PUT", `/api/tournaments/${id}/games/${g.id}`, { homeGoals: 3, awayGoals: 1 }, EVENING)).status,
    ).toBe(200);
  /** Confirm the awards (ADR 0044): the whole list, as the drawer sends it. */
  const confirm = () =>
    dana.call(
      "PUT",
      `/api/tournaments/${id}/winners`,
      {
        winners: [
          { award: "Champions", teamId: ants },
          { award: "Top scorer", memberId: idOf("Cara Captain") },
          { award: "Best goalie", memberId: idOf("Cole Captain") },
          { award: "The Dim Mak", memberId: idOf("Cole Captain") },
        ],
      },
      EVENING,
    );
  /** The next award, as the card's tap says it: the one at this place in the list. */
  const reveal = (next: number, as = dana) =>
    as.call("POST", `/api/tournaments/${id}/awards/reveal`, { next }, EVENING);
  /** What someone sees of the awards: how many are out, and the winners they're sent. */
  const sees = async (as = dana, at = EVENING) => {
    const x = await tournament(as, at);
    return { revealed: x.awardsRevealed, winners: x.winners.map((v: Json) => v.award) };
  };
  return { dana, id, idOf, ants, bees, confirm, reveal, sees, tournament };
}

describe("the awards at The Anchor, one at a time", () => {
  it("whoever runs it reveals them in the order listed; members see each only once it's out", async () => {
    const k = await kumiteNight();
    const mo = await w.signedIn("mo@example.com");
    expect((await k.confirm()).status).toBe(200);
    // Confirmed, nothing out: the admin sees every winner, a member none (face down)
    expect(await k.sees()).toEqual({
      revealed: 0,
      winners: ["Champions", "Top scorer", "Best goalie", "The Dim Mak"],
    });
    expect(await k.sees(mo)).toEqual({ revealed: 0, winners: [] });

    expect((await k.reveal(0)).status).toBe(200);
    expect(await k.sees(mo)).toEqual({ revealed: 1, winners: ["Champions"] });
    expect((await k.reveal(1)).status).toBe(200);
    expect(await k.sees(mo)).toEqual({ revealed: 2, winners: ["Champions", "Top scorer"] });
    expect((await k.reveal(2)).status).toBe(200);
    expect((await k.reveal(3)).status).toBe(200);
    expect(await k.sees(mo)).toEqual({
      revealed: 4,
      winners: ["Champions", "Top scorer", "Best goalie", "The Dim Mak"],
    });
    // Every one's out: nothing more to reveal
    expect((await k.reveal(4)).status).toBe(409);
  });

  it("the awards confirmed first: a reveal before then is refused, and so is one before the last match", async () => {
    const k = await kumiteNight();
    const refused = await k.reveal(0);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Confirm the awards/);

    // A Kumite still to play (the evening before it): nothing to reveal yet
    const early = await k.dana.call("POST", "/api/tournaments", {
      typeId: KUMITE,
      name: "Kumite Winter 2026",
      heldOn: "2026-12-11",
      kind: "teams",
      playoffs: [],
      teams: [],
    });
    const notYet = await k.dana.call("POST", `/api/tournaments/${early.body.id}/awards/reveal`, { next: 0 }, EVENING);
    expect(notYet.status).toBe(409);
    expect(notYet.body.error).toMatch(/last match/);
  });

  it("a member can't reveal one", async () => {
    const k = await kumiteNight();
    await k.confirm();
    const mo = await w.signedIn("mo@example.com");
    expect((await k.reveal(0, mo)).status).toBe(403);
    expect((await k.sees()).revealed).toBe(0);
  });

  it("a double tap reveals one: the second tap names the award already out, and does nothing", async () => {
    const k = await kumiteNight();
    await k.confirm();
    expect((await k.reveal(0)).status).toBe(200);
    expect((await k.reveal(0)).status).toBe(200);
    expect((await k.sees()).revealed).toBe(1);
    // A tap from a page that's fallen behind (one out, it thinks none): refused at nothing past what it saw
    expect((await k.reveal(3)).status).toBe(409);
    expect((await k.sees()).revealed).toBe(1);
  });

  it.each(seeds(6))("two taps at once (seed %i) reveal one", async (seed) => {
    const k = await kumiteNight();
    await k.confirm();
    w.db.interleave(seed);
    const taps = await Promise.all([k.reveal(0), k.reveal(0), k.reveal(0)]);
    w.db.interleave(null);
    expect(taps.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await k.sees()).revealed).toBe(1);
  });

  it("anyone opening the app later sees what's out so far, and each reveal reaches a page that's open", async () => {
    const k = await kumiteNight();
    await k.confirm();
    const cara = await w.listening("cara@example.com", EVENING.now);
    await k.reveal(0);
    expect((await cara.next()).data.changed).toContain("tournaments");
    await k.reveal(1);
    // Mo opens the app now: the two out, the rest face down
    const mo = await w.signedIn("mo@example.com");
    expect(await k.sees(mo)).toEqual({ revealed: 2, winners: ["Champions", "Top scorer"] });
    cara.close();
  });

  it("the evening over (06:00), every winner is history, revealed or not", async () => {
    const k = await kumiteNight();
    await k.confirm();
    await k.reveal(0);
    const mo = await w.signedIn("mo@example.com");
    expect((await k.sees(mo, MORNING)).winners).toEqual(["Champions", "Top scorer", "Best goalie", "The Dim Mak"]);
  });

  it("each reveal is on the record", async () => {
    const k = await kumiteNight();
    await k.confirm();
    await k.reveal(0);
    await k.reveal(1);
    const rows = w.db.raw
      .prepare("SELECT detail FROM audit_log WHERE action = 'tournament.award_revealed' ORDER BY id")
      .all() as { detail: string }[];
    expect(rows.map((r) => JSON.parse(r.detail).to)).toMatchObject([
      { revealed: 1, award: "Champions" },
      { revealed: 2, award: "Top scorer" },
    ]);
  });
});

describe("Awards at The Anchor: everyone hears the first one, once", () => {
  it("the first award out tells everyone with the app; the rest don't", async () => {
    const k = await kumiteNight();
    await k.confirm();
    const mo = await w.signedIn("mo@example.com");
    await mo.call("PUT", "/api/auth/device", { token: "mo-phone", platform: "ios" });
    await k.reveal(0);
    expect(w.pushes.map(({ token, title, body }) => ({ token, title, body }))).toEqual([
      { token: "mo-phone", title: "Awards at The Anchor", body: "Kumite Autumn 2026: the first one's out." },
    ]);
    w.pushes.length = 0;
    await k.reveal(1);
    expect(w.pushes).toEqual([]);
  });
});

describe("the awards go out at the party, quiet hours or not", () => {
  it("the first award revealed at 22:40 tells everyone at once, not at 08:00", async () => {
    const k = await kumiteNight();
    await k.confirm();
    const fcm = await w.firebase();
    try {
      const mo = await w.signedIn("mo@example.com");
      await mo.call("PUT", "/api/auth/device", { token: "mo-phone", platform: "ios" });
      const late = { now: new Date("2026-11-13T22:40:00Z") };
      expect((await k.dana.call("POST", `/api/tournaments/${k.id}/awards/reveal`, { next: 0 }, late)).status).toBe(200);
      expect(fcm.asked.map((a) => `${a.token} ${a.title}`)).toEqual(["mo-phone Awards at The Anchor"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("stepping back from the after-party", () => {
  it("turns every award face down again; the results and the winners stay", async () => {
    const k = await kumiteNight();
    await k.confirm();
    await k.reveal(0);
    await k.reveal(1);
    const back = await k.dana.call("POST", `/api/tournaments/${k.id}/step-back`, { from: "awards" }, EVENING);
    expect(back.status).toBe(200);
    const mo = await w.signedIn("mo@example.com");
    expect(await k.sees(mo)).toEqual({ revealed: 0, winners: [] });
    const t = await k.tournament();
    expect(t.games.every((g: Json) => g.status === "done" && g.homeGoals === 3)).toBe(true);
    expect(t.winners).toHaveLength(4);
    // A second tap, the reveals already hidden: the step's moved on (to the results)
    expect((await k.dana.call("POST", `/api/tournaments/${k.id}/step-back`, { from: "awards" }, EVENING)).status).toBe(
      409,
    );
    // And they're revealed again from the first
    expect((await k.reveal(0)).status).toBe(200);
  });
});
