import { describe, expect, it } from "vitest";
import type { Plan } from "../demo/data";
import { rosterGroups } from "./roster-groups";

// A Friday's In list as the server sends it: Quarterly skaters first, then sign-up order, keepers among them
const PLANS: Record<number, Plan> = {
  1: "Subscription",
  2: "Subscription",
  3: "Pay as you go",
  4: "Keeper",
  5: "Pay as you go",
  6: "Keeper",
  7: "Pay as you go",
};
const plan = (id: number) => PLANS[id];

describe("Friday's Who's coming, grouped by plan", () => {
  it("puts Quarterly, then Pay as you go, then Keepers, each in the list's order", () => {
    const { groups } = rosterGroups([1, 2, 3, 4, 5, 6, 7], plan);
    expect(groups.map((g) => [g.title, g.ids])).toEqual([
      ["Quarterly", [1, 2]],
      ["Pay as you go", [3, 5, 7]],
      ["Keepers", [4, 6]],
    ]);
  });

  it("numbers skaters by their place in the queue, on across both groups, and keepers on their own", () => {
    const { numbers } = rosterGroups([1, 2, 3, 4, 5, 6, 7], plan);
    expect([1, 2, 3, 5, 7].map((id) => numbers.get(id))).toEqual([1, 2, 3, 4, 5]);
    expect([4, 6].map((id) => numbers.get(id))).toEqual([1, 2]);
  });

  it("leaves out a group with nobody in it", () => {
    const { groups } = rosterGroups([3, 5], plan);
    expect(groups.map((g) => g.title)).toEqual(["Pay as you go"]);
  });

  it("keeps the numbers whatever a search leaves showing: they come from the whole list", () => {
    const { numbers } = rosterGroups([1, 2, 3, 4, 5], plan);
    expect(numbers.get(5)).toBe(4);
  });
});
