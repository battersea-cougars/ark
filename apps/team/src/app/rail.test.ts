import { describe, expect, it } from "vitest";
import type { Action } from "../access/actions";
import { buildFolds, buildRoutes, routeFor, type NavConfig } from "./nav-routes";
import { railFoot, railItems, railOn } from "./rail";
import { settingsSections } from "./settings-list";

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
  it("is member pages, the same for an admin and a member: Home, the trainings, Calendar, the tournaments, the club", () => {
    const names = ["Home", "Friday Training", "Calendar", "The Cougars Kumite", "The club"];
    expect(rail(member).map((i) => i.name)).toEqual(names);
    expect(rail(admin).map((i) => i.name)).toEqual(names);
  });

  it("lights the section you're in: a member's page is Teammates, a Kumite page the Kumite", () => {
    const lit = (path: string) =>
      rail(admin)
        .filter((i) => railOn(i, routeFor(routes, path)!))
        .map((i) => i.name);
    expect(lit("/club/12")).toEqual(["The club"]);
    expect(lit("/calendar")).toEqual(["Calendar"]);
    expect(lit("/announcements")).toEqual(["Home"]);
    expect(lit("/tournaments/kumite/standings")).toEqual(["The Cougars Kumite"]);
    expect(lit("/training/friday")).toEqual(["Friday Training"]);
    expect(lit("/settings/members")).toEqual([]);
    expect(lit("/me")).toEqual([]);
  });

  // The gear shows for whoever can set something up (app/settings-entry): an admin, not a member
  const foot = (granted: Set<Action>) => railFoot(routes, settingsSections(routes, granted, granted).length > 0);

  it("ends with the Settings gear at its foot for an admin; a member has none", () => {
    expect(foot(admin).map((i) => i.name)).toEqual(["Settings"]);
    expect(foot(member)).toEqual([]);
  });

  it("lights the gear on Settings and every settings page, and nothing else then", () => {
    const [gear] = foot(admin);
    for (const path of ["/settings", "/settings/members", "/settings/venues"])
      expect(railOn(gear, routeFor(routes, path)!)).toBe(true);
    expect(railOn(gear, routeFor(routes, "/club")!)).toBe(false);
    expect(railOn(gear, routeFor(routes, "/announcements")!)).toBe(false);
  });
});
