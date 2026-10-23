// The draft's jobs in the page's one Manage (ADR 0060): which apply at each step, and what they say.
import { describe, expect, it } from "vitest";
import { draftJobsOf } from "./draft-jobs";
import { snakeDraft as draft } from "./kumite.testing";

const names = { player: (id: number | null) => `Player ${id}`, team: (i: number) => ["Team Cara", "Team Cole"][i] };
const jobs = (t: ReturnType<typeof draft>, runs = true, adds = true) =>
  draftJobsOf(t, { runs, adds }, names).map((j) => j.job);

describe("the draft's jobs in Manage", () => {
  it("before it opens: adding a player; nothing to undo or reset", () => {
    expect(jobs(draft(0, "none"))).toEqual(["add"]);
  });

  it("open with picks: undo (naming the pick), add, close it early, reset; in that order", () => {
    expect(jobs(draft(3))).toEqual(["undo", "add", "leaveOut", "reset"]);
    const [undo, , leaveOut, reset] = draftJobsOf(draft(3), { runs: true, adds: true }, names);
    // The third pick was Cole's, Player 12
    expect(undo.sub).toBe("Team Cole → Player 12");
    expect(leaveOut.sub).toBe("3 still to pick, left out");
    expect(reset.danger).toBe(true);
  });

  it("everyone picked: no early close (the Seal card closes it), undo and reset still there", () => {
    expect(jobs(draft(6))).toEqual(["undo", "add", "reset"]);
  });

  it("closed: none (Back a step reopens it)", () => {
    expect(jobs(draft(6, "closed"))).toEqual([]);
  });

  it("only what you're allowed: a captain gets none; adding is its own permission", () => {
    expect(jobs(draft(3), false, false)).toEqual([]);
    expect(jobs(draft(3), false, true)).toEqual(["add"]);
    expect(jobs(draft(3), true, false)).toEqual(["undo", "leaveOut", "reset"]);
  });

  it("isn't for a tournament whose teams enter", () => {
    expect(jobs({ ...draft(3), kind: "teams" })).toEqual([]);
  });
});
