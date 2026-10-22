// A turn changing as one timeline (ADR 0060): burn the name in, hold, glide to the next team, then move the light;
// your turn on a phone, then the players. Picks landing mid-way wait their turn.
import { describe, expect, it } from "vitest";
import { sequencer, turnSteps, type Landing } from "./draft-sequence";

const landing = (memberId: number, team: number, clock: number, made: number): Landing => ({
  memberId,
  team,
  clock,
  made,
});

describe("a turn changing, as one timeline", () => {
  it("burns the name in, holds, glides to the next team, and only then moves the light", () => {
    expect(turnSteps().map((s) => s.kind)).toEqual(["burn", "hold", "scroll", "highlight"]);
    expect(turnSteps().map((s) => s.ms)).toEqual([1200, 800, 400, 300]);
  });

  it("your turn on a phone, following: the players slide in last", () => {
    expect(turnSteps({ toPlayers: true }).map((s) => s.kind)).toEqual([
      "burn",
      "hold",
      "scroll",
      "highlight",
      "players",
    ]);
  });

  it("less motion: a short glow, no glide, the same order", () => {
    expect(turnSteps({ reduced: true }).map((s) => [s.kind, s.ms])).toEqual([
      ["burn", 300],
      ["hold", 800],
      ["scroll", 0],
      ["highlight", 0],
    ]);
  });

  it("a pick landing mid-way waits for the one before to finish, then runs its own steps in order", async () => {
    const seen: string[] = [];
    let release: () => void = () => {};
    // The first step of the first landing waits till we let it go, so the second lands mid-sequence
    let first = true;
    const sleep = (ms: number) =>
      first && ms === 1200 ? ((first = false), new Promise<void>((r) => (release = r))) : Promise.resolve();
    const seq = sequencer(
      (step, l) => seen.push(`${l.memberId}:${step.kind}`),
      () => turnSteps(),
      sleep,
    );
    const done = seq.land(landing(10, 0, 1, 1));
    void seq.land(landing(11, 1, 1, 2));
    expect(seen).toEqual(["10:burn"]);
    expect(seq.busy).toBe(true);
    expect(seq.waiting.map((l) => l.memberId)).toEqual([11]);
    release();
    await done;
    expect(seen).toEqual([
      "10:burn",
      "10:hold",
      "10:scroll",
      "10:highlight",
      "11:burn",
      "11:hold",
      "11:scroll",
      "11:highlight",
    ]);
    expect(seq.busy).toBe(false);
  });
});
