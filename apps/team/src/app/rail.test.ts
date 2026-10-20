import { describe, expect, it } from "vitest";
import type { Action } from "../access/actions";
import { buildFolds, buildRoutes, routeFor, type NavConfig } from "./nav-routes";
import { railItems, railOn } from "./rail";

const config: NavConfig = {
  series: [{ id: 1, slug: "friday", name: "Friday Training", shortName: "Friday", icon: "stick", active: true }],
  types: [
    {
      id: 1,
      slug: "kumite",
      name: "The Cougars Kumite",
      shortName: "Kumite",
      icon: "swords",
      kind: "draft",
      active: true,
    },
  ],
  members: [{ id: 12, name: "Cara" }],
  unfinished: true,
  devTools: true,
};
const routes = buildRoutes(config);
const admin = new Set<Action>(["manage:all"]);
const member = new Set<Action>(["read:Event", "signup:Event"]);
const rail = (granted: Set<Action>) => railItems(routes, buildFolds(config), granted);

describe("the desktop rail", () => {
  it("is member pages only, the same for an admin and a member: settings, uploads and dues aren't in it", () => {
    const names = ["Home", "Friday Training", "Calendar", "The Cougars Kumite", "Teammates"];
    expect(rail(member).map((i) => i.name)).toEqual(names);
    expect(rail(admin).map((i) => i.name)).toEqual(names);
  });

  it("lights the section you're in: a member's page is Teammates, a Kumite page the Kumite", () => {
    const lit = (path: string) =>
      rail(admin)
        .filter((i) => railOn(i, routeFor(routes, path)!))
        .map((i) => i.name);
    expect(lit("/more/teammates/12")).toEqual(["Teammates"]);
    expect(lit("/tournaments/kumite/standings")).toEqual(["The Cougars Kumite"]);
    expect(lit("/training/friday")).toEqual(["Friday Training"]);
    expect(lit("/settings/members")).toEqual([]);
    expect(lit("/me")).toEqual([]);
  });
});
