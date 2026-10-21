import { describe, expect, it } from "vitest";
import type { Action } from "../access/actions";
import { buildRoutes, type NavConfig } from "./nav-routes";
import { settingsSections } from "./settings-list";

const config: NavConfig = { series: [], types: [], devTools: true };
const routes = buildRoutes(config);
const admin = new Set<Action>(["manage:all"]);
const member = new Set<Action>(["read:Event", "signup:Event"]);
const sessionLead = new Set<Action>([...member, "record:Attendance", "read:Rating", "generate:Teams", "publish:Teams"]);
const treasurer = new Set<Action>([...member, "read:Dues", "manage:Fees"]);

const listed = (account: Set<Action>, now = account) =>
  settingsSections(routes, account, now).map((s) => ({
    section: s.section,
    rows: s.rows.map((r) => (r.open ? r.route.name : `(${r.route.name})`)),
  }));

describe("the Settings page", () => {
  it("lists every admin area for an admin, grouped Club, Schedule, Money, Security", () => {
    expect(listed(admin)).toEqual([
      { section: "Club", rows: ["Members", "Unpaid fees", "Quips"] },
      { section: "Schedule", rows: ["Training", "Tournaments", "Tournament Series", "Venues"] },
      { section: "Money", rows: ["Quarterly rate"] },
      { section: "Security", rows: ["Roles", "Audit log", "Usage", "View as a member", "Dev tools"] },
    ]);
  });

  it("is empty for a member and a session lead (they have no gear)", () => {
    expect(listed(member)).toEqual([]);
    expect(listed(sessionLead)).toEqual([]);
  });

  it("lists only what a role can set up", () => {
    expect(listed(treasurer)).toEqual([
      { section: "Club", rows: ["Unpaid fees"] },
      { section: "Money", rows: ["Quarterly rate"] },
    ]);
  });

  it("an admin in their everyday role sees the same list, the rows that role can't open quiet, so nothing moves", () => {
    const everyday = listed(admin, sessionLead);
    expect(everyday.flatMap((s) => s.rows)).toHaveLength(listed(admin).flatMap((s) => s.rows).length);
    expect(everyday[0]).toEqual({
      section: "Club",
      rows: ["(Members)", "(Unpaid fees)", "(Quips)"],
    });
  });

  it("doesn't list past announcements: they're Home's page, posted from Home", () => {
    const ids = settingsSections(routes, admin, admin).flatMap((s) => s.rows.map((r) => r.route.id));
    expect(ids).not.toContain("announcements");
  });

  it("Upload is a contributor's, not every member's: in Settings, not the rail", () => {
    const unfinished = buildRoutes({ ...config, unfinished: true });
    const contributor = new Set<Action>([...member, "upload:Photo"]);
    expect(
      settingsSections(unfinished, contributor, contributor).flatMap((s) => s.rows.map((r) => r.route.name)),
    ).toEqual(["Upload"]);
  });
});
