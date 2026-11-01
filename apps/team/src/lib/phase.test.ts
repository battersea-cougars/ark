// Past, on or next, by status (ADR 0074, #182): "status decides whether an event or game is past, on or next, never its
// date or time" (the user, 2026-10-25). The cases that are easy to get wrong: a Kumite played early, a game running
// late, a night or a Kumite whose time has gone by without being played or closed. Pure, so a unit test.
import { describe, expect, it } from "vitest";
import type { Tournament } from "../demo/model";
import { londonISO } from "./dates";
import { gamePhase, nightPhase, timedPhase, tournamentPhase } from "./phase";
import { currentMatchOf } from "./tournament-front";

const game = (position: number, status: "next" | "live" | "done") => ({ id: position, position, status });
/** A Kumite set for Friday 30 October, its three matches as given. */
const kumite = (statuses: ("next" | "live" | "done")[], over: Partial<Tournament> = {}) =>
  ({
    id: 1,
    status: "planned",
    heldOn: "2026-10-30",
    startTime: "19:00",
    endTime: "21:30",
    season: null,
    signupOpensOn: null,
    signupClosesOn: null,
    games: statuses.map((s, i) => game(i + 1, s)),
    ...over,
  }) as unknown as Tournament;

describe("a tournament is past, on or next by its games, never its date", () => {
  it("played early, every match done, its day still ahead: past", () => {
    expect(tournamentPhase(kumite(["done", "done", "done"]))).toBe("past");
  });

  it("an admin marked it finished: past, whatever its date", () => {
    expect(tournamentPhase(kumite([], { status: "finished" }))).toBe("past");
  });

  it("a match under way, or one played and the next not started: on, before its day too", () => {
    expect(tournamentPhase(kumite(["live", "next", "next"]))).toBe("on");
    expect(tournamentPhase(kumite(["done", "next", "next"]))).toBe("on");
  });

  it("not started, its day gone by: still next, until it's played", () => {
    expect(tournamentPhase(kumite(["next", "next", "next"], { heldOn: "2026-10-02" }))).toBe("next");
  });
});

describe("a game is past, on or next by its status, never its kick-off", () => {
  it("running late: the game set for 1:00, starting at 1:45, is the current one; the one after stays next", () => {
    // 1:30 and nobody's started the 1:00: it's still the one up, not the 1:30
    const games = [game(1, "done"), game(2, "next"), game(3, "next")];
    expect(currentMatchOf(games)?.position).toBe(2);
    // Started at 1:45: on, until it's over
    const late = [game(1, "done"), game(2, "live"), game(3, "next")];
    expect(late.map(gamePhase)).toEqual(["past", "on", "next"]);
    expect(currentMatchOf(late)?.position).toBe(2);
    // Over: then the next one's up
    expect(currentMatchOf([game(1, "done"), game(2, "done"), game(3, "next")])?.position).toBe(3);
  });
});

describe("a training night is held once its register closes, not when its time is up", () => {
  const night = { heldOn: "2026-10-23", startsAt: londonISO("2026-10-23", "19:30") };
  it("before it starts: next", () => {
    expect(nightPhase(night, new Date(londonISO("2026-10-23", "18:00")))).toBe("next");
  });

  it("past its end, its register still open: on, after midnight too, till 06:00", () => {
    expect(nightPhase(night, new Date(londonISO("2026-10-23", "22:30")))).toBe("on");
    expect(nightPhase(night, new Date(londonISO("2026-10-24", "05:59")))).toBe("on");
  });

  it("from 06:00 the morning after, or once its register's closed: past", () => {
    expect(nightPhase(night, new Date(londonISO("2026-10-24", "06:00")))).toBe("past");
    const closed = { ...night, registerClosedAt: "2026-10-23T21:00:00Z" };
    expect(nightPhase(closed, new Date(londonISO("2026-10-23", "22:30")))).toBe("past");
  });
});

describe("something with no status goes by its time", () => {
  it("a social: next, on from its start, past from its end", () => {
    const [from, to] = ["2026-10-10T18:00:00Z", "2026-10-10T22:00:00Z"];
    expect(timedPhase(from, to, new Date("2026-10-10T17:00:00Z"))).toBe("next");
    expect(timedPhase(from, to, new Date("2026-10-10T21:00:00Z"))).toBe("on");
    expect(timedPhase(from, to, new Date("2026-10-10T22:00:00Z"))).toBe("past");
  });
});
