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
  it("lists every admin area for an admin, everyday jobs first: Club (its people and money), Schedule, Content, System", () => {
    expect(listed(admin)).toEqual([
      { section: "Club", rows: ["Members", "Unpaid fees", "Membership", "Roles"] },
      { section: "Schedule", rows: ["Training", "Tournaments", "Tournament Series", "Venues"] },
      { section: "Content", rows: ["Website", "Quips"] },
      { section: "System", rows: ["View as a member", "Audit log", "Usage", "Errors", "Email", "Dev tools"] },
    ]);
  });

  it("an unfinished page joins its section in its place (Upload, after Quips)", () => {
    const unfinished = buildRoutes({ ...config, unfinished: true });
    expect(
      settingsSections(unfinished, admin, admin)
        .find((s) => s.section === "Content")
        ?.rows.map((r) => r.route.name),
    ).toEqual(["Website", "Quips", "Upload"]);
  });

  it("is empty for a member and a session lead (they have no gear)", () => {
    expect(listed(member)).toEqual([]);
    expect(listed(sessionLead)).toEqual([]);
  });

  it("lists the website for whoever may edit it, and nothing else of the admins' (#107)", () => {
    const editor = new Set<Action>([...member, "edit:Content"]);
    expect(listed(editor)).toEqual([{ section: "Content", rows: ["Website"] }]);
  });

  it("lists only what a role can set up", () => {
    expect(listed(treasurer)).toEqual([{ section: "Club", rows: ["Unpaid fees", "Membership"] }]);
  });

  it("an admin in their everyday role sees the same list, the rows that role can't open quiet, so nothing moves", () => {
    const everyday = listed(admin, sessionLead);
    expect(everyday.flatMap((s) => s.rows)).toHaveLength(listed(admin).flatMap((s) => s.rows).length);
    expect(everyday[0]).toEqual({
      section: "Club",
      rows: ["(Members)", "(Unpaid fees)", "(Membership)", "(Roles)"],
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
