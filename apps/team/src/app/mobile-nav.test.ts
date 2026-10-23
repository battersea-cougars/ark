import { describe, expect, it } from "vitest";
import type { Action } from "../access/actions";
import { backFor, onTrack, stripRoutes, tabHref, tabRoutes } from "./mobile-nav";
import { buildRoutes, buildTabs, movedTo, routeFor, type NavConfig, type Stage } from "./nav-routes";

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
    // One page, by status, and its board (ADR 0074); the awards' stage under it
    expect(routes.filter((r) => r.fold === "type:2").map((r) => r.name)).toEqual(["The Cup", "The awards"]);
    // A draft's has its draft room too, full screen and off every menu (ADR 0060)
    expect(routes.find((r) => r.path === "/tournaments/kumite/draft/room")).toMatchObject({
      page: "draft-room",
      focus: true,
      hidden: true,
    });
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

describe("the draft, the teams and the fixtures: the tournament's page, at their own addresses (ADR 0074)", () => {
  it("opens the one page for everyone, whatever the address an old link or a push has", () => {
    const routes = buildRoutes({ ...one, types: [{ ...kumite, stage: "draft", captains: [7, 8] }], me: 99 });
    for (const path of ["", "/draft", "/teams", "/schedule", "/sign-up"])
      expect(routeFor(routes, `/tournaments/kumite${path}`)).toMatchObject({ id: "games:1", action: "read:Event" });
    expect(routes.some((r) => ["draft", "schedule", "tournament-teams"].includes(r.page))).toBe(false);
  });
});

describe("buildTabs", () => {
  it("names the tab after the only training or tournament", () => {
    expect(buildTabs(one).map((t) => t.label)).toEqual(["Home", "Friday", "Club", "Kumite", "You"]);
    expect(buildTabs(many).map((t) => t.label)).toEqual(["Home", "Training", "Club", "Tournaments", "You"]);
  });
});

describe("the club on a phone", () => {
  const routes = buildRoutes({ ...one, members: [{ id: 12, name: "Cara" }] });

  it("a member reaches the club's players from the Club tab, its own page with no strip and no Back", () => {
    expect(buildTabs(one).find((t) => t.id === "club")).toMatchObject({ label: "Club", icon: "club" });
    const club = routeFor(routes, tabHref(routes, "club", member, {}))!;
    expect(club).toMatchObject({ path: "/club", page: "teammates", tab: "club", name: "The club" });
    expect(stripRoutes(routes, club, member)).toEqual([]);
    expect(backFor(routes, club, "/")).toBeNull();
  });

  it("a member's page is under the club: the Club tab stays lit, Back goes to the club", () => {
    const cara = routeFor(routes, "/club/12")!;
    expect(cara).toMatchObject({ page: "teammates", params: { memberId: 12 }, tab: "club", under: "club" });
    expect(backFor(routes, cara, null)?.to.path).toBe("/club");
  });

  it("old links to Teammates go to the club", () => {
    expect(movedTo("/more/teammates")).toBe("/club");
    expect(movedTo("/more/teammates/12")).toBe("/club/12");
    expect(movedTo("/club")).toBeNull();
  });
});

