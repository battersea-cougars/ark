// Members (ADR 0024, ADR 0069): adding, importing, editing and erasing them, their contact, roles and attendance.
import { id, ok, theMember, type Route } from "../api/api.route";
import { HttpError, body, json } from "../api/api.http";
import { checkImport, importMembers } from "./members.import";
import { tellTheyreIn } from "./members.mail";
import { first } from "@cougars/shared/d1";
import { eraseMember } from "./members.erase";
import {
  addMember,
  attendanceOf,
  everydayOf,
  memberEmail,
  memberJoined,
  memberStanding,
  setContact,
  setMemberEverydayRole,
  updateMember,
} from "./members";

export const MEMBERS_ROUTES: Route[] = [
  {
    method: "PUT",
    path: /^\/api\/members\/(\d+)\/everyday-role$/,
    audit: {
      event: "member.everyday",
      subject: (c) => everydayOf(c.env.DB, id(c)),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "manage:Member",
    changes: ["members", "everydayRole"],
    // { roleId: number | null }: the role another member's app opens as (an admin who runs it as a member)
    handle: async (c) => (await setMemberEverydayRole(c.env.DB, id(c), await body(c.request), c), ok()),
  },
  {
    method: "GET",
    path: /^\/api\/members\/(\d+)\/attendance$/,
    action: "manage:Member",
    // ?year=2026; this year by default
    handle: async (c) => {
      const year = new URL(c.request.url).searchParams.get("year") ?? c.today.slice(0, 4);
      if (!/^\d{4}$/.test(year)) throw new HttpError(400, "year should be like 2026.");
      return json(await attendanceOf(c.env.DB, id(c), year, c.today));
    },
  },
  {
    method: "PUT",
    path: /^\/api\/members\/(\d+)\/contact$/,
    // Their sign-in email: changing it is a way to become them
    audit: {
      event: "member.email",
      subject: (c) => memberEmail(c.env.DB, id(c)),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "manage:Member",
    changes: ["members"],
    handle: async (c) => (await setContact(c.env.DB, id(c), await body(c.request), c), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/members$/,
    audit: {
      event: "member.added",
      subject: async (c, reply) => (reply ? memberJoined(c.env.DB, theMember(c, reply)) : null),
      about: (c, reply) => ({ memberId: theMember(c, reply) }),
    },
    action: "manage:Member",
    changes: ["members"],
    // { name, email, position }: in the club now, and emailed a link to the app (ADR 0069)
    handle: async (c) => json(await addMember(c.env, await body(c.request), new URL(c.request.url).origin, c), 201),
  },
  {
    method: "POST",
    path: /^\/api\/members\/import$/,
    audit: {
      event: "members.imported",
      subject: async (_c, reply) => ({ added: (reply?.added as string[] | undefined) ?? [] }),
    },
    action: "manage:Member",
    changes: ["members"],
    // { file, apply }: a CSV or the roster's JSON. Not applied, it says who it would add, who's in already and what's
    // wrong, and changes nothing; applied, it adds them all at once. Nobody is emailed.
    handle: async (c) => {
      const b = await body(c.request);
      return json(
        b.apply === true
          ? await importMembers(c.env.DB, b.file, c.actions, new Date(c.now))
          : await checkImport(c.env.DB, b.file, c.actions),
      );
    },
  },
  {
    method: "PUT",
    path: /^\/api\/members\/(\d+)$/,
    // Whether they're in, and their roles: who can do what
    audit: {
      event: "member.updated",
      subject: (c) => memberStanding(c.env.DB, id(c)),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "manage:Member",
    changes: ["members"],
    handle: async (c) => {
      const { letIn } = await updateMember(c.env.DB, id(c), await body(c.request), c);
      // Let in after asking to join: they hear so, with the way in (ADR 0069)
      if (letIn) {
        const m = await first<{ name: string; email: string | null }>(
          c.env.DB,
          "SELECT name, email FROM members WHERE id = ?",
          [id(c)],
        );
        if (m?.email) await tellTheyreIn(c.env, m.name, m.email, new URL(c.request.url).origin);
      }
      return ok();
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/members\/(\d+)$/,
    // On the record as a change of standing only: nothing that says who they were
    audit: {
      event: "member.erased",
      subject: (c) => memberStanding(c.env.DB, id(c)),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "manage:Member",
    changes: ["members"],
    // A member who asked the club, by email, to delete their account (#30): as if they'd done it themselves
    handle: async (c) => (await eraseMember(c.env.DB, id(c), c.today, c.now), ok()),
  },
];
