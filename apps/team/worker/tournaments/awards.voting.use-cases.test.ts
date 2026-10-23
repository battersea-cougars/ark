// Before the reveal, the awards are confirmed (ADR 0044): from the last match till then, everyone who played votes
// for the voted awards (Best keeper: the skaters, for a keeper), one vote an award, secret, never for themselves;
// whoever runs it checks the stats and draws, makes the judges' call (its name tonight and who), and chooses where
// a vote's level after its tie-break. Confirming counts the votes and closes voting. Driven through the real Worker
// handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { testWorld } from "../testing";
import { EVENING, KUMITE, ROSTER, kumiteNight } from "./awards.testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
const winnerOf = (t: Json, award: string) => t.winners.filter((x: Json) => x.award === award);

describe("casting a vote", () => {
  it("a skater votes for a goalie; the admin sees how many have voted, nobody's sent who for but the voter", async () => {
    const k = await kumiteNight(w);
    const cara = await w.signedIn("cara@example.com");
    expect((await k.vote(cara, [{ award: "Best keeper", memberId: k.idOf("Cole Captain") }])).status).toBe(200);
    const asAdmin = await k.tournament();
    expect(asAdmin.votes).toEqual([{ award: "Best keeper", cast: 1, mine: null }]);
    expect((await k.tournament(cara)).votes).toEqual([{ award: "Best keeper", cast: 1, mine: k.idOf("Cole Captain") }]);
    // Not on the record either: a secret ballot
    const rows = w.db.raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE detail LIKE '%Best keeper%'").get() as Json;
    expect(rows.n).toBe(0);
  });

  it("only someone who played; for Best keeper, only the skaters, and only for a goalie", async () => {
    const k = await kumiteNight(w);
    const forGus = [{ award: "Best keeper", memberId: k.idOf("Gus Goalie") }];
    // Mo didn't play
    expect((await k.vote(await w.signedIn("mo@example.com"), forGus)).status).toBe(403);
    // Cole's a goalie: the skaters vote for this one
    const cole = await k.vote(await w.signedIn("cole@example.com"), forGus);
    expect(cole.status).toBe(403);
    expect(cole.body.error).toMatch(/skaters/);
    // A skater, for a skater: refused
    const sam = await w.signedIn("sam@example.com");
    expect((await k.vote(sam, [{ award: "Best keeper", memberId: k.idOf("Cara Captain") }])).status).toBe(400);
    // Only a voted award is voted for
    expect((await k.vote(sam, [{ award: "Top scorer", memberId: k.idOf("Cara Captain") }])).status).toBe(400);
    expect((await k.tournament()).votes).toEqual([]);
  });

  it("never for yourself", async () => {
    const k = await kumiteNight(w);
    // A series' own vote, everyone who played for anyone who played
    await k.dana.call("PUT", `/api/tournaments/${k.id}`, {
      ...(await k.tournament()),
      awards: [{ name: "MVP", about: "", decidedBy: { kind: "vote", voters: "players" } }],
    });
    const cara = await w.signedIn("cara@example.com");
    const self = await k.vote(cara, [{ award: "MVP", memberId: k.idOf("Cara Captain") }]);
    expect(self.status).toBe(400);
    expect(self.body.error).toMatch(/yourself/);
    expect((await k.vote(cara, [{ award: "MVP", memberId: k.idOf("Gus Goalie") }])).status).toBe(200);
  });

  it("one vote each: the same again is nothing, a different one is refused", async () => {
    const k = await kumiteNight(w);
    const sam = await w.signedIn("sam@example.com");
    const gus = [{ award: "Best keeper", memberId: k.idOf("Gus Goalie") }];
    expect((await k.vote(sam, gus)).status).toBe(200);
    expect((await k.vote(sam, gus)).status).toBe(200);
    expect((await k.vote(sam, [{ award: "Best keeper", memberId: k.idOf("Cole Captain") }])).status).toBe(409);
    expect((await k.tournament()).votes[0].cast).toBe(1);
  });

  it.each(seeds(4))("a double tap on Cast (seed %i) is one vote", async (seed) => {
    const k = await kumiteNight(w);
    const sam = await w.signedIn("sam@example.com");
    const gus = [{ award: "Best keeper", memberId: k.idOf("Gus Goalie") }];
    w.db.interleave(seed);
    const taps = await Promise.all([k.vote(sam, gus), k.vote(sam, gus)]);
    w.db.interleave(null);
    expect(taps.map((r) => r.status)).toEqual([200, 200]);
    expect((await k.tournament()).votes[0].cast).toBe(1);
  });

  it("opens with the last match played, not before", async () => {
    const k = await kumiteNight(w);
    const early = await k.dana.call("POST", "/api/tournaments", {
      typeId: KUMITE,
      name: "Kumite Winter 2026",
      heldOn: "2026-12-11",
      kind: "teams",
      playoffs: [],
      teams: [
        { name: "A", logo: null, captainMemberId: k.idOf("Sam Skater"), players: [] },
        { name: "B", logo: null, captainMemberId: k.idOf("Gus Goalie"), players: [] },
      ],
    });
    const sam = await w.signedIn("sam@example.com");
    const r = await sam.call("POST", `/api/tournaments/${early.body.id}/votes`, {
      votes: [{ award: "Best keeper", memberId: k.idOf("Gus Goalie") }],
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/last match/);
  });

  it("closes as the awards are confirmed: a vote after is refused", async () => {
    const k = await kumiteNight(w);
    expect((await k.confirm()).status).toBe(200);
    const late = await k.vote(await w.signedIn("sam@example.com"), [
      { award: "Best keeper", memberId: k.idOf("Gus Goalie") },
    ]);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/confirmed/);
  });

  it.each(seeds(6))(
    "a vote landing as they're confirmed (seed %i) is counted, or refused, never lost",
    async (seed) => {
      const k = await kumiteNight(w);
      const cara = await w.signedIn("cara@example.com");
      const sam = await w.signedIn("sam@example.com");
      await k.vote(cara, [{ award: "Best keeper", memberId: k.idOf("Cole Captain") }]);
      w.db.interleave(seed);
      const [confirmed, voted] = await Promise.all([
        k.confirm(),
        k.vote(sam, [{ award: "Best keeper", memberId: k.idOf("Cole Captain") }]),
      ]);
      w.db.interleave(null);
      expect(confirmed.status).toBe(200);
      const cast = (w.db.raw.prepare("SELECT COUNT(*) n FROM tournament_award_votes").get() as Json).n;
      expect(cast).toBe(voted.status === 200 ? 2 : 1);
      // Either way Cole's ahead and has it: the count that decided it is the one that's kept
      expect(winnerOf(await k.tournament(), "Best keeper")[0].memberId).toBe(k.idOf("Cole Captain"));
    },
  );
});

