// A member's right to go, and to see what's held about them (#30, ADR 0029). Erasing keeps the member's row, so the
// club's records still add up (a payment, last Friday's numbers, a goal), but empties everything that says who they
// were: they become "Former member", with no email, phone, bio or bank reference, and no way back in. Their roles,
// sessions, sign-in codes, notification choices and places for what's still to come go. Earlier audit entries stop
// naming them.
import { batch, first, statement } from "@cougars/shared/d1";
import { HttpError, json } from "../api/api.http";
import { actionsOf } from "./members";
import { prefsFrom } from "../push/push.prefs";

export const FORMER_MEMBER = "Former member";

/** Erase a member, by their own hand or an admin's. Never the club's last admin: the club would have none. */
export async function eraseMember(db: D1Database, id: number, today: string, now: string) {
  const m = await first<{ name: string; email: string | null; phone: string | null; webName: string | null }>(
    db,
    "SELECT name, email, phone, web_name webName FROM members WHERE id = ? AND status != 'erased'",
    [id],
  );
  if (!m) throw new HttpError(404, "No such member.");
  if ((await actionsOf(db, id)).has("manage:all")) {
    const others = await first<{ n: number }>(
      db,
      `SELECT count(DISTINCT m.id) n FROM members m JOIN member_roles mr ON mr.member_id = m.id
         JOIN role_actions ra ON ra.role_id = mr.role_id
       WHERE ra.action = 'manage:all' AND m.status = 'active' AND m.id != ?`,
      [id],
    );
    if (!others?.n) throw new HttpError(409, "You're the club's last admin: make someone else an admin first.");
  }

  const q = (sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params);
  const scrubbed = "[erased]";
  await db.batch([
    q(
      `UPDATE members SET name = ?, email = NULL, phone = NULL, photo = NULL, bio = '', web_name = NULL,
         payment_reference = NULL, everyday_role_id = NULL, cougar = 0, status = 'erased' WHERE id = ?`,
      FORMER_MEMBER,
      id,
    ),
    q("DELETE FROM member_roles WHERE member_id = ?", id),
    q("DELETE FROM auth_sessions WHERE member_id = ?", id),
    q("DELETE FROM login_challenges WHERE member_id = ?", id),
    q("DELETE FROM notification_prefs WHERE member_id = ?", id),
    // Places for what's still to come are given up; what's been played stays, about nobody
    q(
      "DELETE FROM attendance WHERE member_id = ? AND session_id IN (SELECT id FROM training_sessions WHERE held_on >= ?)",
      id,
      today,
    ),
    q(
      "DELETE FROM tournament_entries WHERE member_id = ? AND tournament_id IN (SELECT id FROM tournaments WHERE held_on >= ?)",
      id,
      today,
    ),
    q(
      "DELETE FROM club_event_entries WHERE member_id = ? AND event_id IN (SELECT id FROM club_events WHERE starts_at >= ?)",
      id,
      now,
    ),
    q("DELETE FROM subscriptions WHERE member_id = ? AND starts_on > ?", id, today),
    // The record: their email wherever it's written; their name and phone in the entries about them
    ...(m.email
      ? [
          q(
            "UPDATE audit_log SET detail = replace(detail, ?, ?) WHERE instr(detail, ?) > 0",
            m.email,
            scrubbed,
            m.email,
          ),
          q("DELETE FROM dev_mail_recipients WHERE email = ?", m.email),
        ]
      : []),
    ...[m.name, m.webName, m.phone]
      .filter((v): v is string => !!v)
      .map((v) =>
        q(
          `UPDATE audit_log SET detail = replace(detail, ?, ?)
           WHERE instr(detail, ?) > 0 AND (member_id = ? OR json_extract(detail, '$.memberId') = ?)`,
          v,
          scrubbed,
          v,
          id,
          id,
        ),
      ),
  ]);
}

/** Everything the app holds about a member, as they'd download it. Their rating is the club's opinion, kept out. */
export async function memberData(db: D1Database, id: number, today: string): Promise<Response> {
  // Every part in one round trip (ADR 0059)
  const [profile, ...rows] = (
    await batch(db, [
      statement(
        db,
        `SELECT name, web_name goesBy, email, phone, position, bio, cougar, status, joined_on joinedOn,
            payment_reference paymentReference FROM members WHERE id = ?`,
        [id],
      ),
      statement(
        db,
        "SELECT r.name FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.member_id = ? ORDER BY r.id",
        [id],
      ),
      statement(
        db,
        `SELECT s.held_on heldOn, a.signup, a.attended, a.walk_in walkIn, a.signed_up_at signedUpAt
       FROM attendance a JOIN training_sessions s ON s.id = a.session_id WHERE a.member_id = ? ORDER BY s.held_on`,
        [id],
      ),
      statement(
        db,
        `SELECT t.name, t.held_on heldOn, e.signup, e.attended, e.signed_up_at signedUpAt
       FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.member_id = ? ORDER BY t.held_on`,
        [id],
      ),
      statement(
        db,
        `SELECT ev.title, ev.starts_at startsAt, e.signup, e.signed_up_at signedUpAt
       FROM club_event_entries e JOIN club_events ev ON ev.id = e.event_id WHERE e.member_id = ? ORDER BY ev.starts_at`,
        [id],
      ),
      statement(
        db,
        "SELECT starts_on startsOn, ends_on endsOn FROM subscriptions WHERE member_id = ? ORDER BY starts_on",
        [id],
      ),
      statement(
        db,
        `SELECT due_on dueOn, amount_pence amountPence, quarter, reason FROM charges WHERE member_id = ? ORDER BY due_on`,
        [id],
      ),
      statement(
        db,
        `SELECT received_on receivedOn, amount_pence amountPence, via, reason FROM payments WHERE member_id = ?
       ORDER BY received_on`,
        [id],
      ),
      statement(
        db,
        `SELECT method, user_agent browser, created_at signedInAt, last_seen_at lastSeenAt, expires_at expiresAt,
              revoked_at signedOutAt FROM auth_sessions WHERE member_id = ? ORDER BY created_at`,
        [id],
      ),
      statement(db, "SELECT at, action FROM audit_log WHERE member_id = ? ORDER BY id", [id]),
      statement(db, "SELECT topic, enabled FROM notification_prefs WHERE member_id = ? ORDER BY topic", [id]),
    ])
  ).map((r) => r.results);
  const [roles, training, tournaments, events, plans, charges, payments, devices, record, notifications] = rows;
  const data = {
    about: "Everything the Battersea Cougars team app holds about you, on the day you downloaded it.",
    downloadedOn: today,
    profile: profile[0] ?? null,
    roles: (roles as { name: string }[]).map((r) => r.name),
    training,
    tournaments,
    events,
    plans,
    charges,
    payments,
    devices,
    record,
    // What your phone tells you: every kind of notification, on unless you turned it off
    notifications: prefsFrom(notifications as { topic: string; enabled: number }[]),
  };
  const res = json(data);
  res.headers.set("content-disposition", `attachment; filename="cougars-my-data-${today}.json"`);
  res.headers.set("cache-control", "no-store");
  return res;
}
