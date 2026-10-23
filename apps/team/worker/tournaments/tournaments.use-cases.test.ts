// A tournament, from an admin setting it up to its captains drafting their teams (ADR 0031): driven through the real
// Worker handlers in the fake world (testing.ts), with the website's What's on reading the same database.
//
// The story: an admin makes a series with its colour and schedules a tournament in it, with a date and captains. It
// goes on the website, members see it in the app, they can say they're in once sign-up opens, and then an admin
// opens the draft, the captains pick them onto their teams, and the admin closes it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsOn } from "../../../web/src/lib/server/whats-on";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Player", position: "G", rating: 55, email: "mo@example.com" },
  { name: "Ash Player", position: "F", rating: 58, email: "ash@example.com" },
  { name: "Bo Player", position: "D", rating: 52, email: "bo@example.com" },
  { name: "Gil Keeper", position: "G", rating: 50, email: "gil@example.com" },
];
/** Seeds for the fake world's luck (testing.ts): with two captains, the draw keeps them as named, or swaps them. */
const CARA_FIRST = 1;
const COLE_FIRST = 2;
/** Draft night: 8 December, after the 5th's sign-up deadline. */
const DRAFT_DAY = new Date("2026-12-08T19:30:00Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** Someone signed in, and what's on their screen. */
async function person(email: string) {
  const b = await w.signedIn(email);
  const sees = async (now = NOW) => (await b.call("GET", "/api/bootstrap", undefined, { now })).body as Json;
  const idOf = async (name: string) => (await sees()).members.find((m: Json) => m.name === name).id as number;
  return { call: b.call, sees, idOf };
}

/** The admin: makes the series, schedules the tournament, opens sign-up. */
async function admin() {
  const p = await person("dana@example.com");
  return {
    ...p,
    async makeSeries() {
      const res = await p.call("POST", "/api/tournament-types", {
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
        // Instead of Friday training: at its time
        defaultStartTime: "19:30",
        defaultEndTime: "21:30",
        awards: [{ name: "Champions", about: "Top of the table." }],
        location: "Battersea Park courts",
      });
      expect(res.status).toBe(201);
      return res.body.id as number;
    },
    async schedule(typeId: number, captains: number[]) {
      const res = await p.call("POST", "/api/tournaments", {
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
      expect(res.status).toBe(201);
      return res.body.id as number;
    },
    async openSignUp(id: number) {
      const t = (await p.sees()).tournaments.find((x: Json) => x.id === id);
      expect((await p.call("PUT", `/api/tournaments/${id}`, { ...t, status: "open" })).status).toBe(200);
    },
  };
}

/** A member: sees the calendar, says they're in. */
async function member(email: string) {
  const p = await person(email);
  return {
    ...p,
    answer: (id: number, a: "in" | "out", now = NOW) =>
      p.call("POST", `/api/tournaments/${id}/answer`, { answer: a }, { now }),
  };
}

/** Set up to the point the story's at: a series, a tournament in it with two captains. */
async function scheduled() {
  const dana = await admin();
  const typeId = await dana.makeSeries();
  const captains = [await dana.idOf("Cara Captain"), await dana.idOf("Cole Captain")];
  const id = await dana.schedule(typeId, captains);
  return { dana, typeId, id, captains };
}

describe("a tournament, from setting it up to the draft", () => {
  it("an admin makes a series with its colour, and schedules a tournament in it with a date and captains", async () => {
    const { dana, typeId, id, captains } = await scheduled();
    const seen = await dana.sees();
    expect(seen.tournamentTypes.find((t: Json) => t.id === typeId)).toMatchObject({
      name: "Summer Cup",
      defaultStartTime: "19:30",
      defaultEndTime: "21:30",
      tone: "green",
      kind: "draft",
    });
    const t = seen.tournaments.find((x: Json) => x.id === id);
    // It copied the series' rules and awards, and has its captains, with no pick order till the draft draws one
    expect(t).toMatchObject({ heldOn: "2026-12-12", kind: "draft", gameMinutes: 12, feePence: 1000 });
    expect(t.awards).toEqual([
      { name: "Champions", about: "Top of the table.", decidedBy: { kind: "stat", stat: "table" } },
    ]);
    expect(t.teams.map((team: Json) => [team.captainMemberId, team.pick])).toEqual([
      [captains[0], null],
      [captains[1], null],
    ]);
  });

  it("an admin schedules the next one with just its season: the day, the draft's date and the captains can come later", async () => {
    const dana = await admin();
    const typeId = await dana.makeSeries();
    const res = await dana.call("POST", "/api/tournaments", {
      typeId,
      name: "Summer Cup",
      heldOn: "2027-08-31",
      season: "summer",
      teams: [],
    });
    expect(res.status).toBe(201);
    const t = (await dana.sees()).tournaments.find((x: Json) => x.id === res.body.id);
    // Just its season, at the series' usual time; no draft date or captains yet; the series' fee, rules and awards;
    // sign-up not open
    expect(t).toMatchObject({
      startTime: "19:30",
      endTime: "21:30",
      heldOn: "2027-08-31",
      season: "summer",
      draftOn: null,
      kind: "draft",
      feePence: 1000,
      gameMinutes: 12,
      status: "planned",
    });
    expect(t.teams).toEqual([]);
    expect(t.awards).toEqual([
      { name: "Champions", about: "Top of the table.", decidedBy: { kind: "stat", stat: "table" } },
    ]);
  });

  it("an admin deletes one: it's gone from the app and What's on, with its teams and sign-ups; a member can't", async () => {
    const { dana, id } = await scheduled();
    const count = async (sql: string, ...args: unknown[]) =>
      (await w.db
        .prepare(sql)
        .bind(...args)
        .first<{ n: number }>())!.n;
    // Its two captains' teams, to go with it
    expect(await count("SELECT COUNT(*) n FROM tournament_teams WHERE tournament_id = ?", id)).toBe(2);
    const reg = await member("reg@example.com");
    expect((await reg.call("DELETE", `/api/tournaments/${id}`)).status).toBe(403);
    expect((await dana.call("DELETE", `/api/tournaments/${id}`)).status).toBe(200);
    expect((await dana.sees()).tournaments.find((t: Json) => t.id === id)).toBeUndefined();
    // Everything that was its went with it (the schema's cascades), and no player was left on a team that's gone
    for (const table of ["tournament_entries", "tournament_teams", "tournament_games", "tournament_award_winners"])
      expect(await count(`SELECT COUNT(*) n FROM ${table} WHERE tournament_id = ?`, id)).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) n FROM tournament_team_players WHERE team_id NOT IN (SELECT id FROM tournament_teams)",
      ),
    ).toBe(0);
    const items = await whatsOn(w.db, NOW, { trainings: 0, tournaments: 10, events: 0 });
    expect(items.find((i) => i.title === "Winter Cup 2026")).toBeUndefined();
    expect((await dana.call("DELETE", `/api/tournaments/${id}`)).status).toBe(404);
  });

  it("it goes on the website's What's on, at its series' place", async () => {
    await scheduled();
    const items = await whatsOn(w.db, NOW, { trainings: 0, tournaments: 10, events: 0 });
    expect(items.find((i) => i.title === "Winter Cup 2026")).toMatchObject({
      kind: "tournament",
      startsAt: "2026-12-12T11:00:00.000Z",
      dateTbc: false,
    });
  });

  it("members see it in the app, in its series' colour", async () => {
    const { typeId, id } = await scheduled();
    const reg = await member("reg@example.com");
    const seen = await reg.sees();
    expect(seen.tournaments.find((t: Json) => t.id === id)).toMatchObject({ name: "Winter Cup 2026", typeId });
    expect(seen.tournamentTypes.find((t: Json) => t.id === typeId).tone).toBe("green");
  });

  it("members say they're in once sign-up is open, and not after it closes", async () => {
    const { dana, id } = await scheduled();
    await dana.openSignUp(id);
    const reg = await member("reg@example.com");
    expect((await reg.answer(id, "in")).status).toBe(200);
    const t = (await reg.sees()).tournaments.find((x: Json) => x.id === id);
    expect(t.going).toContain(await reg.idOf("Reg Player"));
    // The day after sign-up closes (5 December), no more
    const mo = await member("mo@example.com");
    expect((await mo.answer(id, "in", new Date("2026-12-06T10:00:00Z"))).status).toBe(409);
  });

  it("sign-up opens by itself on the day the admin set, without anyone opening it", async () => {
    const dana = await admin();
    const typeId = await dana.makeSeries();
    const res = await dana.call("POST", "/api/tournaments", {
      typeId,
      name: "Summer Cup",
      heldOn: "2026-12-12",
      signupOpensOn: "2026-10-10",
      teams: [],
    });
    expect(res.status).toBe(201);
    const reg = await member("reg@example.com");
    // The 6th: not yet
    const early = await reg.answer(res.body.id, "in");
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/opens on/);
    // The 10th: open, and it says so
    expect((await reg.answer(res.body.id, "in", new Date("2026-10-10T09:00:00Z"))).status).toBe(200);
    expect((await dana.sees()).tournaments.find((t: Json) => t.id === res.body.id)).toMatchObject({
      signupOpensOn: "2026-10-10",
      status: "planned",
    });
  });

  it("members can't say they're in until an admin opens sign-up", async () => {
    const { dana, id } = await scheduled();
    const count = async (sql: string, ...args: unknown[]) =>
      (await w.db
        .prepare(sql)
        .bind(...args)
        .first<{ n: number }>())!.n;
    // Its two captains' teams, to go with it
    expect(await count("SELECT COUNT(*) n FROM tournament_teams WHERE tournament_id = ?", id)).toBe(2);
    const reg = await member("reg@example.com");
    // Still "Coming up": not yet
    expect((await reg.answer(id, "in")).status).toBe(409);
    // (Only the captains are in: they are automatically)
    expect((await reg.sees()).tournaments.find((x: Json) => x.id === id).going).not.toContain(
      await reg.idOf("Reg Player"),
    );
    // Saying you're out is always fine
    expect((await reg.answer(id, "out")).status).toBe(200);
    // Once it's open, they can
    await dana.openSignUp(id);
    expect((await reg.answer(id, "in")).status).toBe(200);
  });

  describe("the draft: an admin opens it, the captains pick the members who signed up, the admin closes it", () => {
    /**
     * Signed up and ready to draft: Reg, Mo, Ash and Bo said they're in. Not yet opened. The draw is seeded (the fake
     * world's luck) so that it comes out Cara then Cole, and the story reads the same each run.
     */
    async function signedUp(seed = CARA_FIRST) {
      w.luck(seed);
      const story = await scheduled();
      await story.dana.openSignUp(story.id);
      for (const who of ["reg", "mo", "ash", "bo"]) await (await member(`${who}@example.com`)).answer(story.id, "in");
      const cara = await member("cara@example.com");
      const cole = await member("cole@example.com");
      const draft = (as: { call: typeof cara.call }, what: "draw" | "open" | "close" | "finish", body: object = {}) =>
        as.call("POST", `/api/tournaments/${story.id}/draft/${what}`, body, { now: DRAFT_DAY });
      const pick = (as: { call: typeof cara.call }, memberId: number) =>
        as.call("POST", `/api/tournaments/${story.id}/draft/picks`, { memberId }, { now: DRAFT_DAY });
      const undo = (as: { call: typeof cara.call }) =>
        as.call("DELETE", `/api/tournaments/${story.id}/draft/picks/last`, undefined, { now: DRAFT_DAY });
      const tournament = async () =>
        (await story.dana.sees(DRAFT_DAY)).tournaments.find((x: Json) => x.id === story.id);
      const teams = async () => (await tournament()).teams.map((t: Json) => t.players.map((p: Json) => p.memberId));
      const ids = Object.fromEntries(
        await Promise.all(
          ["Reg Player", "Mo Player", "Ash Player", "Bo Player", "Dana Admin", "Cara Captain", "Cole Captain"].map(
            async (n) => [n.split(" ")[0], await cara.idOf(n)],
          ),
        ),
      ) as Record<"Reg" | "Mo" | "Ash" | "Bo" | "Dana" | "Cara" | "Cole", number>;
      return { ...story, cara, cole, draft, pick, undo, tournament, teams, ids };
    }
    /** And the order drawn (Cara first) and the draft opened by the admin: the two steps. */
    async function draftOpen() {
      const s = await signedUp();
      expect((await s.draft(s.dana, "draw")).status).toBe(200);
      expect((await s.draft(s.dana, "open")).status).toBe(200);
      expect((await s.tournament()).teams.map((t: Json) => t.captainMemberId)).toEqual([s.ids.Cara, s.ids.Cole]);
      return s;
    }

    describe("step 1, the draw: an admin draws the pick order, not the order the captains were named in; step 2 opens it", () => {
      const order = async (as: { sees: (now?: Date) => Promise<Json> }, id: number) =>
        ((await as.sees(DRAFT_DAY)).tournaments.find((x: Json) => x.id === id).teams as Json[]).map((t) => ({
          captain: t.captainMemberId,
          pick: t.pick,
        }));

      it("before the draw the captains have no numbers: the order they were named in means nothing", async () => {
        const { dana, id, ids } = await signedUp();
        expect(await order(dana, id)).toEqual([
          { captain: ids.Cara, pick: null },
          { captain: ids.Cole, pick: null },
        ]);
      });

      it("the draw sets the order, every captain once from 1, and the draft can open; whoever's first picks first", async () => {
        const { dana, id, cara, cole, draft, pick, tournament, ids } = await signedUp(COLE_FIRST);
        expect((await draft(cara, "draw")).status).toBe(403);
        expect((await draft(dana, "draw")).status).toBe(200);
        // Named Cara then Cole; drawn Cole then Cara. Not open yet: drawn, waiting for step 2
        expect(await order(dana, id)).toEqual([
          { captain: ids.Cole, pick: 1 },
          { captain: ids.Cara, pick: 2 },
        ]);
        expect((await tournament()).draftState).toBe("scheduled");
        expect((await pick(cole, ids.Reg)).status).toBe(409);
        expect((await draft(dana, "open")).status).toBe(200);
        expect((await pick(cara, ids.Reg)).status).toBe(409);
        expect((await pick(cole, ids.Reg)).status).toBe(200);
      });

      it("opening without the draw is refused: draw the order first", async () => {
        const { dana, draft } = await signedUp();
        const res = await draft(dana, "open");
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/Set the order first/);
      });

      it("with the real luck too: every captain once, in some order, numbered 1 and 2", async () => {
        const { dana, id, draft, ids } = await signedUp();
        w.luck(Date.now());
        expect((await draft(dana, "draw")).status).toBe(200);
        const drawn = await order(dana, id);
        expect(drawn.map((t) => t.captain).sort()).toEqual([ids.Cara, ids.Cole].sort());
        expect(drawn.map((t) => t.pick)).toEqual([1, 2]);
      });

      it("everyone sees the same drawn order as soon as it's drawn: the captains, whoever runs it, and any member", async () => {
        const { dana, id, cara, cole, draft, ids } = await signedUp(COLE_FIRST);
        expect((await draft(dana, "draw")).status).toBe(200);
        const drawn = [
          { captain: ids.Cole, pick: 1 },
          { captain: ids.Cara, pick: 2 },
        ];
        for (const who of [dana, cara, cole, await member("gil@example.com")])
          expect(await order(who, id)).toEqual(drawn);
      });

      it("it's drawn once: drawing again, opening, or closing and reopening keep the order", async () => {
        const { dana, id, draft } = await signedUp(COLE_FIRST);
        expect((await draft(dana, "draw")).status).toBe(200);
        const drawn = await order(dana, id);
        expect((await draft(dana, "draw")).status).toBe(200);
        expect(await order(dana, id)).toEqual(drawn);
        expect((await draft(dana, "open")).status).toBe(200);
        expect((await draft(dana, "draw")).status).toBe(200);
        expect(await order(dana, id)).toEqual(drawn);
        expect((await draft(dana, "close", { leaveOut: true })).status).toBe(200);
        expect((await draft(dana, "open")).status).toBe(200);
        expect(await order(dana, id)).toEqual(drawn);
      });

      it("saving the tournament once it's drawn keeps the drawn order; changing the captains before it opens undraws it", async () => {
        const { dana, id, draft, tournament, ids } = await signedUp(COLE_FIRST);
        expect((await draft(dana, "draw")).status).toBe(200);
        const drawn = await order(dana, id);
        expect((await dana.call("PUT", `/api/tournaments/${id}`, await tournament(), { now: DRAFT_DAY })).status).toBe(
          200,
        );
        expect(await order(dana, id)).toEqual(drawn);
        // A third captain: the draw was for two, so it goes, and it's drawn again
        const t = await tournament();
        t.teams.push({ name: "", logo: null, captainMemberId: ids.Bo, players: [] });
        expect((await dana.call("PUT", `/api/tournaments/${id}`, t, { now: DRAFT_DAY })).status).toBe(200);
        expect((await order(dana, id)).map((x) => x.pick)).toEqual([null, null, null]);
        expect((await draft(dana, "open")).status).toBe(409);
      });

      it("a reset takes the order away with the picks, and the next draw draws again", async () => {
        const { dana, id, draft, ids } = await signedUp(COLE_FIRST);
        expect((await draft(dana, "draw")).status).toBe(200);
        expect((await draft(dana, "open")).status).toBe(200);
        expect((await dana.call("POST", `/api/tournaments/${id}/draft/reset`, {}, { now: DRAFT_DAY })).status).toBe(
          200,
        );
        expect(await order(dana, id)).toEqual([
          { captain: ids.Cara, pick: null },
          { captain: ids.Cole, pick: null },
        ]);
        expect((await draft(dana, "open")).status).toBe(409);
        expect((await draft(dana, "draw")).status).toBe(200);
        expect((await order(dana, id)).map((t) => t.pick)).toEqual([1, 2]);
      });
    });

    it("an admin can't open the draft until every team can have 3 players, its captain and two picks", async () => {
      const story = await scheduled();
      await story.dana.openSignUp(story.id);
      const open = () => story.dana.call("POST", `/api/tournaments/${story.id}/draft/open`, {}, { now: DRAFT_DAY });
      // The order's drawn: that can be done before anyone's signed up
      expect(
        (await story.dana.call("POST", `/api/tournaments/${story.id}/draft/draw`, {}, { now: DRAFT_DAY })).status,
      ).toBe(200);
      // Two captains need four to pick from: nobody, then three, isn't enough
      expect((await open()).status).toBe(409);
      for (const who of ["reg", "mo", "ash"]) await (await member(`${who}@example.com`)).answer(story.id, "in");
      const three = await open();
      expect(three.status).toBe(409);
      expect(three.body.error).toMatch(/needs 4 signed up for 2 captains: 3 so far/);
      // The fourth: it opens
      await (await member("bo@example.com")).answer(story.id, "in");
      expect((await open()).status).toBe(200);
    });

    it("captains are in the tournament automatically, on their own team, and nobody can pick them", async () => {
      const { cara, tournament, pick, ids } = await draftOpen();
      expect((await tournament()).going).toEqual(expect.arrayContaining([ids.Cara, ids.Cole]));
      expect((await pick(cara, ids.Cole)).status).toBe(409);
    });

    it("captains take turns in snake order, and each pick lands on their team", async () => {
      const { cara, cole, pick, teams, ids } = await draftOpen();
      expect((await pick(cara, ids.Reg)).status).toBe(200);
      expect((await pick(cole, ids.Mo)).status).toBe(200);
      // Snake: Cole picks again, then Cara
      expect((await pick(cole, ids.Ash)).status).toBe(200);
      expect((await pick(cara, ids.Bo)).status).toBe(200);
      expect(await teams()).toEqual([
        [ids.Reg, ids.Bo],
        [ids.Mo, ids.Ash],
      ]);
    });

    it("captains only pick members who signed up, each once", async () => {
      const { cara, cole, pick, ids } = await draftOpen();
      expect((await pick(cara, ids.Dana)).status).toBe(409); // never said she's in
      expect((await pick(cara, ids.Reg)).status).toBe(200);
      expect((await pick(cole, ids.Reg)).status).toBe(409); // already on Cara's team
    });

    it("an admin running the draft can pick for the captain on the clock, and undo the last pick", async () => {
      const { dana, cole, pick, undo, teams, ids } = await draftOpen();
      expect((await pick(dana, ids.Reg)).status).toBe(200); // for Cara
      expect((await pick(cole, ids.Mo)).status).toBe(200);
      expect((await undo(dana)).status).toBe(200);
      expect(await teams()).toEqual([[ids.Reg], []]);
      // Cole is on the clock again; a captain can't undo
      expect((await undo(cole)).status).toBe(403);
      expect((await pick(cole, ids.Ash)).status).toBe(200);
    });

    it("a pick an admin makes for a captain is on record as theirs, for that captain's team; a captain's own is theirs", async () => {
      const { id, dana, cara, cole, pick, ids } = await draftOpen();
      expect((await pick(dana, ids.Reg)).status).toBe(200); // for Cara, on the clock
      expect((await pick(cole, ids.Mo)).status).toBe(200); // Cole's own
      const picks = async (as: { sees: (now?: Date) => Promise<Json> }) =>
        ((await as.sees(DRAFT_DAY)).tournaments.find((x: Json) => x.id === id).teams as Json[]).flatMap((t) =>
          t.players.map((p: Json) => [t.captainMemberId, p.memberId, p.pickedBy]),
        );
      const seen = [
        [ids.Cara, ids.Reg, ids.Dana],
        [ids.Cole, ids.Mo, ids.Cole],
      ];
      // Everyone who sees the picks sees who made them: the captains and whoever runs the draft
      for (const who of [dana, cara, cole]) expect(await picks(who)).toEqual(seen);
      // The record names both: Dana picked Reg, for Cara's team. A captain's own pick isn't on it
      const record = (await dana.call("GET", "/api/audit")).body.entries as Json[];
      const forCara = record.filter((e) => e.action === "draft.picked_for");
      expect(forCara).toHaveLength(1);
      expect(forCara[0].by.id).toBe(ids.Dana);
      expect(forCara[0].detail.to).toMatchObject({ memberId: ids.Reg, captainMemberId: ids.Cara, pickedBy: ids.Dana });
      expect(forCara[0].about).toBe("Reg Player");
    });

    it("saving the tournament mid-draft keeps every pick, and undo still takes the last one", async () => {
      const { dana, id, cara, cole, pick, undo, tournament, teams, ids } = await draftOpen();
      // The admin opened the editor before the picks…
      const editorCopy = await tournament();
      expect((await pick(cara, ids.Reg)).status).toBe(200);
      expect((await pick(cole, ids.Mo)).status).toBe(200);
      // …and saves it (a new team name) after them
      editorCopy.teams[0].name = "Team Red";
      expect((await dana.call("PUT", `/api/tournaments/${id}`, editorCopy, { now: DRAFT_DAY })).status).toBe(200);
      expect(await teams()).toEqual([[ids.Reg], [ids.Mo]]);
      expect((await tournament()).teams[0].name).toBe("Team Red");
      expect((await undo(dana)).status).toBe(200);
      expect(await teams()).toEqual([[ids.Reg], []]);
    });

    it("once the draft is open, the captains' order can't change", async () => {
      const { dana, id, tournament } = await draftOpen();
      const t = await tournament();
      t.teams.reverse();
      expect((await dana.call("PUT", `/api/tournaments/${id}`, t, { now: DRAFT_DAY })).status).toBe(409);
    });

    it("a member who withdraws during the draft comes off their team; once it's closed, they ask an admin", async () => {
      const { dana, id, cara, draft, pick, teams, ids } = await draftOpen();
      expect((await pick(cara, ids.Reg)).status).toBe(200);
      const reg = await member("reg@example.com");
      expect((await reg.answer(id, "out", DRAFT_DAY)).status).toBe(200);
      expect(await teams()).toEqual([[], []]);
      // Cara's pick again (Reg's came back off); close with the rest left out on purpose
      expect((await pick(cara, ids.Mo)).status).toBe(200);
      expect((await draft(dana, "close", { leaveOut: true })).status).toBe(200);
      // On a team once it's closed: withdrawing goes through an admin
      const mo = await member("mo@example.com");
      expect((await mo.answer(id, "out", DRAFT_DAY)).status).toBe(409);
    });

    describe("an admin adds players to the tournament, or takes them off", () => {
      const setPlayer = (as: { call: (...a: Json[]) => Promise<Json> }, id: number, memberId: number, inIt: boolean) =>
        as.call("POST", `/api/tournaments/${id}/players`, { memberId, in: inIt }, { now: DRAFT_DAY });

      it("an admin puts in a member who never said they're in, even with sign-up shut, and the captains can pick them", async () => {
        const { dana, id, cara, draft, pick, tournament, ids } = await signedUp();
        expect((await setPlayer(dana, id, ids.Dana, true)).status).toBe(200);
        expect((await tournament()).going).toContain(ids.Dana);
        expect((await draft(dana, "draw")).status).toBe(200);
        expect((await draft(dana, "open")).status).toBe(200);
        expect((await pick(cara, ids.Dana)).status).toBe(200);
      });

      it("an admin picks several in the Add player drawer and saves them on Done, in one go", async () => {
        const { dana, id, tournament, ids } = await signedUp();
        const res = await dana.call(
          "POST",
          `/api/tournaments/${id}/players`,
          {
            players: [
              { memberId: ids.Dana, in: true },
              { memberId: ids.Reg, in: false },
            ],
          },
          { now: DRAFT_DAY },
        );
        expect(res.status).toBe(200);
        const going = (await tournament()).going;
        expect(going).toContain(ids.Dana);
        expect(going).not.toContain(ids.Reg);
      });

      it("a captain in the batch is refused, as one at a time (the drawer never offers them)", async () => {
        const { dana, id, ids } = await signedUp();
        const res = await dana.call(
          "POST",
          `/api/tournaments/${id}/players`,
          { players: [{ memberId: ids.Cara, in: false }] },
          { now: DRAFT_DAY },
        );
        expect(res.status).toBe(409);
      });

      it("only an admin can put someone in", async () => {
        const { id, ids } = await signedUp();
        const reg = await member("reg@example.com");
        expect((await setPlayer(reg, id, ids.Dana, true)).status).toBe(403);
      });

      it("an admin taking off someone who's been picked takes them off their team too, even once it's closed", async () => {
        const { dana, id, cara, cole, draft, pick, tournament, teams, ids } = await draftOpen();
        expect((await pick(cara, ids.Reg)).status).toBe(200);
        expect((await pick(cole, ids.Mo)).status).toBe(200);
        expect((await setPlayer(dana, id, ids.Reg, false)).status).toBe(200);
        expect(await teams()).toEqual([[], [ids.Mo]]);
        expect((await draft(dana, "close", { leaveOut: true })).status).toBe(200);
        expect((await setPlayer(dana, id, ids.Mo, false)).status).toBe(200);
        expect(await teams()).toEqual([[], []]);
        expect((await tournament()).going).not.toContain(ids.Mo);
      });

      it("a captain comes off through the tournament's settings, not here", async () => {
        const { dana, id, ids } = await signedUp();
        expect((await setPlayer(dana, id, ids.Cara, false)).status).toBe(409);
      });

      it("once the draft is closed the teams are set: nobody new goes in", async () => {
        const { dana, id, draft, ids } = await draftOpen();
        expect((await draft(dana, "close", { leaveOut: true })).status).toBe(200);
        expect((await setPlayer(dana, id, ids.Dana, true)).status).toBe(409);
      });
    });

    it("the admin closes the draft once everyone's picked, or leaves the rest out on purpose; then it's locked", async () => {
      const { dana, cara, cole, draft, pick, tournament, ids } = await draftOpen();
      expect((await pick(cara, ids.Reg)).status).toBe(200);
      // Mo, Ash and Bo still to pick
      expect((await draft(dana, "close")).status).toBe(409);
      expect((await draft(cara, "close", { leaveOut: true })).status).toBe(403);
      expect((await draft(dana, "close", { leaveOut: true })).status).toBe(200);
      expect((await tournament()).draftState).toBe("closed");
      // Locked: no more picks, and the captains can't change
      expect((await pick(cole, ids.Mo)).status).toBe(409);
      const t = await tournament();
      t.teams[1].captainMemberId = ids.Ash;
      expect((await dana.call("PUT", `/api/tournaments/${t.id}`, t, { now: DRAFT_DAY })).status).toBe(409);
    });

    it("members don't see the picks while the draft is on; once it closes they see the teams, in no particular order", async () => {
      const { id, dana, cara, cole, draft, pick, ids } = await draftOpen();
      for (const [who, m] of [
        [cara, ids.Reg],
        [cole, ids.Mo],
        [cole, ids.Ash],
        [cara, ids.Bo],
      ] as const)
        expect((await pick(who, m)).status).toBe(200);
      const gil = await member("gil@example.com");
      const seen = async (as: { sees: (now?: Date) => Promise<Json> }) =>
        ((await as.sees(DRAFT_DAY)).tournaments.find((x: Json) => x.id === id).teams as Json[]).map((t) => ({
          captain: t.captainMemberId,
          players: t.players,
        }));
      // On: a member sees the captains, nobody on their teams yet
      expect(await seen(gil)).toEqual([
        { captain: ids.Cara, players: [] },
        { captain: ids.Cole, players: [] },
      ]);
      // The captains and whoever runs the draft see every pick, in order
      expect((await seen(cara))[0].players.map((p: Json) => p.pick)).toEqual([1, 4]);
      expect((await seen(dana))[1].players.map((p: Json) => p.memberId)).toEqual([ids.Mo, ids.Ash]);

      expect((await draft(dana, "close")).status).toBe(200);
      const teams = await seen(gil);
      // Closed: the teams, with no pick numbers to say who went first; the same order every time they look
      expect(teams.map((t) => t.players.map((p: Json) => p.memberId).sort())).toEqual([
        [ids.Reg, ids.Bo].sort(),
        [ids.Mo, ids.Ash].sort(),
      ]);
      expect(teams.flatMap((t) => t.players).every((p: Json) => p.pick === null)).toBe(true);
      expect(await seen(gil)).toEqual(teams);
    });

    it("an admin reopens a closed draft: the picks stay, and the captains carry on where they left off", async () => {
      const { dana, id, cara, cole, draft, pick, tournament, teams, ids } = await draftOpen();
      expect((await pick(cara, ids.Reg)).status).toBe(200);
      expect((await draft(dana, "close", { leaveOut: true })).status).toBe(200);
      expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
      expect((await draft(cara, "open")).status).toBe(403);
      expect((await draft(dana, "open")).status).toBe(200);
      expect((await tournament()).draftState).toBe("open");
      expect(await teams()).toEqual([[ids.Reg], []]);
      // Cole's turn, as it was; the fixtures are untouched
      expect((await pick(cara, ids.Mo)).status).toBe(409);
      expect((await pick(cole, ids.Mo)).status).toBe(200);
      expect((await tournament()).games.length).toBeGreaterThan(0);
    });

    describe("the night, one step at a time: the order, open, pick, then one tap closes it and makes the fixtures", () => {
      /** A phone with the app, signed in as this member, so the club can tell them things (ADR 0108). */
      const withPhone = async (as: { call: (...a: Json[]) => Promise<Json> }, token: string) =>
        expect((await as.call("PUT", "/api/auth/device", { token, platform: "ios" })).status).toBe(200);
      const draftPath = (typeId: number) =>
        `/tournaments/${(w.db.raw.prepare("SELECT slug FROM tournament_types WHERE id = ?").get(typeId) as Json).slug}/draft`;
      /** Everyone picked: Reg and Bo to Cara, Mo and Ash to Cole (Cara first). */
      async function allPicked() {
        const s = await draftOpen();
        for (const [who, m] of [
          [s.cara, s.ids.Reg],
          [s.cole, s.ids.Mo],
          [s.cole, s.ids.Ash],
          [s.cara, s.ids.Bo],
        ] as const)
          expect((await s.pick(who, m)).status).toBe(200);
        return s;
      }

      it('opening it tells each captain on their phone, with their place: "Winter Cup 2026 Draft Open", "You pick 2nd"', async () => {
        const s = await signedUp(COLE_FIRST);
        await withPhone(s.cara, "cara-phone");
        await withPhone(s.cole, "cole-phone");
        await withPhone(await member("reg@example.com"), "reg-phone");
        expect((await s.draft(s.dana, "draw")).status).toBe(200);
        // Drawing the order isn't news to send: it's on the page, for whoever's watching
        expect(w.pushes).toEqual([]);
        expect((await s.draft(s.dana, "open")).status).toBe(200);
        const path = draftPath(s.typeId);
        expect(
          w.pushes
            .map(({ token, title, body, path }) => ({ token, title, body, path }))
            .sort((a, b) => a.token.localeCompare(b.token)),
        ).toEqual([
          { token: "cara-phone", title: "Winter Cup 2026 Draft Open", body: "You pick 2nd", path },
          { token: "cole-phone", title: "Winter Cup 2026 Draft Open", body: "You pick 1st", path },
        ]);
      });

      it("opened at 23:00 it still tells the captains at once: the draft is on the night, quiet hours or not", async () => {
        const s = await signedUp(COLE_FIRST);
        const fcm = await w.firebase();
        try {
          await withPhone(s.cara, "cara-phone");
          await withPhone(s.cole, "cole-phone");
          const late = { now: new Date("2026-12-08T23:00:00Z") };
          expect((await s.dana.call("POST", `/api/tournaments/${s.id}/draft/draw`, {}, late)).status).toBe(200);
          expect((await s.dana.call("POST", `/api/tournaments/${s.id}/draft/open`, {}, late)).status).toBe(200);
          expect(fcm.asked.map((a) => `${a.token} ${a.body}`).sort()).toEqual([
            "cara-phone You pick 2nd",
            "cole-phone You pick 1st",
          ]);
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it("reopening a closed draft doesn't tell them again, and a captain who turned the draft off doesn't hear", async () => {
        const s = await signedUp();
        await withPhone(s.cara, "cara-phone");
        await withPhone(s.cole, "cole-phone");
        expect((await s.cole.call("PUT", "/api/me/notifications", { draft: false })).status).toBe(200);
        expect((await s.draft(s.dana, "draw")).status).toBe(200);
        expect((await s.draft(s.dana, "open")).status).toBe(200);
        expect(w.pushes.map((p) => p.token)).toEqual(["cara-phone"]);
        w.pushes.length = 0;
        expect((await s.draft(s.dana, "close", { leaveOut: true })).status).toBe(200);
        expect((await s.draft(s.dana, "open")).status).toBe(200);
        expect(w.pushes).toEqual([]);
      });

      it("everyone's picked: one tap closes it and makes the fixtures; only someone running the draft can", async () => {
        const { dana, cara, draft, tournament } = await allPicked();
        expect((await draft(cara, "finish")).status).toBe(403);
        expect((await draft(dana, "finish")).status).toBe(200);
        const t = await tournament();
        expect(t.draftState).toBe("closed");
        // Two teams: one round-robin game between them
        expect(t.games.map((g: Json) => [g.homeTeamId, g.awayTeamId])).toEqual([[t.teams[0].id, t.teams[1].id]]);
        // A second tap finds it closed, and makes nothing more
        expect((await draft(dana, "finish")).status).toBe(409);
        expect((await tournament()).games).toHaveLength(1);
      });

      it("with players still to pick it says how many, and closes leaving them out only when told to", async () => {
        const { dana, cara, draft, pick, tournament, ids } = await draftOpen();
        expect((await pick(cara, ids.Reg)).status).toBe(200);
        const res = await draft(dana, "finish");
        expect([res.status, res.body.error]).toEqual([
          409,
          "3 still to pick. Pick them, or close it leaving them out.",
        ]);
        expect((await tournament()).draftState).toBe("open");
        expect((await tournament()).games).toEqual([]);
        expect((await draft(dana, "finish", { leaveOut: true })).status).toBe(200);
        expect((await tournament()).games).toHaveLength(1);
      });

      it("fixtures made before the draft are kept, not made again", async () => {
        const { dana, id, draft, tournament } = await allPicked();
        expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
        const before = (await tournament()).games.map((g: Json) => g.id);
        expect((await draft(dana, "finish")).status).toBe(200);
        expect((await tournament()).games.map((g: Json) => g.id)).toEqual(before);
      });

      it("when the playoffs need more teams than there are, nothing changes: it says so, and stays open", async () => {
        const { dana, id, draft, tournament } = await allPicked();
        const t = await tournament();
        const playoffs = [{ name: "3rd v 4th", home: 3, away: 4 }];
        expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...t, playoffs }, { now: DRAFT_DAY })).status).toBe(
          200,
        );
        const res = await draft(dana, "finish");
        expect([res.status, res.body.error]).toEqual([409, "3rd v 4th needs 4 teams."]);
        expect((await tournament()).draftState).toBe("open");
        expect((await tournament()).games).toEqual([]);
      });

      const reopen = (as: { call: (...a: Json[]) => Promise<Json> }, id: number, fixtures?: "keep" | "clear") =>
        as.call("POST", `/api/tournaments/${id}/draft/reopen`, fixtures ? { fixtures } : {}, { now: DRAFT_DAY });
      /** What's left of the fixtures in the database: games, goals and penalties. */
      const left = (id: number) =>
        w.db.raw
          .prepare(
            `SELECT (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = ?) games,
                    (SELECT COUNT(*) FROM tournament_goals WHERE game_id IN
                       (SELECT id FROM tournament_games WHERE tournament_id = ?)) goals`,
          )
          .get(id, id);
      /** Closed with its fixtures, and the first match's result in (2–1: three goals). */
      async function withAResult() {
        const s = await allPicked();
        expect((await s.draft(s.dana, "finish")).status).toBe(200);
        const game = (await s.tournament()).games[0];
        expect(
          (await s.dana.call("PUT", `/api/tournaments/${s.id}/games/${game.id}`, { homeGoals: 2, awayGoals: 1 }))
            .status,
        ).toBe(200);
        return s;
      }

      it("reopened before any match's started, the fixtures stay by default (they're between the same teams)", async () => {
        const { dana, id, draft, tournament } = await allPicked();
        expect((await draft(dana, "finish")).status).toBe(200);
        const games = (await tournament()).games.map((g: Json) => g.id);
        expect((await reopen(dana, id)).status).toBe(200);
        expect((await tournament()).draftState).toBe("open");
        expect((await tournament()).games.map((g: Json) => g.id)).toEqual(games);
        // Closing again keeps them too
        expect((await draft(dana, "finish")).status).toBe(200);
        expect((await tournament()).games.map((g: Json) => g.id)).toEqual(games);
      });

      it("or the admin clears them as it reopens, and closing again makes them afresh", async () => {
        const { dana, id, draft, tournament } = await allPicked();
        expect((await draft(dana, "finish")).status).toBe(200);
        const games = (await tournament()).games.map((g: Json) => g.id);
        expect((await reopen(dana, id, "clear")).status).toBe(200);
        expect((await tournament()).draftState).toBe("open");
        expect((await tournament()).games).toEqual([]);
        expect((await draft(dana, "finish")).status).toBe(200);
        const again = (await tournament()).games.map((g: Json) => g.id);
        expect(again).toHaveLength(1);
        expect(again).not.toEqual(games);
      });

      it("once a match has a result, keeping the fixtures is refused: nothing changes", async () => {
        const { dana, id, tournament } = await withAResult();
        for (const fixtures of [undefined, "keep"] as const) {
          const res = await reopen(dana, id, fixtures);
          expect([res.status, res.body.error]).toEqual([
            409,
            "A match has started: clear the fixtures to reopen the draft.",
          ]);
        }
        expect((await tournament()).draftState).toBe("closed");
        expect(left(id)).toEqual({ games: 1, goals: 3 });
      });

      it("cleared, every match, result and goal goes and the draft's open: the Fight Card and the table are empty", async () => {
        const { dana, id, tournament, cara } = await withAResult();
        expect((await reopen(dana, id, "clear")).status).toBe(200);
        const t = await tournament();
        expect(t.draftState).toBe("open");
        expect(t.games).toEqual([]);
        expect(left(id)).toEqual({ games: 0, goals: 0 });
        // A captain sees the same
        expect((await cara.sees(DRAFT_DAY)).tournaments.find((x: Json) => x.id === id).games).toEqual([]);
        // It's on the record: reopened, and what went with it
        const entry = w.db.raw
          .prepare("SELECT detail FROM audit_log WHERE action = 'draft.reopened' ORDER BY id DESC LIMIT 1")
          .get() as { detail: string };
        const { from, to } = JSON.parse(entry.detail);
        expect(from).toMatchObject({ draftState: "closed", games: 1, results: 1, goals: 3 });
        expect(to).toMatchObject({ draftState: "open", games: 0, results: 0, goals: 0 });
      });

      it("clearing takes someone who edits the tournament: someone who only runs the draft can reopen, keeping them", async () => {
        const { dana, id, draft, tournament } = await allPicked();
        expect((await draft(dana, "finish")).status).toBe(200);
        const cara = await member("cara@example.com");
        expect((await reopen(cara, id, "clear")).status).toBe(403);
        expect((await reopen(dana, id, "sideways" as "keep")).status).toBe(400);
        expect((await tournament()).games).toHaveLength(1);
      });

      it.each(seeds(5))(
        "Reopen tapped twice with clear: reopened once, cleared once, the second refused (seed %i)",
        async (seed) => {
          const { dana, id, tournament } = await withAResult();
          w.db.interleave(seed);
          const [a, b] = await Promise.all([reopen(dana, id, "clear"), reopen(dana, id, "clear")]);
          w.db.interleave(null);
          expect([a.status, b.status].sort()).toEqual([200, 409]);
          expect((await tournament()).draftState).toBe("open");
          expect(left(id)).toEqual({ games: 0, goals: 0 });
        },
      );

      it("an admin clears the fixtures of a closed draft without reopening it; then they can be made again", async () => {
        const { dana, id, tournament, cara } = await withAResult();
        const clear = (as: { call: (...a: Json[]) => Promise<Json> }) =>
          as.call("DELETE", `/api/tournaments/${id}/fixtures`, undefined, { now: DRAFT_DAY });
        expect((await clear(cara)).status).toBe(403);
        expect((await clear(dana)).status).toBe(200);
        expect((await tournament()).draftState).toBe("closed");
        expect(left(id)).toEqual({ games: 0, goals: 0 });
        // Twice is the same as once
        expect((await clear(dana)).status).toBe(200);
        expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
        expect((await tournament()).games).toHaveLength(1);
      });
    });

    it("a team takes one goalie: a second is refused, for a captain, for whoever runs the draft, and for an admin's team edit", async () => {
      const { dana, id, cara, cole, pick, tournament, ids } = await draftOpen();
      const gil = await dana.idOf("Gil Keeper");
      // Gil is in too (an admin puts him in): two goalies in the pool, Mo and Gil
      expect(
        (await dana.call("POST", `/api/tournaments/${id}/players`, { memberId: gil, in: true }, { now: DRAFT_DAY }))
          .status,
      ).toBe(200);
      // Snake order for two teams: Cara, Cole, Cole, Cara
      expect((await pick(cara, ids.Mo)).status).toBe(200);
      expect((await pick(cole, ids.Reg)).status).toBe(200);
      expect((await pick(cole, ids.Ash)).status).toBe(200);
      // Cara's turn: she has Mo, so not Gil, nor can the admin pick him for her
      expect((await pick(cara, gil)).status).toBe(409);
      expect((await pick(dana, gil)).status).toBe(409);
      expect((await pick(cara, ids.Bo)).status).toBe(200);
      // An admin's team edit is held to the same rule; Cole has no goalie, so Gil can go on his team
      const teamIds = (await tournament()).teams.map((t: Json) => t.id);
      const onTeam = (teamId: number) =>
        dana.call("POST", `/api/tournaments/${id}/teams/${teamId}/players`, { memberId: gil }, { now: DRAFT_DAY });
      expect((await onTeam(teamIds[0])).status).toBe(409);
      expect((await onTeam(teamIds[1])).status).toBe(200);
    });

    describe("an admin edits a team directly, outside the draft", () => {
      const onTeam = (as: { call: (...a: Json[]) => Promise<Json> }, id: number, teamId: number, memberId: number) =>
        as.call("POST", `/api/tournaments/${id}/teams/${teamId}/players`, { memberId }, { now: DRAFT_DAY });
      const offTeam = (as: { call: (...a: Json[]) => Promise<Json> }, id: number, teamId: number, memberId: number) =>
        as.call("DELETE", `/api/tournaments/${id}/teams/${teamId}/players/${memberId}`, undefined, { now: DRAFT_DAY });
      /** Drafted and closed: Cara took Reg, Cole took Mo; Ash and Bo left out. */
      async function drafted() {
        const s = await draftOpen();
        expect((await s.pick(s.cara, s.ids.Reg)).status).toBe(200);
        expect((await s.pick(s.cole, s.ids.Mo)).status).toBe(200);
        expect((await s.draft(s.dana, "close", { leaveOut: true })).status).toBe(200);
        const teamIds = (await s.tournament()).teams.map((t: Json) => t.id) as number[];
        return { ...s, teamIds };
      }

      it("a player drops out after the draft: the admin takes them off their team and puts someone else on", async () => {
        const { dana, id, teams, ids, teamIds, tournament } = await drafted();
        expect((await offTeam(dana, id, teamIds[0], ids.Reg)).status).toBe(200);
        expect(await teams()).toEqual([[], [ids.Mo]]);
        // Off the team, still signed up
        expect((await tournament()).going).toContain(ids.Reg);
        expect((await onTeam(dana, id, teamIds[0], ids.Ash)).status).toBe(200);
        expect(await teams()).toEqual([[ids.Ash], [ids.Mo]]);
      });

      it("putting someone on a team moves them from another, and puts them in the tournament if they weren't", async () => {
        const { dana, id, teams, ids, teamIds, tournament } = await drafted();
        expect((await onTeam(dana, id, teamIds[1], ids.Reg)).status).toBe(200);
        // (Their pick number goes with them, so they sit in pick order)
        expect((await teams()).map((t: number[]) => [...t].sort())).toEqual([[], [ids.Reg, ids.Mo].sort()]);
        expect((await onTeam(dana, id, teamIds[0], ids.Dana)).status).toBe(200);
        expect((await tournament()).going).toContain(ids.Dana);
        expect((await teams())[0]).toEqual([ids.Dana]);
      });

      it("each player carries the pick that brought them; one an admin puts on mid-draft has none and takes no turn", async () => {
        const s = await draftOpen();
        const teamIds = (await s.tournament()).teams.map((t: Json) => t.id) as number[];
        expect((await s.pick(s.cara, s.ids.Reg)).status).toBe(200);
        expect((await onTeam(s.dana, s.id, teamIds[0], s.ids.Ash)).status).toBe(200);
        // Still Cole's turn: Ash went on by hand, not as a pick
        expect((await s.pick(s.cara, s.ids.Mo)).status).toBe(409);
        expect((await s.pick(s.cole, s.ids.Mo)).status).toBe(200);
        // Moved to Cole's team, Reg keeps pick 1
        expect((await onTeam(s.dana, s.id, teamIds[1], s.ids.Reg)).status).toBe(200);
        const [cara, cole] = (await s.tournament()).teams as { players: Json[] }[];
        expect(cara.players).toEqual([{ memberId: s.ids.Ash, name: "", pick: null, pickedBy: null }]);
        // Each pick still says who made it: Cara picked Reg, though he's on Cole's team now
        expect(cole.players).toEqual([
          { memberId: s.ids.Reg, name: "", pick: 1, pickedBy: s.ids.Cara },
          { memberId: s.ids.Mo, name: "", pick: 2, pickedBy: s.ids.Cole },
        ]);
      });

      it("a captain stays on their own team, and only an admin edits teams", async () => {
        const { dana, id, cara, ids, teamIds } = await drafted();
        expect((await onTeam(dana, id, teamIds[1], ids.Cara)).status).toBe(409);
        expect((await onTeam(cara, id, teamIds[0], ids.Ash)).status).toBe(403);
        expect((await offTeam(cara, id, teamIds[0], ids.Reg)).status).toBe(403);
      });
    });

    describe("a team's look: its name and logo, or its initials", () => {
      const PNG = "data:image/png;base64,iVBORw0KGgo=";
      const look = (as: { call: (...a: Json[]) => Promise<Json> }, id: number, teamId: number, body: object) =>
        as.call("PUT", `/api/tournaments/${id}/teams/${teamId}/look`, body, { now: DRAFT_DAY });

      it("a captain names their team and gives it a logo; the other captain can't, an admin can", async () => {
        const { dana, id, cara, cole, tournament } = await signedUp();
        const [caras, coles] = (await tournament()).teams.map((t: Json) => t.id);
        expect((await look(cara, id, caras, { name: "The Dim Maks", logo: PNG })).status).toBe(200);
        expect((await tournament()).teams[0]).toMatchObject({ name: "The Dim Maks", logo: PNG });
        expect((await look(cara, id, coles, { name: "Losers" })).status).toBe(403);
        expect((await look(dana, id, coles, { name: "Cole's Crew", logo: null })).status).toBe(200);
        expect((await tournament()).teams[1]).toMatchObject({ name: "Cole's Crew", logo: null });
        // Cleared, it's the initials again
        expect((await look(cole, id, coles, { name: "Cole's Crew", logo: null })).status).toBe(200);
      });

      it("a logo has to be a small image", async () => {
        const { id, cara, tournament } = await signedUp();
        const caras = (await tournament()).teams[0].id;
        expect((await look(cara, id, caras, { name: "", logo: "https://example.com/x.png" })).status).toBe(400);
      });
    });

    describe("an admin resets the draft to start again", () => {
      const reset = (as: { call: (...a: Json[]) => Promise<Json> }, id: number) =>
        as.call("POST", `/api/tournaments/${id}/draft/reset`, {}, { now: DRAFT_DAY });

      it("mid-draft: every pick comes off and it's back to not yet open, with the sign-ups and captains kept", async () => {
        const { dana, id, cara, cole, pick, tournament, teams, ids, captains } = await draftOpen();
        expect((await pick(cara, ids.Reg)).status).toBe(200);
        expect((await pick(cole, ids.Mo)).status).toBe(200);
        expect((await reset(dana, id)).status).toBe(200);
        const t = await tournament();
        expect(t.draftState).toBe("scheduled");
        expect(await teams()).toEqual([[], []]);
        expect(t.teams.map((x: Json) => x.captainMemberId)).toEqual(captains);
        expect(t.going).toEqual(expect.arrayContaining([ids.Reg, ids.Mo, ids.Ash, ids.Bo]));
        // Picks wait for it to be opened again, and then start from the first captain
        expect((await pick(cara, ids.Reg)).status).toBe(409);
      });

      it("once it's closed too: the players come off, and the fixtures stay, as the teams are the same teams", async () => {
        const { dana, id, cara, draft, pick, tournament, teams, ids } = await draftOpen();
        expect((await pick(cara, ids.Reg)).status).toBe(200);
        expect((await draft(dana, "close", { leaveOut: true })).status).toBe(200);
        expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
        const game = (await tournament()).games[0];
        expect(
          (await dana.call("PUT", `/api/tournaments/${id}/games/${game.id}`, { homeGoals: 2, awayGoals: 1 })).status,
        ).toBe(200);
        expect((await reset(dana, id)).status).toBe(200);
        expect((await tournament()).draftState).toBe("scheduled");
        expect(await teams()).toEqual([[], []]);
        expect((await tournament()).games.map((g: Json) => g.id)).toContain(game.id);
      });

      it("only someone running the draft can reset it", async () => {
        const { id, cara } = await draftOpen();
        expect((await reset(cara, id)).status).toBe(403);
      });
    });
  });
});
