// The simulator's loop (ADR 0123): a move at a time (a few at Spin kick), paced to watch at Kata, quicker at Sparring
// and Spin kick, paused, resumed and stopped from the control.
// Fake timers stand in for the clock; the requests are a script of replies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FLOOR_MS,
  MOST_MOVES,
  paceOf,
  simulator,
  WATCH_MS,
  type Move,
  type MoveKind,
  type SimulationState,
  type Speed,
} from "./simulation";

const reply = (move: MoveKind, done = false, moves = 1): Move => ({ done, move, said: move, moves });
const SPEEDS: Speed[] = ["kata", "sparring", "spinKick"];

/**
 * A run over replies that come back at once: `asked` counts the requests, `wanted` the moves each asked for,
 * `ended` how it ended.
 */
function harness(replies: (Move | null)[]) {
  const state: SimulationState = { id: 0, status: "idle", speed: "kata", said: "" };
  let asked = 0;
  const wanted: number[] = [];
  const ends: (Move | null)[] = [];
  const sim = simulator(
    state,
    async (_, moves) => {
      wanted.push(moves);
      return replies[Math.min(asked++, replies.length - 1)];
    },
    (last) => ends.push(last),
  );
  return { state, sim, asked: () => asked, wanted, ends };
}

/** Let the replies (promises) land, then move the clock on `ms`. */
async function after(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pacing", () => {
  it("waits each move out: a pick its turn change, a goal less, the next match longer", async () => {
    const h = harness([reply("pick"), reply("goal"), reply("fulltime"), reply("done", true)]);
    void h.sim.start(7);
    await after(0);
    expect(h.asked()).toBe(1);
    expect(h.state).toMatchObject({ id: 7, status: "running", said: "pick" });
    // Not before the pick's turn change has played out
    await after(WATCH_MS.pick - 1);
    expect(h.asked()).toBe(1);
    await after(1);
    expect(h.asked()).toBe(2);
    await after(WATCH_MS.goal);
    expect(h.asked()).toBe(3);
    await after(WATCH_MS.fulltime);
    expect(h.asked()).toBe(4);
    // Done: the control goes, saying how it ended
    expect(h.state).toMatchObject({ id: 0, status: "idle" });
    expect(h.ends).toEqual([reply("done", true)]);
  });

  it("the paces fit what the page shows, and no speed beats a member's 60 changes a minute", () => {
    // The draft room's turn change: burn 1.2s, hold 0.8s, scroll 0.4s, highlight 0.3s
    expect(WATCH_MS.pick).toBeGreaterThanOrEqual(2700);
    expect(WATCH_MS.goal).toBeGreaterThanOrEqual(1500);
    expect(WATCH_MS.fulltime).toBeGreaterThanOrEqual(3000);
    for (const move of Object.keys(WATCH_MS) as MoveKind[])
      for (const speed of SPEEDS) {
        expect(paceOf(move, speed)).toBeGreaterThanOrEqual(FLOOR_MS);
        expect(60_000 / paceOf(move, speed)).toBeLessThan(60);
      }
    // Slowest to fastest: Kata, Sparring, then Spin kick at the floor
    expect(paceOf("fulltime", "sparring")).toBeLessThan(paceOf("fulltime", "kata"));
    for (const move of Object.keys(WATCH_MS) as MoveKind[]) {
      expect(paceOf(move, "spinKick")).toBe(FLOOR_MS);
      expect(paceOf(move, "sparring")).toBeLessThanOrEqual(paceOf(move, "kata"));
    }
  });

  it("spin kick asks for a few moves a request, at the floor, and says how many it made", async () => {
    const h = harness([reply("goal", false, 3), reply("pick"), reply("done", true, 2)]);
    h.state.speed = "spinKick";
    void h.sim.start(1);
    await after(0);
    expect(h.state.said).toBe("3 moves: goal");
    await after(FLOOR_MS - 1);
    expect(h.asked()).toBe(1);
    await after(1);
    expect(h.asked()).toBe(2);
    // One move made: just what it was
    expect(h.state.said).toBe("pick");
    await after(FLOOR_MS);
    expect(h.wanted).toEqual([MOST_MOVES, MOST_MOVES, MOST_MOVES]);
    expect(h.state.status).toBe("idle");
  });

  it("kata and sparring ask for one move a request", async () => {
    const h = harness([reply("goal"), reply("goal"), reply("done", true)]);
    void h.sim.start(1);
    await after(WATCH_MS.goal);
    h.sim.speed("sparring");
    await after(FLOOR_MS);
    expect(h.wanted).toEqual([1, 1, 1]);
  });

  it("the speed changed while it waits counts at once", async () => {
    const h = harness([reply("fulltime"), reply("done", true)]);
    void h.sim.start(1);
    await after(1000);
    h.sim.speed("sparring");
    // Sparring: a quarter of 3s, but never under the floor, counted from when the move began
    await after(FLOOR_MS - 1000);
    expect(h.asked()).toBe(2);
  });

  it("a second start while it runs doesn't start another", async () => {
    const h = harness([reply("goal"), reply("done", true)]);
    void h.sim.start(1);
    void h.sim.start(2);
    await after(0);
    expect(h.asked()).toBe(1);
    expect(h.state.id).toBe(1);
  });
});

