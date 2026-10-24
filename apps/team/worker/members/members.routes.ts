// Members (ADR 0024, ADR 0069): adding, importing, editing and erasing them, their contact, roles and attendance.
import { places } from "../push/push.notices";
import { id, ok, theMember, type Route } from "../api/api.route";
import { HttpError, body, json } from "../api/api.http";
import { checkImport, importMembers } from "./members.import";
import { tellTheyreIn } from "./members.mail";
import { first } from "@cougars/shared/d1";
import { eraseMember } from "./members.erase";
import { endSessions, liveSessions } from "../auth/auth.sessions";
import { forgetPasskeys } from "../auth/auth.passkeys";
import { endLive } from "../live/live";
import { markAll, type Mark } from "../entries/entries";
import { memberExists } from "../dues/dues";
import {
  addMember,
  attendanceOf,
  attendanceOn,
  everydayOf,
  mayChange,
  memberEmail,
  memberJoined,
  memberStanding,
  sendAppLink,
  setContact,
  setMemberEverydayRole,
  updateMember,
} from "./members";

/** { marks: [{ sessionId, here }] }: a year of Fridays at most. */
async function marksIn(request: Request): Promise<Mark[]> {
  const { marks } = await body(request);
  if (!Array.isArray(marks) || !marks.length || marks.length > 60) throw new HttpError(400, "marks should be a list.");
  return marks.map((m: { sessionId?: unknown; here?: unknown }) => {
    if (!Number.isInteger(m?.sessionId) || (m.sessionId as number) <= 0) throw new HttpError(400, "Which session?");
    if (typeof m.here !== "boolean") throw new HttpError(400, "here should be true or false.");
    return { sessionId: m.sessionId as number, here: m.here };
  });
}

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
    path: /^\/api\/members\/(\d+)\/attendance$/,
    audit: {
      // Their attendance, saved at once (the register for one member, many Fridays): what makes their charges
      event: "attendance.marked",
      subject: async (c, reply) =>
        attendanceOn(
          c.env.DB,
          id(c),
          reply ? (reply.sessionIds as number[]) : (await marksIn(c.request.clone())).map((m) => m.sessionId),
        ),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "record:Attendance",
    // Who came is who's charged (ADR 0007)
    changes: ["sessions", "members", "charges", "dues"],
    // A walk-in taken off frees a place: whoever moves up hears it
    notify: places,
    // { marks: [{ sessionId, here }] }: each Friday ticked or unticked, in one go
    handle: async (c) => {
      const marks = await marksIn(c.request);
      await memberExists(c.env.DB, id(c));
      await markAll(c.env.DB, id(c), marks, c.memberId, c.now);
      return json({ sessionIds: marks.map((m) => m.sessionId) });
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
    handle: async (c) => {
      const { emailChanged } = await setContact(c.env.DB, id(c), await body(c.request), c);
      // A new sign-in email: whoever was signed in as them with the old one is signed out (#72), and their passkeys go,
      // so whoever had the account before keeps no way in (ADR 0023)
      if (emailChanged) {
        await endSessions(c.env, c.now, { memberId: id(c) });
        await forgetPasskeys(c.env.DB, id(c));
      }
      return ok();
    },
  },
  {
    method: "POST",
    path: /^\/api\/members\/(\d+)\/sign-out$/,
    // Signed out everywhere: how many sign-ins they had, and none after
    audit: {
      event: "member.signed_out",
      subject: (c) => liveSessions(c.env.DB, id(c), c.now),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "manage:Member",
    changes: ["members"],
    // A lost phone, a shared laptop, a worry: every browser and phone they're signed in on is signed out, and stops
    // hearing from the club. They sign in again with a code.
    handle: async (c) => {
      await memberExists(c.env.DB, id(c));
      await mayChange(c.env.DB, c.actions, id(c));
      await endSessions(c.env, c.now, { memberId: id(c) });
      return ok();
    },
  },
  {
    method: "POST",
    path: /^\/api\/members$/,
    // Who they are, and whether the add emailed them the app link (#164)
    audit: {
      event: "member.added",
      subject: async (c, reply) =>
        reply ? { ...(await memberJoined(c.env.DB, theMember(c, reply))), emailed: reply.emailed === true } : null,
      about: (c, reply) => ({ memberId: theMember(c, reply) }),
    },
    action: "manage:Member",
    changes: ["members"],
    // { name, email, position, emailThem? }: in the club now, and emailed a link to the app unless emailThem is false
    // (ADR 0069, #164)
    handle: async (c) => json(await addMember(c.env, await body(c.request), new URL(c.request.url).origin, c), 201),
  },
  {
    method: "POST",
    path: /^\/api\/members\/(\d+)\/app-link$/,
    // Nothing changes but an email sent: on the record as sent (or tried), from nothing
    audit: {
      event: "member.app_link",
      subject: async (_c, reply) => (reply ? { emailed: reply.emailed === true } : null),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "manage:Member",
    // Nothing of theirs changes; the sheet's members come back as after any action on a member
    changes: ["members"],
    // Someone added quietly (#164), or whose first email went astray: the same link to the app, once per tap
    handle: async (c) => json(await sendAppLink(c.env, id(c), new URL(c.request.url).origin)),
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
    // A file of up to 500,000 characters, which JSON can make longer
    maxBody: 2 * 1024 * 1024,
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
      const { letIn, shutOut } = await updateMember(c.env.DB, id(c), await body(c.request), c);
      // Made inactive: every way in goes, sessions and passkeys alike; let back in, they start with a code (ADR 0023)
      if (shutOut) {
        await endSessions(c.env, c.now, { memberId: id(c) });
        await forgetPasskeys(c.env.DB, id(c));
      }
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
    // The places they gave up go to whoever's waiting, who hear it
    notify: places,
    // A member who asked the club, by email, to delete their account (#30): as if they'd done it themselves
    handle: async (c) => {
      // Never someone who can do more than the one erasing them (ADR 0036), as for any other change to a member
      await mayChange(c.env.DB, c.actions, id(c));
      await eraseMember(c.env.DB, id(c), c.today, c.now);
      await endLive(c.env, { memberId: id(c) });
      return ok();
    },
  },
];
