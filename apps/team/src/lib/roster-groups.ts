import type { Plan } from "../demo/data";

// Friday's Who's coming, a tab at a time, grouped by plan: Quarterly, Pay as you go, Keepers (the three plans,
// ADR 0007). The skaters are one queue (ADR 0131), Quarterly first, so they're numbered by their place in it, on
// across both groups; keepers' places are counted apart, so they're numbered on their own.

/** A group under its heading. */
export interface RosterGroup {
  plan: Plan;
  title: string;
  ids: number[];
}

export const GROUP_TITLES: Record<Plan, string> = {
  Subscription: "Quarterly",
  "Pay as you go": "Pay as you go",
  Keeper: "Keepers",
};

/**
 * The list in its groups, in that order, each in the list's order (an empty one left out), and each player's
 * number: skaters 1.. through Quarterly then Pay as you go, keepers 1.. of their own.
 */
export function rosterGroups(
  all: number[],
  plan: (id: number) => Plan,
): { groups: RosterGroup[]; numbers: Map<number, number> } {
  const group = (p: Plan): RosterGroup => ({
    plan: p,
    title: GROUP_TITLES[p],
    ids: all.filter((id) => plan(id) === p),
  });
  const groups = [group("Subscription"), group("Pay as you go"), group("Keeper")].filter((g) => g.ids.length > 0);
  const numbers = new Map<number, number>();
  let skaters = 0;
  let keepers = 0;
  for (const g of groups) for (const id of g.ids) numbers.set(id, g.plan === "Keeper" ? ++keepers : ++skaters);
  return { groups, numbers };
}
