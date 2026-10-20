import { describe, expect, it } from "vitest";
import type { Action } from "../access/actions";
import { stripRoutes, tabHref, tabRoutes } from "./mobile-nav";
import { buildRoutes, buildTabs, routeFor, type NavConfig } from "./nav-routes";

const member = new Set<Action>(["read:Event", "signup:Event"]);
const admin = new Set<Action>(["manage:all"]);

const friday = {
  id: 1,
  slug: "friday",
  name: "Friday Training",
  shortName: "Friday",
  icon: "stick" as const,
  active: true,
};
const sunday = {
  id: 2,
  slug: "sunday",
  name: "Sunday Skills",
  shortName: "Sunday",
  icon: "skate" as const,
  active: true,
};
const kumite = {
  id: 1,
  slug: "kumite",
  name: "The Cougars Kumite",
  shortName: "Kumite",
  icon: "swords" as const,
  kind: "draft" as const,
  active: true,
};
const cup = {
  id: 2,
  slug: "cup",
  name: "Summer Cup",
  shortName: "Cup",
  icon: "trophy" as const,
  kind: "teams" as const,
  active: true,
};

const one: NavConfig = { series: [friday], types: [kumite] };
const many: NavConfig = { series: [friday, sunday], types: [kumite, cup] };

describe("buildRoutes", () => {
  it("makes a page per training and a section per tournament type", () => {
    const routes = buildRoutes(many);
    expect(routes.filter((r) => r.page === "training").map((r) => r.path)).toEqual([
      "/training/friday",
      "/training/sunday",
    ]);
    expect(routes.filter((r) => r.fold === "type:2").map((r) => r.name)).toEqual([
      "The Cup",
      "Fight card",
      "The board",
      "Teams",
    ]);
  });

  it("leaves out screens that run on demo data unless they're switched on (#63)", () => {
    const unfinished = ["/more/upload"];
    const paths = (config: NavConfig) => buildRoutes(config).map((r) => r.path);
    expect(paths(one).filter((p) => unfinished.includes(p))).toEqual([]);
    expect(
      paths({ ...one, unfinished: true })
        .filter((p) => unfinished.includes(p))
        .sort(),
    ).toEqual([...unfinished].sort());
  });

  it("leaves paused trainings out", () => {
    const routes = buildRoutes({ ...many, series: [friday, { ...sunday, active: false }] });
    expect(routeFor(routes, "/training/sunday")?.page).not.toBe("training");
  });
});

describe("the Draft page", () => {
  const CARA = 7;
  const config = (me: number): NavConfig => ({ ...one, types: [{ ...kumite, captains: [CARA, 8] }], me });
  const draftFor = (me: number, perms: Set<Action>) =>
    tabRoutes(buildRoutes(config(me)), "tournaments", perms).some((r) => r.page === "draft");

  it("is there for the next tournament's captains and whoever runs the draft, and nobody else", () => {
    expect(draftFor(CARA, member)).toBe(true);
    expect(draftFor(99, admin)).toBe(true);
    expect(draftFor(99, member)).toBe(false);
  });
});

describe("buildTabs", () => {
  it("names the tab after the only training or tournament", () => {
    expect(buildTabs(one).map((t) => t.label)).toEqual(["Home", "Friday", "Calendar", "Kumite", "You"]);
    expect(buildTabs(many).map((t) => t.label)).toEqual(["Home", "Training", "Calendar", "Tournaments", "You"]);
  });
});

describe("tabRoutes", () => {
  it("hides pages reached from a page, and pages the member can't use", () => {
    const routes = buildRoutes(one);
    expect(tabRoutes(routes, "training", admin).map((r) => r.id)).toEqual(["training:1"]);
    expect(tabRoutes(routes, "more", member).map((r) => r.id)).not.toContain("members");
  });
});

