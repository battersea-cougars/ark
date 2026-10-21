// A tournament, from an admin setting it up to its captains drafting their teams (ADR 0031): driven through the real
// Worker handlers in the fake world (testing.ts), with the website's What's on reading the same database.
//
// The story: an admin makes a series with its colour and schedules a tournament in it, with a date and captains. It
// goes on the website, members see it in the app, they can say they're in once sign-up opens, and then an admin
// opens the draft, the captains pick them onto their teams, and the admin closes it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsOn } from "../../../web/src/lib/server/whats-on";
import { NOW, testWorld } from "../testing";

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
    expect(t.awards).toEqual([{ name: "Champions", about: "Top of the table." }]);
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
    expect(t.awards).toEqual([{ name: "Champions", about: "Top of the table." }]);
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
      const draft = (as: { call: typeof cara.call }, what: "open" | "close", body: object = {}) =>
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
    /** And opened by the admin, the draw putting Cara first. */
    async function draftOpen() {
      const s = await signedUp();
      expect((await s.draft(s.dana, "open")).status).toBe(200);
      expect((await s.tournament()).teams.map((t: Json) => t.captainMemberId)).toEqual([s.ids.Cara, s.ids.Cole]);
      return s;
    }

    describe("the pick order is drawn when the draft opens, not the order the captains were named in", () => {
      const order = async (as: { sees: (now?: Date) => Promise<Json> }, id: number) =>
        ((await as.sees(DRAFT_DAY)).tournaments.find((x: Json) => x.id === id).teams as Json[]).map((t) => ({
          captain: t.captainMemberId,
          pick: t.pick,
        }));

      it("before it opens the captains have no numbers: the order they were named in means nothing", async () => {
        const { dana, id, ids } = await signedUp();
        expect(await order(dana, id)).toEqual([
          { captain: ids.Cara, pick: null },
          { captain: ids.Cole, pick: null },
        ]);
      });

      it("opening it draws the order: every captain once, numbered from 1, whoever's first picks first", async () => {
        const { dana, id, cara, cole, draft, pick, ids } = await signedUp(COLE_FIRST);
        expect((await draft(dana, "open")).status).toBe(200);
        // Named Cara then Cole; drawn Cole then Cara
        expect(await order(dana, id)).toEqual([
          { captain: ids.Cole, pick: 1 },
          { captain: ids.Cara, pick: 2 },
        ]);
        expect((await pick(cara, ids.Reg)).status).toBe(409);
        expect((await pick(cole, ids.Reg)).status).toBe(200);
      });

      it("with the real luck too: every captain once, in some order, numbered 1 and 2", async () => {
        const { dana, id, draft, ids } = await signedUp();
        w.luck(Date.now());
        expect((await draft(dana, "open")).status).toBe(200);
        const drawn = await order(dana, id);
        expect(drawn.map((t) => t.captain).sort()).toEqual([ids.Cara, ids.Cole].sort());
        expect(drawn.map((t) => t.pick)).toEqual([1, 2]);
      });

      it("everyone sees the same drawn order: the captains, whoever runs it, and any member", async () => {
        const { dana, id, cara, cole, draft, ids } = await signedUp(COLE_FIRST);
        expect((await draft(dana, "open")).status).toBe(200);
        const drawn = [
          { captain: ids.Cole, pick: 1 },
          { captain: ids.Cara, pick: 2 },
        ];
        for (const who of [dana, cara, cole, await member("gil@example.com")])
          expect(await order(who, id)).toEqual(drawn);
      });

      it("it's drawn once: opening again, or closing and reopening, keeps the order", async () => {
        const { dana, id, draft } = await signedUp(COLE_FIRST);
        expect((await draft(dana, "open")).status).toBe(200);
        const drawn = await order(dana, id);
        expect((await draft(dana, "open")).status).toBe(200);
        expect(await order(dana, id)).toEqual(drawn);
        expect((await draft(dana, "close", { leaveOut: true })).status).toBe(200);
        expect((await draft(dana, "open")).status).toBe(200);
        expect(await order(dana, id)).toEqual(drawn);
      });

      it("saving the tournament once it's drawn keeps the drawn order", async () => {
        const { dana, id, draft, tournament } = await signedUp(COLE_FIRST);
        expect((await draft(dana, "open")).status).toBe(200);
        const drawn = await order(dana, id);
        expect((await dana.call("PUT", `/api/tournaments/${id}`, await tournament(), { now: DRAFT_DAY })).status).toBe(
          200,
        );
        expect(await order(dana, id)).toEqual(drawn);
      });

      it("a reset puts the captains back to no order, and the next opening draws again", async () => {
        const { dana, id, draft, ids } = await signedUp(COLE_FIRST);
        expect((await draft(dana, "open")).status).toBe(200);
        expect((await dana.call("POST", `/api/tournaments/${id}/draft/reset`, {}, { now: DRAFT_DAY })).status).toBe(
          200,
        );
        expect(await order(dana, id)).toEqual([
          { captain: ids.Cara, pick: null },
          { captain: ids.Cole, pick: null },
        ]);
        expect((await draft(dana, "open")).status).toBe(200);
        expect((await order(dana, id)).map((t) => t.pick)).toEqual([1, 2]);
      });
    });

    it("an admin can't open the draft until every team can have 3 players, its captain and two picks", async () => {
      const story = await scheduled();
      await story.dana.openSignUp(story.id);
      const open = () => story.dana.call("POST", `/api/tournaments/${story.id}/draft/open`, {}, { now: DRAFT_DAY });
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

    it("picks wait until an admin opens the draft, and only an admin can open it", async () => {
      const { dana, cara, draft, pick, tournament, ids } = await signedUp();
      expect((await tournament()).draftState).toBe("scheduled");
      expect((await pick(cara, ids.Reg)).status).toBe(409);
      expect((await draft(cara, "open")).status).toBe(403);
      expect((await draft(dana, "open")).status).toBe(200);
      expect((await tournament()).draftState).toBe("open");
      expect((await pick(cara, ids.Reg)).status).toBe(200);
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

    it("nobody picks out of turn, and only captains pick", async () => {
      const { cara, cole, pick, teams, ids } = await draftOpen();
      expect((await pick(cole, ids.Reg)).status).toBe(409); // Cara's first
      const reg = await member("reg@example.com");
      expect((await pick(reg, ids.Mo)).status).toBe(403); // not a captain
      expect((await pick(cara, ids.Reg)).status).toBe(200);
      expect((await pick(cara, ids.Mo)).status).toBe(409); // now Cole's turn
      expect(await teams()).toEqual([[ids.Reg], []]);
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
        expect(cara.players).toEqual([{ memberId: s.ids.Ash, name: "", pick: null }]);
        expect(cole.players).toEqual([
          { memberId: s.ids.Reg, name: "", pick: 1 },
          { memberId: s.ids.Mo, name: "", pick: 2 },
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