describe("the Calendar on a phone", () => {
  const routes = buildRoutes(one);
  const calendar = routeFor(routes, "/calendar")!;

  it("isn't a tab: it's opened from Home's header, so the Home tab stays lit and it has Back to Home", () => {
    expect(buildTabs(one).map((t) => t.id)).not.toContain("calendar");
    expect(calendar).toMatchObject({ page: "calendar", tab: "home", under: "home" });
    expect(stripRoutes(routes, calendar, member)).toEqual([]);
    expect(backFor(routes, calendar, "/")).toMatchObject({ to: { path: "/" }, history: true });
    expect(backFor(routes, calendar, null)).toMatchObject({ to: { path: "/" }, history: false });
  });

  it("Home has no strip for it", () => {
    expect(stripRoutes(routes, routeFor(routes, "/")!, member)).toEqual([]);
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

  it("gives a tournament's pages no strip: its stage track is their navigation (ADR 0074)", () => {
    const routes = buildRoutes(many);
    for (const path of ["/tournaments/cup", "/tournaments/cup/schedule", "/tournaments/cup/standings"]) {
      expect(stripRoutes(routes, routeFor(routes, path)!, member)).toEqual([]);
      expect(onTrack(routeFor(routes, path)!)).toBe(true);
    }
  });

  it("the track is on the series' running pages, not a team's, a game's or History", () => {
    const routes = buildRoutes({
      ...one,
      types: [{ ...kumite, stage: "fixtures", past: [5], teams: [{ id: 71, mine: false }], games: [9] }],
    });
    const on = (path: string) => onTrack(routeFor(routes, path)!);
    for (const path of ["", "/draft", "/teams", "/schedule", "/standings"])
      expect(on(`/tournaments/kumite${path}`)).toBe(true);
    for (const path of ["/teams/71", "/games/9", "/history", "/history/5"])
      expect(on(`/tournaments/kumite${path}`)).toBe(false);
    expect(on("/training/friday")).toBe(false);
  });
});

describe("a tournament is one page; its teams and History are a link away, with Back", () => {
  const at = (stage: Stage, extra: Partial<NavConfig["types"][number]> = {}, me = 99) =>
    buildRoutes({ ...one, types: [{ ...kumite, stage, captains: [7, 8], past: [5], ...extra }], me });

  it("whatever the status, the Kumite tab has the one page, named for it", () => {
    for (const stage of ["signup", "draft", "teams", "fixtures"] as const)
      for (const who of [member, admin])
        expect(tabRoutes(at(stage), "tournaments", who).map((r) => r.short ?? r.name)).toEqual(["Kumite"]);
    expect(routeFor(at("fixtures"), "/tournaments/kumite")?.name).toBe("The Kumite");
  });

  it("the board's old address opens the page, at the status it's at (the table's in the day's view)", () => {
    expect(routeFor(at("fixtures"), "/tournaments/kumite/standings")?.id).toBe("games:1");
  });

  it("My team and a team's page: under the tournament's page", () => {
    const routes = at("fixtures", { onTeam: true, teams: [{ id: 71, mine: true }] }, 7);
    expect(routeFor(routes, "/tournaments/kumite/my-team")).toMatchObject({
      page: "tournament-team",
      under: "games:1",
    });
    expect(routeFor(routes, "/tournaments/kumite/teams/71")).toMatchObject({
      page: "tournament-team",
      under: "games:1",
    });
  });

  it("The awards: a page of their own under the tournament's page, the way back the Kumite; not a tab", () => {
    const routes = at("fixtures");
    expect(routeFor(routes, "/tournaments/kumite/awards")).toMatchObject({
      page: "awards",
      under: "games:1",
      hidden: true,
    });
    expect(tabRoutes(routes, "tournaments", admin).map((r) => r.name)).not.toContain("The awards");
  });

  it("History isn't a tab while one's running: it opens from the page, and a past one goes back to History", () => {
    const routes = at("fixtures");
    const history = routeFor(routes, "/tournaments/kumite/history")!;
    expect(history).toMatchObject({ page: "history", hidden: true, under: "games:1" });
    expect(backFor(routes, history, null)?.to.path).toBe("/tournaments/kumite");
    const past = routeFor(routes, "/tournaments/kumite/history/5")!;
    expect(backFor(routes, past, null)?.to.path).toBe("/tournaments/kumite/history");
  });
});

describe("tabHref", () => {
  it("returns to the last page used in the tab, unless it's gone", () => {
    const routes = buildRoutes(one);
    expect(tabHref(routes, "tournaments", admin, { tournaments: "/tournaments/kumite" })).toBe("/tournaments/kumite");
    expect(tabHref(routes, "training", member, { training: "/training/sunday" })).toBe("/training/friday");
  });

  it("the You tab always opens your You page, not the settings page you last left", () => {
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

describe("Back on a phone (backFor)", () => {
  const routes = buildRoutes(one);
  const at = (path: string) => routeFor(routes, path)!;
  const back = (path: string, from: string | null, granted?: Set<Action>) => {
    const b = backFor(routes, at(path), from, granted);
    return b && { to: b.to.path, history: b.history };
  };

  it("goes back to where you came from: Home → Dues → Back is Home", () => {
    expect(back("/me/tab", "/")).toEqual({ to: "/", history: true });
    expect(back("/privacy", "/calendar")).toEqual({ to: "/calendar", history: true });
  });

  it("a settings page always goes back to Settings: Home → Unpaid fees → Back is Settings, in its place", () => {
    expect(back("/settings/overdue", "/")).toEqual({ to: "/settings", history: false });
    expect(back("/settings/overdue", "/settings/members")).toEqual({ to: "/settings", history: false });
    expect(back("/settings/overdue", null)).toEqual({ to: "/settings", history: false });
  });

  it("through Settings: You → Settings → Training → Back is Settings, then You", () => {
    expect(back("/settings/training", "/settings")).toEqual({ to: "/settings", history: true });
    expect(back("/settings", "/me")).toEqual({ to: "/me", history: true });
    expect(back("/settings", "/")).toEqual({ to: "/", history: true });
  });

  it("Settings never goes back to a settings page, round in a circle: to You instead", () => {
    expect(back("/settings", "/settings/overdue")).toEqual({ to: "/me", history: false });
    expect(back("/settings", null)).toEqual({ to: "/me", history: false });
  });

  it("past announcements are Home's page, for everyone: Back to Home, never to Settings", () => {
    expect(at("/announcements")).toMatchObject({ page: "announcements", tab: "home", under: "home" });
    expect(at("/announcements").group).toBeUndefined();
    expect(back("/announcements", "/", admin)).toEqual({ to: "/", history: true });
    expect(back("/announcements", null, admin)).toEqual({ to: "/", history: false });
    expect(back("/announcements", null, member)).toEqual({ to: "/", history: false });
    expect(movedTo("/more/announcements")).toBe("/announcements");
  });

  it("opened from outside or after a reload: the rest of the You tab to You", () => {
    expect(back("/me/tab", null)).toEqual({ to: "/me", history: false });
    expect(back("/privacy", null)).toEqual({ to: "/me", history: false });
  });

  it("a tab's own pages have the tabs, not Back", () => {
    for (const path of ["/", "/me", "/club", "/training/friday", "/tournaments/kumite", "/tournaments/kumite/draft"])
      expect(back(path, "/settings/overdue")).toBeNull();
  });
});