describe("the votes counted as the awards are confirmed", () => {
  it("the most votes wins", async () => {
    const k = await kumiteNight(w);
    for (const who of ["cara@example.com", "sam@example.com"])
      await k.vote(await w.signedIn(who), [{ award: "Best keeper", memberId: k.idOf("Cole Captain") }]);
    expect((await k.confirm()).status).toBe(200);
    expect(winnerOf(await k.tournament(), "Best keeper")).toMatchObject([{ memberId: k.idOf("Cole Captain") }]);
  });

  it("level on votes, the tie-break: fewest goals against a game (Gus let in 1, Cole 3)", async () => {
    const k = await kumiteNight(w);
    await k.vote(await w.signedIn("cara@example.com"), [{ award: "Best keeper", memberId: k.idOf("Cole Captain") }]);
    await k.vote(await w.signedIn("sam@example.com"), [{ award: "Best keeper", memberId: k.idOf("Gus Goalie") }]);
    expect((await k.confirm()).status).toBe(200);
    expect(winnerOf(await k.tournament(), "Best keeper")).toMatchObject([{ memberId: k.idOf("Gus Goalie") }]);
  });

  it("level with no tie-break: the reply says who's level and nothing's saved; the admin chooses, then it is", async () => {
    const k = await kumiteNight(w);
    const t = await k.tournament();
    const awards = t.awards.map((a: Json) =>
      a.name === "Best keeper" ? { ...a, decidedBy: { kind: "vote", voters: "skaters" } } : a,
    );
    expect((await k.dana.call("PUT", `/api/tournaments/${k.id}`, { ...t, awards })).status).toBe(200);
    await k.vote(await w.signedIn("cara@example.com"), [{ award: "Best keeper", memberId: k.idOf("Cole Captain") }]);
    await k.vote(await w.signedIn("sam@example.com"), [{ award: "Best keeper", memberId: k.idOf("Gus Goalie") }]);
    const level = await k.confirm([], undefined, { keeper: false });
    expect(level.status).toBe(200);
    expect(Object.keys(level.body.tied)).toEqual(["Best keeper"]);
    expect([...level.body.tied["Best keeper"]].sort()).toEqual([k.idOf("Gus Goalie"), k.idOf("Cole Captain")].sort());
    expect((await k.tournament()).awardsConfirmedAt).toBeNull();
    // Voting's still open meanwhile; then the admin chooses Cole
    expect(
      (await k.confirm([{ award: "Best keeper", memberId: k.idOf("Cole Captain") }], undefined, { keeper: false })).body
        .tied,
    ).toBeUndefined();
    expect(winnerOf(await k.tournament(), "Best keeper")).toMatchObject([{ memberId: k.idOf("Cole Captain") }]);
    // Someone who isn't level isn't the admin's to choose: the count decides
    const again = await k.confirm([{ award: "Best keeper", memberId: k.idOf("Sam Skater") }], undefined, {
      keeper: false,
    });
    expect(again.body.tied).toBeDefined();
  });

  it("an admin's say on a vote that isn't level doesn't count: the votes do", async () => {
    const k = await kumiteNight(w);
    await k.vote(await w.signedIn("cara@example.com"), [{ award: "Best keeper", memberId: k.idOf("Cole Captain") }]);
    await k.confirm([{ award: "Best keeper", memberId: k.idOf("Gus Goalie") }]);
    expect(winnerOf(await k.tournament(), "Best keeper")).toMatchObject([{ memberId: k.idOf("Cole Captain") }]);
  });
});

