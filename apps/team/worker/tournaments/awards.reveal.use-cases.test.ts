// The evening a Kumite ends (ADR 0074, 0044): the last match played, everyone's at The Anchor. Once the awards are
// confirmed, whoever runs it reveals them one at a time, in the order listed, on one card, a drum: a tap turns the
// sealed card face up, Next award rolls on to the next, sealed. Members see each award's winner only once it's out
// (the Worker doesn't send it before then), and every phone follows the drum. A double tap moves it once. Stepping
// back turns them all face down again, the results kept. Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { testWorld } from "../testing";
import { EVENING, KUMITE, MORNING, ROSTER, kumiteNight } from "./awards.testing";

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const ALL = ["The Judges' Call", "Top scorer", "Best goalie", "Champions"];

describe("the awards at The Anchor, one card at a time", () => {
  it("revealed in the order listed, the champions last; members see each only once it's out", async () => {
    const k = await kumiteNight(w);
    const mo = await w.signedIn("mo@example.com");
    // Cara and Sam (the skaters) vote Gus the best goalie
    for (const who of ["cara@example.com", "sam@example.com"])
      expect(
        (await k.vote(await w.signedIn(who), [{ award: "Best goalie", memberId: k.idOf("Gus Goalie") }])).status,
      ).toBe(200);
    expect((await k.confirm()).status).toBe(200);
    // Confirmed, nothing out: the admin sees every winner, a member none (the card's sealed)
    expect(await k.sees()).toEqual({ revealed: 0, next: false, winners: ALL });
    expect(await k.sees(mo)).toEqual({ revealed: 0, next: false, winners: [] });

    // The joke first: sealed, then face up
    expect((await k.reveal(0)).status).toBe(200);
    expect(await k.sees(mo)).toEqual({ revealed: 1, next: false, winners: ["The Judges' Call"] });
    // Next award: the drum rolls on to Top scorer, sealed, for everyone
    expect((await k.roll(1)).status).toBe(200);
    expect(await k.sees(mo)).toEqual({ revealed: 1, next: true, winners: ["The Judges' Call"] });
    expect((await k.reveal(1)).status).toBe(200);
    await k.roll(2);
    expect((await k.reveal(2)).status).toBe(200);
    await k.roll(3);
    // The finale
    expect((await k.reveal(3)).status).toBe(200);
    expect(await k.sees(mo)).toEqual({ revealed: 4, next: false, winners: ALL });
    // The votes made Gus the best goalie
    const t = await k.tournament(mo);
    expect(t.winners.find((x: { award: string }) => x.award === "Best goalie").memberId).toBe(k.idOf("Gus Goalie"));
    // After the last the drum stays on the champions: nothing to roll on to, nothing more to reveal
    expect((await k.roll(4)).status).toBe(409);
    expect((await k.reveal(4)).status).toBe(409);
  });

  it("each tap in its turn: no reveal while the card shows the last one face up, no roll on from a sealed one", async () => {
    const k = await kumiteNight(w);
    await k.confirm();
    // Sealed, nothing to roll on from
    expect((await k.roll(1)).status).toBe(409);
    await k.reveal(0);
    // Face up: the next is revealed only once the drum's rolled on to it (the tap finds nothing to do)
    expect((await k.reveal(1)).status).toBe(200);
    expect((await k.sees()).revealed).toBe(1);
    await k.roll(1);
    expect((await k.reveal(1)).status).toBe(200);
    expect((await k.sees()).revealed).toBe(2);
  });

  it("the awards confirmed first: a reveal before then is refused, and so is one before the last match", async () => {
    const k = await kumiteNight(w);
    const refused = await k.reveal(0);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Confirm the awards/);

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

  it("a member can't reveal one, or roll the drum on", async () => {
    const k = await kumiteNight(w);
    await k.confirm();
    const mo = await w.signedIn("mo@example.com");
    expect((await k.reveal(0, mo)).status).toBe(403);
    await k.reveal(0);
    expect((await k.roll(1, mo)).status).toBe(403);
    expect(await k.sees()).toMatchObject({ revealed: 1, next: false });
  });

  it("a double tap moves the drum once: the second tap finds it moved, and does nothing", async () => {
    const k = await kumiteNight(w);
    await k.confirm();
    expect((await k.reveal(0)).status).toBe(200);
    expect((await k.reveal(0)).status).toBe(200);
    expect((await k.sees()).revealed).toBe(1);
    expect((await k.roll(1)).status).toBe(200);
    expect((await k.roll(1)).status).toBe(200);
    expect(await k.sees()).toMatchObject({ revealed: 1, next: true });
    // A tap from a page that's fallen behind further: refused
    expect((await k.reveal(3)).status).toBe(409);
    expect((await k.sees()).revealed).toBe(1);
  });

  it.each(seeds(6))("two taps at once (seed %i) reveal one, and roll on once", async (seed) => {
    const k = await kumiteNight(w);
    await k.confirm();
    w.db.interleave(seed);
    const taps = await Promise.all([k.reveal(0), k.reveal(0), k.reveal(0)]);
    const rolls = await Promise.all([k.roll(1), k.roll(1)]);
    w.db.interleave(null);
    expect([...taps, ...rolls].map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await k.sees()).toMatchObject({ revealed: 1, next: true });
  });

  it("anyone opening the app later sees what's out so far, and each roll reaches a page that's open", async () => {
    const k = await kumiteNight(w);
    await k.confirm();
    const cara = await w.listening("cara@example.com", EVENING.now);
    await k.reveal(0);
    expect((await cara.next()).data.changed).toContain("tournaments");
    await k.roll(1);
    expect((await cara.next()).data.changed).toContain("tournaments");
    await k.reveal(1);
    const mo = await w.signedIn("mo@example.com");
    expect(await k.sees(mo)).toEqual({ revealed: 2, next: false, winners: ["The Judges' Call", "Top scorer"] });
    cara.close();
  });

  it("the evening over (06:00), every winner is history, revealed or not", async () => {
    const k = await kumiteNight(w);
    await k.confirm();
    await k.reveal(0);
    const mo = await w.signedIn("mo@example.com");
    expect((await k.sees(mo, MORNING)).winners).toEqual(ALL);
  });

  it("each reveal is on the record", async () => {
    const k = await kumiteNight(w);
    await k.confirm();
    await k.revealThenRoll(0);
    await k.reveal(1);
    const rows = w.db.raw
      .prepare("SELECT detail FROM audit_log WHERE action = 'tournament.award_revealed' ORDER BY id")
      .all() as { detail: string }[];
    expect(rows.map((r) => JSON.parse(r.detail).to)).toMatchObject([
      { revealed: 1, award: "The Judges' Call" },
      { revealed: 2, award: "Top scorer" },
    ]);
  });
});

describe("Awards at The Anchor: everyone hears the first one, once", () => {
  it("the first award out tells everyone with the app; the rest don't", async () => {
    const k = await kumiteNight(w);
    await k.confirm();
    const mo = await w.signedIn("mo@example.com");
    await mo.call("PUT", "/api/auth/device", { token: "mo-phone", platform: "ios" });
    await k.reveal(0);
    expect(w.pushes.map(({ token, title, body }) => ({ token, title, body }))).toEqual([
      { token: "mo-phone", title: "Awards at The Anchor", body: "Kumite Autumn 2026: the first one's out." },
    ]);
    w.pushes.length = 0;
    await k.roll(1);
    await k.reveal(1);
    expect(w.pushes).toEqual([]);
  });
});

describe("the awards go out at the party, quiet hours or not", () => {
  it("the first award revealed at 22:40 tells everyone at once, not at 08:00", async () => {
    const k = await kumiteNight(w);
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
  it("turns every award face down again, the drum back on the first; the results and the winners stay", async () => {
    const k = await kumiteNight(w);
    await k.confirm();
    await k.revealThenRoll(0);
    await k.reveal(1);
    const back = await k.dana.call("POST", `/api/tournaments/${k.id}/step-back`, { from: "awards" }, EVENING);
    expect(back.status).toBe(200);
    const mo = await w.signedIn("mo@example.com");
    expect(await k.sees(mo)).toEqual({ revealed: 0, next: false, winners: [] });
    const t = await k.tournament();
    expect(t.games.every((g: { status: string; homeGoals: number }) => g.status === "done" && g.homeGoals === 3)).toBe(
      true,
    );
    expect(t.winners.map((x: { award: string }) => x.award)).toEqual(
      expect.arrayContaining(["Champions", "Top scorer"]),
    );
    expect((await k.dana.call("POST", `/api/tournaments/${k.id}/step-back`, { from: "awards" }, EVENING)).status).toBe(
      409,
    );
    expect((await k.reveal(0)).status).toBe(200);
  });
});