describe("pause, resume, stop", () => {
  it("pause holds after the move in flight; resume carries on", async () => {
    const h = harness([reply("goal"), reply("goal"), reply("done", true)]);
    void h.sim.start(1);
    h.sim.pause();
    await after(0);
    // The move in flight landed; nothing more while paused, however long
    expect(h.asked()).toBe(1);
    expect(h.state).toMatchObject({ status: "paused", said: "goal" });
    await after(60_000);
    expect(h.asked()).toBe(1);
    h.sim.resume();
    await after(0);
    // Its wait was over long ago: the next move at once
    expect(h.asked()).toBe(2);
    expect(h.state.status).toBe("running");
  });

  it("resumed straight away, it still waits the move out", async () => {
    const h = harness([reply("pick"), reply("done", true)]);
    void h.sim.start(1);
    await after(500);
    h.sim.pause();
    await after(200);
    h.sim.resume();
    await after(WATCH_MS.pick - 701);
    expect(h.asked()).toBe(1);
    await after(1);
    expect(h.asked()).toBe(2);
  });

  it("stop ends it: no more requests, the control goes, a late reply is let go", async () => {
    let land: (m: Move) => void = () => {};
    const state: SimulationState = { id: 0, status: "idle", speed: "kata", said: "" };
    let asked = 0;
    const ends: (Move | null)[] = [];
    const sim = simulator(
      state,
      () => {
        asked++;
        return new Promise<Move>((go) => (land = go));
      },
      (last) => ends.push(last),
    );
    void sim.start(1);
    await after(0);
    sim.stop();
    expect(state).toMatchObject({ id: 0, status: "idle" });
    expect(ends).toEqual([null]);
    land(reply("goal"));
    await after(60_000);
    expect(asked).toBe(1);
    expect(state.said).toBe("");
    // ...and it can be started again
    void sim.start(1);
    await after(0);
    expect(asked).toBe(2);
    expect(state.status).toBe("running");
  });

  it("stop while paused ends it", async () => {
    const h = harness([reply("goal"), reply("done", true)]);
    void h.sim.start(1);
    await after(0);
    h.sim.pause();
    h.sim.stop();
    await after(60_000);
    expect(h.asked()).toBe(1);
    expect(h.state.status).toBe("idle");
  });

  it("a refusal ends it (the app has said why)", async () => {
    const h = harness([reply("order"), null]);
    void h.sim.start(1);
    await after(WATCH_MS.order);
    expect(h.asked()).toBe(2);
    expect(h.state.status).toBe("idle");
    expect(h.ends).toEqual([null]);
  });

  it("pause and resume do nothing when nothing's running", () => {
    const h = harness([reply("done", true)]);
    h.sim.pause();
    h.sim.resume();
    h.sim.stop();
    expect(h.state.status).toBe("idle");
    expect(h.ends).toEqual([]);
  });
});
