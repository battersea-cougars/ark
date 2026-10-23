// Where an edition stands at its edges (ADR 0074): sign-up opening and closing at London's midnight, on the days the
// clocks change (25 October 2026 back, 28 March 2027 forward), an admin's status against the games, and which edition
// a series opens on when there's none, or one on today. Pure logic; "now" is set with fake timers, never the real clock.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "../demo/model";
import { currentOf, editionState, latestOf, stageOf } from "./edition";
import { stageBadge } from "./tournament-front";
import { game } from "./kumite.testing";

const cup = (o: Partial<Tournament> = {}) =>
  ({
    id: 1,
    status: "planned",
    heldOn: "2026-11-14",
    startTime: "11:00",
    endTime: "16:00",
    season: null,
    signupOpensOn: null,
    signupClosesOn: null,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    teams: [
      { id: 1, players: [] },
      { id: 2, players: [] },
    ],
    games: [],
    going: [],
    ...o,
  }) as unknown as Tournament;

/** editionState asks London's today of the clock: set it to this instant. */
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};
afterEach(() => void vi.useRealTimers());

describe("sign-up opens and closes at London's midnight", () => {
  it("open all of its closing day in summer time, to 23:59 London (22:59 UTC); shut at midnight", () => {
    const t = cup({ status: "open", signupClosesOn: "2026-10-24" });
    at("2026-10-24T22:59:00Z");
    expect(editionState(t)).toBe("open");
    at("2026-10-24T23:00:00Z");
    expect(editionState(t)).toBe("planned");
  });

  it("the day the clocks go back (25 October 2026), it's open to 23:59 London, which is 23:59 UTC by then", () => {
    const t = cup({ status: "open", signupClosesOn: "2026-10-25" });
    at("2026-10-25T00:30:00Z"); // 01:30 BST
    expect(editionState(t)).toBe("open");
    at("2026-10-25T23:59:00Z");
    expect(editionState(t)).toBe("open");
    at("2026-10-26T00:00:00Z");
    expect(editionState(t)).toBe("planned");
  });

  it("the day the clocks go forward (28 March 2027), it shuts at London's midnight, 23:00 UTC", () => {
    const t = cup({ status: "open", heldOn: "2027-04-10", signupClosesOn: "2027-03-28" });
    at("2027-03-28T22:59:00Z");
    expect(editionState(t)).toBe("open");
    at("2027-03-28T23:00:00Z");
    expect(editionState(t)).toBe("planned");
  });

  it("set to open on a day, it opens at that day's London midnight, not UTC's", () => {
    const t = cup({ status: "planned", signupOpensOn: "2026-10-20" });
    at("2026-10-19T22:59:00Z"); // 23:59 BST on the 19th
    expect(editionState(t)).toBe("planned");
    at("2026-10-19T23:00:00Z"); // midnight BST: the 20th
    expect(editionState(t)).toBe("open");
  });

  it("opened by hand, it stays open whatever its opening day says, until its closing day's over", () => {
    at("2026-10-06T11:00:00Z");
    expect(editionState(cup({ status: "open", signupOpensOn: "2026-11-01" }))).toBe("open");
    expect(editionState(cup({ status: "open", signupClosesOn: "2026-10-05" }))).toBe("planned");
  });
});

describe("an admin's status against the games", () => {
  it("marked finished with no games: done; marked live with none: on now", () => {
    at("2026-10-06T11:00:00Z");
    expect(editionState(cup({ status: "finished" }))).toBe("done");
    expect(editionState(cup({ status: "live" }))).toBe("live");
  });

  it("marked finished while a game's still being scored: done, the admin's word ends it", () => {
    at("2026-10-06T11:00:00Z");
    expect(editionState(cup({ status: "finished", games: [game(1, "live")] as never }))).toBe("done");
  });

  it("every game played wins over a status left at open: done, and the stamp says so", () => {
    at("2026-10-06T11:00:00Z");
    const t = cup({ status: "open", games: [game(1, "done")] as never });
    expect(editionState(t)).toBe("done");
    expect(stageBadge(t, { shortName: "Cup" }, "2026-10-06")).toMatchObject({ label: "Done", tone: "done" });
  });
});

describe("stageOf: games come first", () => {
  it("a draft still open once fixtures exist shows the fixtures; teams that entered with games but none listed too", () => {
    expect(stageOf(cup({ kind: "draft", draftState: "open", games: [game(1, "next")] as never }))).toBe("fixtures");
    expect(stageOf(cup({ teams: [], games: [game(1, "next")] as never }))).toBe("fixtures");
  });

  it("just a season with its fixtures out doesn't shout its name on its season's last day", () => {
    const t = cup({ season: "summer", heldOn: "2027-08-31", games: [game(1, "next")] as never });
    at("2027-08-31T10:00:00Z");
    expect(stageBadge(t, { shortName: "Cup" }, "2027-08-31").label).not.toBe("Cup!");
    const dated = cup({ heldOn: "2027-08-31", games: [game(1, "next")] as never });
    expect(stageBadge(dated, { shortName: "Cup" }, "2027-08-31")).toMatchObject({ label: "Cup!", tone: "live" });
  });
});

describe("which edition a series opens on, at the edges", () => {
  it("one on today, not yet played, is the next one; the day after, unplayed, it isn't", () => {
    at("2026-10-06T11:00:00Z");
    const old = cup({ id: 1, heldOn: "2026-06-01", status: "finished" });
    const today = cup({ id: 2, heldOn: "2026-10-06" });
    expect(latestOf([old, today], "2026-10-06")?.id).toBe(2);
    expect(currentOf([old, today], "2026-10-06")?.id).toBe(2);
    expect(latestOf([old, today], "2026-10-07")?.id).toBe(1);
    expect(currentOf([old, today], "2026-10-07")).toBeUndefined();
  });

  it("only one that came and went unplayed, and none played: that one, the last there is", () => {
    at("2026-10-06T11:00:00Z");
    const missed = cup({ id: 3, heldOn: "2026-09-01" });
    expect(latestOf([missed], "2026-10-06")?.id).toBe(3);
  });

  it("two under way at once: the earlier", () => {
    at("2026-10-06T11:00:00Z");
    const a = cup({ id: 1, heldOn: "2026-10-10", status: "live" });
    const b = cup({ id: 2, heldOn: "2026-10-03", games: [game(1, "live")] as never });
    expect(latestOf([a, b], "2026-10-06")?.id).toBe(2);
  });
});