describe("stripRoutes", () => {
  it("lists every training when there are several", () => {
    const routes = buildRoutes(many);
    expect(stripRoutes(routes, routeFor(routes, "/training/friday")!, member).map((r) => r.name)).toEqual([
      "Friday Training",
      "Sunday Skills",
    ]);
  });

  it("gives someone on one of a tournament's teams a My team page, and nobody else", () => {
    const on = buildRoutes({ ...many, types: [kumite, { ...cup, onTeam: true }] });
    expect(on.filter((r) => r.fold === "type:2").map((r) => r.name)).toContain("My team");
    expect(buildRoutes(many).some((r) => r.name === "My team")).toBe(false);
  });

  it("keeps a tournament's strip to its own pages", () => {
    const routes = buildRoutes(many);
    expect(stripRoutes(routes, routeFor(routes, "/tournaments/cup")!, member).map((r) => r.name)).toEqual([
      "The Cup",
      "Fight card",
      "The board",
      "Teams",
    ]);
  });
});

describe("tabHref", () => {
  it("returns to the last page used in the tab, unless it's gone", () => {
    const routes = buildRoutes(one);
    expect(tabHref(routes, "tournaments", admin, { tournaments: "/tournaments/kumite/standings" })).toBe(
      "/tournaments/kumite/standings",
    );
    expect(tabHref(routes, "training", member, { training: "/training/sunday" })).toBe("/training/friday");
  });

  it("the You tab always opens your profile, with everything else listed under it", () => {
    const routes = buildRoutes(one);
    expect(tabHref(routes, "more", admin, { more: "/settings/venues" })).toBe("/me");
    expect(tabRoutes(routes, "more", member)[0].path).toBe("/me");
  });
});

describe("a series' history", () => {
  it("a History page once one's been played, and a page for each past one under it", () => {
    const routes = buildRoutes({ series: [friday], types: [{ ...kumite, past: [7, 5] }] });
    expect(routeFor(routes, "/tournaments/kumite/history")?.page).toBe("history");
    const past = routeFor(routes, "/tournaments/kumite/history/5");
    expect(past).toMatchObject({ page: "edition", params: { typeId: 1, tournamentId: 5 }, under: "history:1" });
    expect(past?.hidden).toBe(true);
  });

  it("no History before the first one's played", () => {
    expect(routeFor(buildRoutes(one), "/tournaments/kumite/history")?.page).not.toBe("history");
  });
});

describe("a series with nothing on or coming up", () => {
  const idle: NavConfig = {
    ...one,
    types: [{ ...kumite, idle: true, past: [7, 5], games: [70], teams: [{ id: 71, mine: false }], captains: [8] }],
    me: 8,
  };

  it("is just its front page, so there's no strip of pages: no fight card, board, teams, draft or History", () => {
    const routes = buildRoutes(idle);
    expect(tabRoutes(routes, "tournaments", admin).map((r) => r.name)).toEqual(["The Kumite"]);
    expect(stripRoutes(routes, routeFor(routes, "/tournaments/kumite")!, admin)).toEqual([]);
  });

  it("still opens each past one, its games and its teams, from the front page", () => {
    const routes = buildRoutes(idle);
    expect(routeFor(routes, "/tournaments/kumite/history/5")).toMatchObject({ page: "edition", under: "games:1" });
    expect(routeFor(routes, "/tournaments/kumite/games/70")).toMatchObject({ page: "matchup", under: "games:1" });
    expect(routeFor(routes, "/tournaments/kumite/teams/71")).toMatchObject({
      page: "tournament-team",
      under: "games:1",
    });
  });
});

describe("the members table", () => {
  it("an admin finds every member as a table under Settings → Club; a member doesn't see it", () => {
    const routes = buildRoutes(one);
    expect(routeFor(routes, "/settings/members")).toMatchObject({
      page: "members",
      group: "Settings",
      section: "Club",
      action: "manage:Member",
    });
    expect(tabRoutes(routes, "more", admin).map((r) => r.id)).toContain("members");
    expect(tabRoutes(routes, "more", member).map((r) => r.id)).not.toContain("members");
  });
});