describe("the judges' call, made as they're confirmed", () => {
  it("the admin names it tonight and chooses who; everyone sees the name on the sealed card, the winner at the reveal", async () => {
    const k = await kumiteNight(w);
    expect((await k.confirm()).status).toBe(200);
    const mo = await w.signedIn("mo@example.com");
    const before = await k.tournament(mo);
    // Which awards were given (the judges' call with its name tonight), never who to
    expect(before.titles).toContainEqual({ award: "The Judges' Call", title: "Most Dramatic Fall" });
    expect(before.titles.filter((x: { title: string | null }) => x.title)).toHaveLength(1);
    expect(winnerOf(before, "The Judges' Call")).toEqual([]);
    await k.reveal(0);
    expect(winnerOf(await k.tournament(mo), "The Judges' Call")).toEqual([
      { award: "The Judges' Call", teamId: null, memberId: k.idOf("Sam Skater"), title: "Most Dramatic Fall" },
    ]);
  });

  it("the judges' call goes to a player who played", async () => {
    const k = await kumiteNight(w);
    const r = await k.dana.call(
      "PUT",
      `/api/tournaments/${k.id}/winners`,
      { winners: [{ award: "The Judges' Call", teamId: k.ants }] },
      EVENING,
    );
    expect(r.status).toBe(400);
    const nobody = await k.dana.call(
      "PUT",
      `/api/tournaments/${k.id}/winners`,
      { winners: [{ award: "The Judges' Call", memberId: k.idOf("Mo Member"), title: "Best Celly" }] },
      EVENING,
    );
    expect(nobody.status).toBe(400);
  });

  it("changed before the reveal, it's the last call that counts; once the reveal's started it's refused", async () => {
    const k = await kumiteNight(w);
    await k.confirm();
    expect(
      (
        await k.dana.call(
          "PUT",
          `/api/tournaments/${k.id}/winners`,
          {
            winners: [
              { award: "The Judges' Call", memberId: k.idOf("Gus Goalie"), title: "Best Celly" },
              // Nobody voted for the keeper: the admin's choice stands
              { award: "Best keeper", memberId: k.idOf("Gus Goalie") },
            ],
          },
          EVENING,
        )
      ).status,
    ).toBe(200);
    expect((await k.tournament()).titles.filter((x: { title: string | null }) => x.title)).toEqual([
      { award: "The Judges' Call", title: "Best Celly" },
    ]);
    await k.reveal(0);
    const late = await k.confirm();
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/reveal/);
  });
});

