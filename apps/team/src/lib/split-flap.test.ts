// A split-flap board (lib/SplitFlap): each character turns through a few others and settles on its own, left to right,
// the same flaps for everyone watching.
import { describe, expect, it } from "vitest";
import { FLAP_CHARS, FLAP_STEP_MS, flapAt, flapBoard, flapMs, flapSequence, seeded } from "./split-flap";

describe("a split-flap board", () => {
  it("a cell turns through 3 to 6 others from the board's set, never its own or the same twice running, then settles", () => {
    const next = seeded(7);
    for (const target of ["A", "Z", "0", " ", "'"]) {
      const seq = flapSequence(target, next);
      expect(seq.at(-1)).toBe(target);
      const turns = seq.slice(0, -1);
      expect(turns.length).toBeGreaterThanOrEqual(3);
      expect(turns.length).toBeLessThanOrEqual(6);
      for (const [k, c] of turns.entries()) {
        expect(FLAP_CHARS).toContain(c);
        expect(c).not.toBe(target);
        expect(c).not.toBe(turns[k - 1]);
      }
    }
  });

  it("the same text turns the same flaps (a seed), so everyone watching sees one board", () => {
    expect(flapBoard("Top scorer")).toEqual(flapBoard("Top scorer"));
    expect(flapBoard("Top scorer")).not.toEqual(flapBoard("Top scorers"));
  });

  it("the board is the text in capitals, a word at a time, the cells starting left to right", () => {
    const board = flapBoard("Shared  by 3");
    expect(board.map((w) => w.map((c) => c.char).join(""))).toEqual(["SHARED", "BY", "3"]);
    const starts = board.flat().map((c) => c.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts[0]).toBe(0);
  });

  it("a cell is blank till it starts, shows its flaps in turn, then its character for good", () => {
    const [cell] = flapBoard("X").flat();
    expect(flapAt(cell, -1)).toBe(" ");
    expect(flapAt(cell, 0)).toBe(cell.seq[0]);
    expect(flapAt(cell, FLAP_STEP_MS)).toBe(cell.seq[1]);
    expect(flapAt(cell, 10_000)).toBe("X");
    expect(flapMs("X")).toBe(cell.seq.length * FLAP_STEP_MS);
  });

  it("a long team name clacks faster, not longer: about a second, however long", () => {
    expect(flapMs("Blazing Pucks of Battersea Park Rollers")).toBeLessThanOrEqual(1100);
    expect(flapMs("Top scorer")).toBeLessThan(flapMs("Blazing Pucks of Battersea"));
  });
});
