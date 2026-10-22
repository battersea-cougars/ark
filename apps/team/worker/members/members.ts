// Members and roles (ADR 0024). A member's permissions are the union of their roles' actions; actions no longer in
// the catalog are ignored.
import { all, batch, first, run, statement, type Param } from "@cougars/shared/d1";
import { ACTIONS, type Action } from "../../src/access/actions";
import { HttpError, bool, int, oneOf, text } from "../api/api.http";
import { email, giveReference, type AuthEnv } from "../auth/auth";
import { tellTheyreIn } from "./members.mail";
import { londonToday } from "../../src/lib/dates";
import { QUARTER, nextQuarter, quarterOf, quarterStart } from "../dues/dues";

export interface MemberJson {
  id: number;
  name: string;
  email: string | null;
  position: "F" | "D" | "G";
  /** Only for those who may see ratings (read:Rating); 0 otherwise. */
  rating: number;
  cougar: boolean;
  status: "pending" | "active" | "inactive";
  paymentReference: string | null;
  /** Highest first: Admin, then newer roles, Member last. Only your own, unless you manage members or roles (ADR 0036). */
  roles: string[];
  bio: string;
  /** How their name shows on the website; null: first name and initial. */
  webName: string | null;
  /** Only for the member themselves and those who manage members; null otherwise. */
  phone: string | null;
  /** Training sessions they came to: in, not a no-show, held before today and not cancelled. */
  played: number;
  /** A Quarterly Member today: a subscription covers it (ADR 0007). Only your own, unless you manage members. */
  quarterly: boolean;
  /** Quarterly next quarter: what they chose, or their membership running on. Only your own. */
  quarterlyNext: boolean;
  /** The role their app opens as (ADR 0024); null: their full role. Your own, or anyone's if you see roles. */
  everydayRoleId: number | null;
}

export interface RoleJson {
  id: number;
  name: string;
  description: string;
  system: boolean;
  actions: Action[];
}

const isAction = (a: string): a is Action => a in ACTIONS;

/** Roles and their actions as read (api.club.ts), each with its actions still in the catalog. */
export function rolesFrom(
  roles: { id: number; name: string; description: string; is_system: number }[],
  actions: { role_id: number; action: string }[],
): RoleJson[] {
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    system: Boolean(r.is_system),
    actions: actions.filter((a) => a.role_id === r.id && isAction(a.action)).map((a) => a.action as Action),
  }));
}

/**
 * Members as read (api.club.ts), where what the viewer may not see is already left out: who's asking to join and who's
 * left, anyone else's email, phone, payment reference, quarterly status and roles, and ratings (ADR 0036).
 */
export function membersFrom(
  rows: {
    id: number;
    name: string;
    email: string | null;
    position: "F" | "D" | "G";
    rating: number;
    cougar: number;
    status: MemberJson["status"];
    payment_reference: string | null;
    roles: string | null;
    bio: string;
    web_name: string | null;
    phone: string | null;
    played: number;
    quarterly: number;
    quarterlyNext: number;
    everyday_role_id: number | null;
  }[],
): MemberJson[] {
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    position: m.position,
    rating: m.rating,
    cougar: Boolean(m.cougar),
    status: m.status,
    paymentReference: m.payment_reference,
    roles: m.roles ? m.roles.split(",") : [],
    bio: m.bio,
    // Public anyway (the website roster), so everyone may see it
    webName: m.web_name,
    phone: m.phone,
    played: m.played,
    quarterly: Boolean(m.quarterly),
    quarterlyNext: Boolean(m.quarterlyNext),
    everydayRoleId: m.everyday_role_id,
  }));
}

/** Who's making a change: what they can do (the grant rules) and when. The record is the route's (api.ts, ADR 0095). */
export interface By {
  actions: ReadonlySet<Action>;
  now: string;
}

// ─── You can't grant what you don't have (ADR 0036) ───

/** Whether someone holding `caller` may hand out (or take away) every one of `actions`. manage:all may do anything. */
export function canGrant(caller: ReadonlySet<Action>, actions: Iterable<string>): boolean {
  if (caller.has("manage:all")) return true;
  for (const a of actions) if (!caller.has(a as Action)) return false;
  return true;
}

