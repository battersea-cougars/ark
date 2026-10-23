// A phone's copy of the club, catching up as the live hub says what changed (ADR 0072, #112): the edges the live
// use cases (worker/live/live.reads.use-cases.test.ts) don't reach. Changes heard out of order, a read that comes
// back after a newer one, a part no page follows, a refusal, a page out of view. Unit tests: the reads are a fake
// copy of the club's versions, and the waits fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubCopy, type CopyIO } from "./catch-up";

/** A copy whose reads come back with whatever `server` says, and a log of what it asked. */
function phone(over: Partial<CopyIO> = {}) {
  const server = { version: 0, fail: false };
  const asked: string[] = [];
  const applied: Record<string, unknown>[] = [];
  let inView = true;
  const copy: ClubCopy = new ClubCopy({
    readParts: async (names) => {
      asked.push(`parts: ${names.join(", ")}`);
      if (server.fail) throw new Error("offline");
      return { version: server.version, slices: Object.fromEntries(names.map((n) => [n, `${n}@${server.version}`])) };
    },
    readWhole: async () => {
      asked.push("whole");
      if (server.fail) throw new Error("offline");
      copy.wholeAt(server.version);
    },
    apply: (slices) => void applied.push(slices),
    visible: () => inView,
    waitMs: 100,
    random: () => 1,
    ...over,
  });
  return { copy, server, asked, applied, hide: () => (inView = false), show: () => (inView = true) };
}
/** Past the copy's wait, and its read. */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(150);
};

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("a phone's copy of the club, catching up", () => {
  it("reads nothing for a change to a part no page follows, then reads it along with one that is", async () => {
    const p = phone();
    p.copy.follow(["sessions"]);
    p.server.version = 1;
    p.copy.hear({ changed: ["venues"], versions: [1] });
    await settle();
    expect(p.asked).toEqual([]);

    p.server.version = 2;
    p.copy.hear({ changed: ["sessions"], versions: [2] });
    await settle();
    expect(p.asked).toEqual(["parts: venues, sessions"]);
    expect(p.copy.held).toBe(2);
  });

  it("changes heard out of order still leave it holding every version, once both are in", async () => {
    const p = phone();
    p.copy.follow(["sessions", "charges"]);
    p.server.version = 2;
    // Version 2's event arrives before version 1's
    p.copy.hear({ changed: ["charges"], versions: [2] });
    p.copy.hear({ changed: ["sessions"], versions: [1] });
    await settle();
    expect(p.asked).toHaveLength(1);
    expect(p.asked[0]).toMatch(/^parts: /);
    expect(p.asked[0].split(": ")[1].split(", ").sort()).toEqual(["charges", "sessions"]);
    expect(p.copy.held).toBe(2);
    expect(p.copy.lacking()).toEqual([]);
  });

  it("a version it never hears of leaves it short: it holds what came before, and the parts past it", async () => {
    const p = phone();
    p.copy.follow(["sessions"]);
    p.server.version = 3;
    // Version 2 told nobody (a cron's change)
    p.copy.hear({ changed: ["sessions"], versions: [1] });
    p.copy.hear({ changed: ["sessions"], versions: [3] });
    await settle();
    expect(p.copy.held).toBe(1);
    expect(p.copy.lacking()).toEqual([]);
    // The whole club, on the page's beat, puts it right
    p.copy.wholeAt(3);
    expect(p.copy.held).toBe(3);
  });

  it("a read that left before a newer one came back is dropped, so the newer stays", () => {
    const p = phone();
    expect(p.copy.partsAt(5, { sessions: "new" })).toEqual({ sessions: "new" });
    expect(p.copy.partsAt(4, { sessions: "old", venues: "v4" })).toEqual({ venues: "v4" });
    // The same version again is the same part: kept
    expect(p.copy.partsAt(5, { sessions: "again" })).toEqual({ sessions: "again" });
  });

  it("a part read before the whole club came back older than it is dropped too", () => {
    const p = phone();
    p.copy.wholeAt(10);
    expect(p.copy.partsAt(9, { sessions: "old" })).toEqual({});
    expect(p.copy.partsAt(10, { sessions: "same" })).toEqual({ sessions: "same" });
  });

  it("a change it already holds (an echo of its own reply) reads nothing", async () => {
    const p = phone();
    p.copy.follow(["sessions"]);
    p.copy.partsAt(1, { sessions: "mine" });
    expect(p.copy.held).toBe(0);
    p.copy.hear({ changed: ["sessions"], versions: [1] });
    await settle();
    expect(p.asked).toEqual([]);
    expect(p.copy.held).toBe(1);
  });

  it("a burst of changes while a read is out is one more read after it, not one each", async () => {
    let release!: () => void;
    const p = phone({
      readParts: async (names) => {
        p.asked.push(`parts: ${names.join(", ")}`);
        // Read at the version it was when the read went (the server's answer is on its way back)
        const version = p.server.version;
        if (p.asked.length === 1) await new Promise<void>((r) => (release = r));
        return { version, slices: Object.fromEntries(names.map((n) => [n, n])) };
      },
    });
    p.copy.follow(["sessions"]);
    p.server.version = 1;
    p.copy.hear({ changed: ["sessions"], versions: [1] });
    await settle();
    expect(p.asked).toHaveLength(1);
    for (let v = 2; v <= 5; v++) {
      p.server.version = v;
      p.copy.hear({ changed: ["sessions"], versions: [v] });
    }
    await settle();
    expect(p.asked).toHaveLength(1);
    release();
    await settle();
    expect(p.asked).toHaveLength(2);
    expect(p.copy.held).toBe(5);
  });

  it("a change to who can do what reads the whole club, not the part", async () => {
    const p = phone();
    p.copy.follow(["sessions"]);
    p.server.version = 1;
    p.copy.hear({ changed: ["roles", "sessions"], versions: [1] });
    await settle();
    expect(p.asked).toEqual(["whole"]);
    expect(p.copy.held).toBe(1);
  });

  it("an event from an older Worker, with no versions, on a part it follows reads the whole club", async () => {
    const p = phone();
    p.copy.follow(["sessions"]);
    p.copy.hear({ changed: ["sessions"] });
    await settle();
    expect(p.asked).toEqual(["whole"]);
    // One that names only parts nobody follows changes nothing
    p.copy.hear({ changed: ["venues"] });
    await settle();
    expect(p.asked).toEqual(["whole"]);
  });

  it("offline or refused, it doesn't try again on its own: the next change, or the page's beat, does", async () => {
    const p = phone();
    p.copy.follow(["sessions"]);
    p.server.fail = true;
    p.server.version = 1;
    p.copy.hear({ changed: ["sessions"], versions: [1] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.asked).toHaveLength(1);
    expect(p.copy.held).toBe(0);

    p.server.fail = false;
    p.server.version = 2;
    p.copy.hear({ changed: ["sessions"], versions: [2] });
    await settle();
    expect(p.asked).toHaveLength(2);
    expect(p.copy.held).toBe(2);
  });

  it("out of view, it reads nothing; and stopped, nothing ever", async () => {
    const p = phone();
    p.copy.follow(["sessions"]);
    p.hide();
    p.copy.hear({ changed: ["sessions"], versions: [1] });
    await settle();
    expect(p.asked).toEqual([]);

    p.show();
    p.copy.stop();
    p.copy.hear({ changed: ["sessions"], versions: [2] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.asked).toEqual([]);
  });

  it("a page that stops following takes its parts with it", async () => {
    const p = phone();
    const unfollow = p.copy.follow(["sessions"]);
    unfollow();
    p.copy.hear({ changed: ["sessions"], versions: [1] });
    await settle();
    expect(p.asked).toEqual([]);
  });

  it("waits at random up to its longest wait, so a room of phones doesn't ask at once", async () => {
    const p = phone({ random: () => 0.5, waitMs: 1000 });
    p.copy.follow(["sessions"]);
    p.copy.hear({ changed: ["sessions"], versions: [1] });
    await vi.advanceTimersByTimeAsync(499);
    expect(p.asked).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.asked).toHaveLength(1);
  });
});

describe("a live match the hub sends with its change (#161)", () => {
  const match = (homeGoals: number) => ({ tournamentId: 3, games: [{ id: 1, homeGoals }] });
  /** A copy that holds version 4 of everything, a tournament page open, and the matches it put in place. */
  const following = (over: Partial<CopyIO> = {}) => {
    const put: number[] = [];
    const p = phone({ applyMatch: (m) => (put.push((m.games[0] as { homeGoals: number }).homeGoals), true), ...over });
    p.copy.wholeAt(4);
    p.copy.follow(["tournaments"]);
    return { ...p, put };
  };

  it("matches that follow on from the version held go in place one after another, and nothing's read", async () => {
    const p = following();
    p.copy.hear({
      changed: ["tournaments"],
      versions: [5, 6],
      parts: [
        { version: 6, match: match(2) },
        { version: 5, match: match(1) },
      ],
    });
    await settle();
    expect(p.put).toEqual([1, 2]);
    expect(p.copy.held).toBe(6);
    expect(p.asked).toEqual([]);
  });

  it("a match after a change it never heard of is left: the tournaments are read instead", async () => {
    const p = following();
    p.server.version = 6;
    p.copy.hear({ changed: ["tournaments"], versions: [6], parts: [{ version: 6, match: match(2) }] });
    await settle();
    expect(p.put).toEqual([]);
    expect(p.asked).toEqual(["parts: tournaments"]);
  });

  it("in a second with another change, only the match's own version goes in place; the other part is read", async () => {
    const p = following();
    p.server.version = 6;
    p.copy.hear({ changed: ["tournaments", "sessions"], versions: [5, 6], parts: [{ version: 5, match: match(1) }] });
    await settle();
    expect(p.put).toEqual([1]);
    expect(p.asked).toEqual(["parts: tournaments, sessions"]);
    expect(p.copy.held).toBe(6);
  });

  it("a match no newer than what the copy has (its own change's reply) changes nothing", async () => {
    const p = following();
    p.copy.partsAt(5, { tournaments: "mine@5" });
    p.copy.hear({ changed: ["tournaments"], versions: [5], parts: [{ version: 5, match: match(1) }] });
    await settle();
    expect(p.put).toEqual([]);
    expect(p.copy.held).toBe(5);
    expect(p.asked).toEqual([]);
  });

  it("a match whose tournament the copy hasn't got is read", async () => {
    const p = following({ applyMatch: () => false });
    p.server.version = 5;
    p.copy.hear({ changed: ["tournaments"], versions: [5], parts: [{ version: 5, match: match(1) }] });
    await settle();
    expect(p.asked).toEqual(["parts: tournaments"]);
  });
});