describe("drawn at random, before it's confirmed", () => {
  it("Draw again: the admin confirms whoever the last draw gave", async () => {
    const k = await kumiteNight(w);
    const t = await k.tournament();
    const awards = [...t.awards, { name: "Lucky dip", about: "", decidedBy: { kind: "random" } }];
    expect((await k.dana.call("PUT", `/api/tournaments/${k.id}`, { ...t, awards })).status).toBe(200);
    await k.confirm([{ award: "Lucky dip", memberId: k.idOf("Gus Goalie") }]);
    await k.confirm([{ award: "Lucky dip", memberId: k.idOf("Cole Captain") }]);
    expect(winnerOf(await k.tournament(), "Lucky dip")).toMatchObject([{ memberId: k.idOf("Cole Captain") }]);
  });
});

describe("awards saved before they said how they're decided", () => {
  it("the old guess from the name: confirmed from the data, revealed in turn", async () => {
    const k = await kumiteNight(w);
    // As a tournament's awards were stored before: names and lines only
    w.db.raw.prepare("UPDATE tournaments SET awards = ? WHERE id = ?").run(
      JSON.stringify([
        { name: "Champions", about: "" },
        { name: "Top scorer", about: "" },
        { name: "Best keeper", about: "" },
        { name: "The Dim Mak", about: "" },
      ]),
      k.id,
    );
    // Nothing to vote for: Best keeper was the data's, fewest against
    const r = await k.vote(await w.signedIn("sam@example.com"), [
      { award: "Best keeper", memberId: k.idOf("Gus Goalie") },
    ]);
    expect(r.status).toBe(400);
    const confirmed = await k.dana.call(
      "PUT",
      `/api/tournaments/${k.id}/winners`,
      {
        winners: [
          { award: "Champions", teamId: k.ants },
          { award: "Best keeper", memberId: k.idOf("Gus Goalie") },
          { award: "The Dim Mak", memberId: k.idOf("Sam Skater") },
        ],
      },
      EVENING,
    );
    expect(confirmed.status).toBe(200);
    expect((await k.reveal(0)).status).toBe(200);
    expect(winnerOf(await k.tournament(await w.signedIn("mo@example.com")), "Champions")).toMatchObject([
      { teamId: k.ants },
    ]);
  });
});

describe("a member's votes are theirs", () => {
  it("in their data download, and gone when they're erased", async () => {
    const k = await kumiteNight(w);
    const sam = await w.signedIn("sam@example.com");
    await k.vote(sam, [{ award: "Best keeper", memberId: k.idOf("Gus Goalie") }]);
    const data = await sam.call("GET", "/api/me/data");
    expect(data.body.votes).toMatchObject([
      { tournament: "Kumite Autumn 2026", award: "Best keeper", votedFor: "Gus Goalie" },
    ]);
    expect((await sam.call("DELETE", "/api/me")).status).toBe(200);
    expect((w.db.raw.prepare("SELECT COUNT(*) n FROM tournament_award_votes").get() as Json).n).toBe(0);
  });
});