/** Refuses changing a member who can do something the caller can't (an admin, to a member manager). */
export async function mayChange(db: D1Database, caller: ReadonlySet<Action>, memberId: number) {
  if (!canGrant(caller, await actionsOf(db, memberId)))
    throw new HttpError(403, "They can do things you can't, so only someone with those powers can change them.");
}

/** What a member may do: their roles' actions. */
export async function actionsOf(db: D1Database, memberId: number): Promise<Set<Action>> {
  const rows = await all<{ action: string }>(
    db,
    `SELECT DISTINCT ra.action FROM member_roles mr JOIN role_actions ra ON ra.role_id = mr.role_id
     WHERE mr.member_id = ?`,
    [memberId],
  );
  return new Set(rows.map((r) => r.action).filter(isAction));
}

/** The first admin: the local stand-in for whoever is signed in, until sign-in arrives. */
export async function firstAdmin(db: D1Database): Promise<number | null> {
  const row = await first<{ id: number }>(
    db,
    `SELECT m.id FROM members m JOIN member_roles mr ON mr.member_id = m.id JOIN roles r ON r.id = mr.role_id
     WHERE r.name = 'Admin' AND m.status = 'active' ORDER BY m.id LIMIT 1`,
  );
  return row?.id ?? null;
}

/**
 * An admin adds someone to the club (ADR 0069): in straight away (no asking to join), with a payment reference, and
 * an email with a link to the app that fills in their address on the sign-in screen. The email going astray doesn't
 * undo the add: `emailed` says whether it went, so the admin can tell them another way.
 */
export async function addMember(env: AuthEnv, o: Record<string, unknown>, origin: string, by: By) {
  const now = new Date(by.now);
  const name = text(o, "name", { max: 80 });
  const address = email(o);
  const position = oneOf(o, "position", ["F", "D", "G"] as const);
  if (await first(env.DB, "SELECT 1 FROM members WHERE email = ?", [address]))
    throw new HttpError(409, "Someone in the club has that email already.");
  const res = await run(
    env.DB,
    `INSERT INTO members (name, email, position, status, joined_on, created_at) VALUES (?, ?, ?, 'active', ?, ?)`,
    [name, address, position, londonToday(now), now.toISOString()],
  );
  const id = Number(res.meta.last_row_id);
  await giveReference(env.DB, id, name);
  const emailed = await tellTheyreIn(env, name, address, origin);
  return { id, emailed };
}

/**
 * An admin edits a member: position, rating, cougar, status and roles. Says whether it let them in (pending to
 * active), so the route can tell them.
 */
