// What a member chooses to hear (ADR 0108, #24): on or off for each topic (src/lib/notification-topics.ts), theirs
// alone. No row is on; a switch is a row. notify() reads them inside the statement that fills the outbox.
import { run } from "@cougars/shared/d1";
import { HttpError } from "../api/api.http";
import { TOPICS, allOn, isTopic, type NotificationPrefs } from "../../src/lib/notification-topics";

/** The rows as read ({ topic, enabled }), as a choice for every topic: what's not there is on. */
export function prefsFrom(rows: { topic: string; enabled: number }[]): NotificationPrefs {
  const prefs = allOn();
  for (const r of rows) if (isTopic(r.topic)) prefs[r.topic] = !!r.enabled;
  return prefs;
}

/** { [topic]: boolean, ... }: this member's choice for one topic or more, in one statement. */
export async function choosePrefs(db: D1Database, memberId: number, o: Record<string, unknown>) {
  const chosen = Object.entries(o);
  if (!chosen.length) throw new HttpError(400, "Which notifications?");
  for (const [topic, on] of chosen) {
    if (!isTopic(topic))
      throw new HttpError(400, `${topic} isn't a kind of notification: ${TOPICS.map((t) => t.topic).join(", ")}.`);
    if (typeof on !== "boolean") throw new HttpError(400, `${topic} should be true or false.`);
  }
  await run(
    db,
    `INSERT INTO notification_prefs (member_id, topic, enabled) SELECT ?, key, value FROM json_each(?) WHERE true
     ON CONFLICT (member_id, topic) DO UPDATE SET enabled = excluded.enabled`,
    [memberId, JSON.stringify(Object.fromEntries(chosen.map(([t, on]) => [t, on ? 1 : 0])))],
  );
}