export async function updateMember(
  db: D1Database,
  id: number,
  o: Record<string, unknown>,
  by: By,
): Promise<{ letIn: boolean; shutOut: boolean }> {
  const caller = by.actions;
  const existing = await first<{ id: number; status: string }>(db, "SELECT id, status FROM members WHERE id = ?", [id]);
  if (!existing) throw new HttpError(404, "No such member.");
  await mayChange(db, caller, id);
  const name = text(o, "name");
  const position = oneOf(o, "position", ["F", "D", "G"] as const);
  const rating = int(o, "rating", { max: 100 });
  const cougar = bool(o, "cougar");
  const status = oneOf(o, "status", ["pending", "active", "inactive"] as const);
  const roles = o.roles;
  if (!Array.isArray(roles) || roles.some((r) => typeof r !== "string"))
    throw new HttpError(400, "roles should be a list.");
  const known = await all<{ id: number; name: string }>(db, "SELECT id, name FROM roles");
  const ids = roles.map((r) => {
    const role = known.find((k) => k.name === r);
    if (!role) throw new HttpError(400, `No role called ${r}.`);
    return role.id;
  });
  // Every role they're given must do no more than the caller can
  if (ids.length) {
    const given = await all<{ action: string }>(
      db,
      `SELECT DISTINCT action FROM role_actions WHERE role_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    if (
      !canGrant(
        caller,
        given.map((g) => g.action),
      )
    )
      throw new HttpError(403, "You can't give someone a role that can do more than you.");
  }
  // Never leave the club without an admin: neither by taking the role off the last one nor by making them inactive.
  // Decided inside the statements that write it (ADR 0121): while it's taken off an admin, every statement goes only
  // while another active admin's there, so two admins demoting each other at once can't both go (#135). The read
  // before is for the refusal's words.
  const admin = known.find((k) => k.name === "Admin");
  let guard: { sql: string; params: Param[] } | null = null;
  if (admin && (!ids.includes(admin.id) || status !== "active")) {
    const was = await first<{ n: number }>(
      db,
      "SELECT count(*) n FROM member_roles WHERE role_id = ? AND member_id = ?",
      [admin.id, id],
    );
    if (was?.n)
      guard = {
        sql: `EXISTS (SELECT 1 FROM member_roles mr JOIN members m ON m.id = mr.member_id
                WHERE mr.role_id = ? AND mr.member_id != ? AND m.status = 'active')`,
        params: [admin.id, id],
      };
  }
  const lastAdmin = "That's the last admin. Make someone else an admin first.";
  if (guard && !(await first(db, `SELECT 1 WHERE ${guard.sql}`, guard.params))) throw new HttpError(409, lastAdmin);
  // A statement written as `… WHERE …`, kept to while there's another admin when this one's going
  const guarded = (sql: string, params: Param[]) =>
    guard ? statement(db, `${sql} AND ${guard.sql}`, [...params, ...guard.params]) : statement(db, sql, params);
  const statements = [
    guarded("UPDATE members SET name = ?, position = ?, rating = ?, cougar = ?, status = ? WHERE id = ?", [
      name,
      position,
      rating,
      cougar ? 1 : 0,
      status,
      id,
    ]),
  ];
  // The name they go by (ADR 0043), when it's sent: an admin can set or clear it as they can on their profile
  if ("webName" in o) {
    const webName = o.webName === null ? "" : text(o, "webName", { optional: true, max: 40 }).trim();
    statements.push(guarded("UPDATE members SET web_name = ? WHERE id = ?", [webName || null, id]));
  }
  statements.push(guarded("DELETE FROM member_roles WHERE member_id = ?", [id]));
  for (const roleId of ids)
    statements.push(guarded("INSERT INTO member_roles (member_id, role_id) SELECT ?, ? WHERE 1", [id, roleId]));
  const [written] = await batch(db, statements);
  if (!written.meta.changes) throw new HttpError(409, lastAdmin);
  // Made inactive (or back to waiting): their sign-ins end, so letting them back in later opens none of them (#72)
  return { letIn: existing.status === "pending" && status === "active", shutOut: status !== "active" };
}

function roleFields(o: Record<string, unknown>) {
  const name = text(o, "name", { max: 40 });
  const description = text(o, "description", { optional: true });
  const actions = o.actions;
  if (!Array.isArray(actions) || actions.some((a) => typeof a !== "string" || !isAction(a)))
    throw new HttpError(400, "actions should be a list of known actions.");
  return { name, description, actions: [...new Set(actions as Action[])] };
}

export async function createRole(db: D1Database, o: Record<string, unknown>, by: By) {
  const caller = by.actions;
  const f = roleFields(o);
  if (!canGrant(caller, f.actions)) throw new HttpError(403, "A role can't do more than you can.");
  if (await first(db, "SELECT 1 FROM roles WHERE name = ?", [f.name])) throw new HttpError(409, "That name is taken.");
  const res = await run(db, "INSERT INTO roles (name, description, is_system) VALUES (?, ?, 0)", [
    f.name,
    f.description,
  ]);
  const id = Number(res.meta.last_row_id);
  await batch(
    db,
    f.actions.map((a) => statement(db, "INSERT INTO role_actions (role_id, action) VALUES (?, ?)", [id, a])),
  );
  return id;
}

export async function updateRole(db: D1Database, id: number, o: Record<string, unknown>, by: By) {
  const caller = by.actions;
  const role = await first<{ is_system: number }>(db, "SELECT is_system FROM roles WHERE id = ?", [id]);
  if (!role) throw new HttpError(404, "No such role.");
  if (role.is_system) throw new HttpError(409, "The Admin role can't be changed.");
  const f = roleFields(o);
  // Neither what it can do now nor what it would do may be beyond the caller
  const had = await all<{ action: string }>(db, "SELECT action FROM role_actions WHERE role_id = ?", [id]);
  if (!canGrant(caller, [...had.map((h) => h.action), ...f.actions]))
    throw new HttpError(403, "A role can't do more than you can.");
  if (await first(db, "SELECT 1 FROM roles WHERE name = ? AND id != ?", [f.name, id]))
    throw new HttpError(409, "That name is taken.");
  await batch(db, [
    statement(db, "UPDATE roles SET name = ?, description = ? WHERE id = ?", [f.name, f.description, id]),
    statement(db, "DELETE FROM role_actions WHERE role_id = ?", [id]),
    ...f.actions.map((a) => statement(db, "INSERT INTO role_actions (role_id, action) VALUES (?, ?)", [id, a])),
  ]);
}

/**
 * Your own profile: phone, position, bio and how your name shows on the website (empty: first name and initial).
 * Your name and email stay with admins (the roster seed matches by name).
 */
export async function updateProfile(db: D1Database, id: number, o: Record<string, unknown>) {
  const position = oneOf(o, "position", ["F", "D", "G"] as const);
  const phone = text(o, "phone", { optional: true, max: 30 });
  const bio = text(o, "bio", { optional: true, max: 160 });
  const webName = text(o, "webName", { optional: true, max: 40 }).trim();
  await run(db, "UPDATE members SET position = ?, phone = ?, bio = ?, web_name = ? WHERE id = ?", [
    position,
    phone || null,
    bio,
    webName || null,
    id,
  ]);
}

/** The role someone runs the app as day to day (ADR 0024); null means their full role. */
/**
 * Choose your everyday role, or none (null) to use your full role. Only a role that can do less than you can: it's
 * for showing the app to someone, never a way to gain anything.
 */
export async function setEverydayRole(
  db: D1Database,
  id: number,
  o: Record<string, unknown>,
  limit: ReadonlySet<Action>,
  tooMuch = "Your everyday role has to be one that can do less than you can.",
) {
  const roleId = o.roleId;
  if (roleId === null) {
    await run(db, "UPDATE members SET everyday_role_id = NULL WHERE id = ?", [id]);
    return;
  }
  if (typeof roleId !== "number" || !Number.isInteger(roleId))
    throw new HttpError(400, "roleId should be a role's id or null.");
  if (!(await first(db, "SELECT 1 FROM roles WHERE id = ?", [roleId]))) throw new HttpError(404, "No such role.");
  const actions = await all<{ action: string }>(db, "SELECT action FROM role_actions WHERE role_id = ?", [roleId]);
  if (
    !canGrant(
      limit,
      actions.map((a) => a.action),
    )
  )
    throw new HttpError(403, tooMuch);
  await run(db, "UPDATE members SET everyday_role_id = ? WHERE id = ?", [roleId, id]);
}

/**
 * An admin sets another member's everyday role (an admin who runs the app as a member day to day), or clears it. The
 * same rule as their own: one that can do less than they can; and only for a member the caller may change at all.
 */
export async function setMemberEverydayRole(db: D1Database, id: number, o: Record<string, unknown>, by: By) {
  if (!(await first(db, "SELECT 1 FROM members WHERE id = ?", [id]))) throw new HttpError(404, "No such member.");
  await mayChange(db, by.actions, id);
  await setEverydayRole(
    db,
    id,
    o,
    await actionsOf(db, id),
    "Their everyday role has to be one that can do less than they can.",
  );
}

/** A member's everyday role, as the audit log records it: its name, or none (their full role). */
export const everydayOf = async (db: D1Database, id: number) =>
  (
    await first<{ name: string | null }>(
      db,
      "SELECT r.name FROM members m LEFT JOIN roles r ON r.id = m.everyday_role_id WHERE m.id = ?",
      [id],
    )
  )?.name ?? null;

/**
 * An admin sets how to reach a member: the email they sign in with (ADR 0023), and a phone. A blank email means
 * none; an email is one member's only. Whether the email changed: if it did, they're signed out everywhere (#72).
 */
export async function setContact(
  db: D1Database,
  id: number,
  o: Record<string, unknown>,
  by: By,
): Promise<{ emailChanged: boolean }> {
  const was = await first<{ email: string | null }>(db, "SELECT email FROM members WHERE id = ?", [id]);
  if (!was) throw new HttpError(404, "No such member.");
  // Their email signs them in: changing a more powerful member's would be a way to become them
  await mayChange(db, by.actions, id);
  const email = text(o, "email", { optional: true, max: 254 }).toLowerCase() || null;
  if (email && !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email))
    throw new HttpError(400, "That doesn't look like an email address.");
  const phone = text(o, "phone", { optional: true, max: 30 }) || null;
  if (email) {
    const other = await first<{ name: string }>(db, "SELECT name FROM members WHERE email = ? AND id != ?", [
      email,
      id,
    ]);
    if (other) throw new HttpError(409, `${other.name} already has that email.`);
  }
  await run(db, "UPDATE members SET email = ?, phone = ? WHERE id = ?", [email, phone, id]);
  return { emailChanged: (was.email?.toLowerCase() ?? null) !== email };
}

/** Make someone a Quarterly Member from today, or end it today (ADR 0007). */
export async function setQuarterly(db: D1Database, id: number, quarterly: boolean, today: string, now: string) {
  const m = await first<{ position: string }>(db, "SELECT position FROM members WHERE id = ?", [id]);
  if (!m) throw new HttpError(404, "No such member.");
  if (quarterly && m.position === "G") throw new HttpError(409, KEEPERS_FREE);
  const covering = "member_id = ? AND starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?)";
  if (quarterly) {
    await run(
      db,
      `INSERT INTO subscriptions (member_id, starts_on, created_at)
       SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE ${covering})`,
      [id, today, now, id, today, today],
    );
    return;
  }
  // Started today: as if it never was. Otherwise it ends today.
  await run(db, "DELETE FROM subscriptions WHERE member_id = ? AND starts_on = ?", [id, today]);
  await run(db, `UPDATE subscriptions SET ends_on = ? WHERE ${covering}`, [today, id, today, today]);
}

/** A member on some nights, as the record keeps it: their answer, whether they came, and whether they walked in. */
export const attendanceOn = (db: D1Database, id: number, sessionIds: number[]) =>
  all(
    db,
    `SELECT session_id sessionId, signup, attended, walk_in walkIn FROM attendance
     WHERE member_id = ? AND session_id IN (SELECT value FROM json_each(?)) ORDER BY session_id`,
    [id, JSON.stringify(sessionIds)],
  );

/**
 * A member's attendance for a year, newest first: every training session held so far that year, with what they said
 * and whether they came. Sessions they never answered are there too (signup null), so an admin can mark them.
 */
export async function attendanceOf(db: D1Database, id: number, year: string, today: string) {
  if (!(await first(db, "SELECT 1 FROM members WHERE id = ?", [id]))) throw new HttpError(404, "No such member.");
  const rows = await all<{
    sessionId: number;
    heldOn: string;
    series: string;
    signup: string | null;
    attended: number | null;
    walkIn: number | null;
    cancelled: string | null;
  }>(
    db,
    `SELECT s.id sessionId, s.held_on heldOn, ts.name series, a.signup, a.attended, a.walk_in walkIn,
            s.cancelled_at cancelled
     FROM training_sessions s JOIN training_series ts ON ts.id = s.series_id
       LEFT JOIN attendance a ON a.session_id = s.id AND a.member_id = ?
     WHERE s.held_on BETWEEN ? AND ? ORDER BY s.held_on DESC, s.id DESC`,
    [id, `${year}-01-01`, `${year}-12-31` < today ? `${year}-12-31` : today],
  );
  return rows.map((r) => ({
    sessionId: r.sessionId,
    heldOn: r.heldOn,
    series: r.series,
    signup: r.signup as "in" | "waitlist" | "out" | null,
    attended: r.attended === null ? null : Boolean(r.attended),
    walkIn: Boolean(r.walkIn),
    cancelled: Boolean(r.cancelled),
  }));
}

// ─── What the record compares (ADR 0095) ───
// Each reads one thing a change can touch, the same way before and after, so the route's audit writes an entry only
// when it really changed, with both sides.

/** A member's standing: whether they're in, and their roles (sorted). Null: no such member. */
export async function memberStanding(db: D1Database, id: number) {
  const m = await first<{ status: string; roles: string | null }>(
    db,
    `SELECT status, (SELECT group_concat(r.name) FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = m.id) roles FROM members m WHERE id = ?`,
    [id],
  );
  return m && { status: m.status, roles: m.roles ? m.roles.split(",").sort() : [] };
}

/** The email a member signs in with. */
export const memberEmail = async (db: D1Database, id: number) =>
  (await first<{ email: string | null }>(db, "SELECT email FROM members WHERE id = ?", [id]))?.email ?? null;

/** A member's name and email, for one just added. */
export const memberJoined = (db: D1Database, id: number) =>
  first<{ name: string; email: string | null }>(db, "SELECT name, email FROM members WHERE id = ?", [id]);

/** Whether a member is a Quarterly Member today (ADR 0007). */
/**
 * A member chooses next quarter's plan (ADR 0007): Quarterly, or pay as you go. Only next quarter, and only before it
 * starts, by today's date here, whatever the app showed. This quarter's plan is fixed; an admin can still change it.
 */
/** Keepers play training free (the Keeper plan, ADR 0007): nothing to choose, nothing to make Quarterly */
const KEEPERS_FREE = "Keepers play training free: there's no plan to choose.";

export async function choosePlan(db: D1Database, id: number, o: Record<string, unknown>, today: string, now: string) {
  const me = await first<{ position: string }>(db, "SELECT position FROM members WHERE id = ?", [id]);
  if (me?.position === "G") throw new HttpError(409, KEEPERS_FREE);
  if (typeof o.quarter !== "string" || !QUARTER.test(o.quarter))
    throw new HttpError(400, "quarter should be like 2027-Q1.");
  if (typeof o.quarterly !== "boolean") throw new HttpError(400, "quarterly should be true or false.");
  const next = nextQuarter(quarterOf(today));
  if (o.quarter !== next)
    throw new HttpError(
      409,
      o.quarter <= quarterOf(today)
        ? `${o.quarter} has started: its plan is fixed. Ask an admin if it's wrong.`
        : `Only next quarter (${next}) is open.`,
    );
  const starts = quarterStart(next);
  const lastDay = new Date(Date.parse(`${starts}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  // Whatever starts next quarter or later goes; then next quarter is covered or not
  await run(db, "DELETE FROM subscriptions WHERE member_id = ? AND starts_on >= ?", [id, starts]);
  const running = await first<{ id: number }>(
    db,
    "SELECT id FROM subscriptions WHERE member_id = ? AND starts_on < ? AND (ends_on IS NULL OR ends_on >= ?)",
    [id, starts, lastDay],
  );
  if (o.quarterly) {
    if (running) await run(db, "UPDATE subscriptions SET ends_on = NULL WHERE id = ?", [running.id]);
    else
      await run(db, "INSERT INTO subscriptions (member_id, starts_on, created_at) VALUES (?, ?, ?)", [id, starts, now]);
  } else if (running) await run(db, "UPDATE subscriptions SET ends_on = ? WHERE id = ?", [lastDay, running.id]);
}

/** A member's plan for next quarter, as the audit log records it. */
export const planNext = async (db: D1Database, id: number, today: string) => {
  const next = nextQuarter(quarterOf(today));
  return { quarter: next, quarterly: await quarterlyToday(db, id, quarterStart(next)) };
};

export const quarterlyToday = async (db: D1Database, id: number, today: string) =>
  Boolean(
    await first(
      db,
      "SELECT 1 FROM subscriptions WHERE member_id = ? AND starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?)",
      [id, today, today],
    ),
  );

/** A role's name and what it can do (sorted). Null: no such role. */
export async function roleSummary(db: D1Database, id: number) {
  const role = await first<{ name: string }>(db, "SELECT name FROM roles WHERE id = ?", [id]);
  if (!role) return null;
  const actions = await all<{ action: string }>(db, "SELECT action FROM role_actions WHERE role_id = ?", [id]);
  return { name: role.name, actions: actions.map((a) => a.action).sort() };
}
