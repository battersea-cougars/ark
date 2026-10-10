// Announcements (#85): an admin's note at the top of Home ("No training on the 24th, the hall's booked"), until its
// last day; each member can dismiss it for themselves. One or two at a time, newest first (the club read takes the
// two newest still on), not a feed.
import { first, run } from "@cougars/shared/d1";
import { HttpError, text } from "../api/api.http";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What an announcement is, for the record: read the same way before and after a change. */
export const announcementSummary = (db: D1Database, id: number) =>
  first(db, "SELECT id, title, body, link, ends_on endsOn FROM announcements WHERE id = ?", [id]);

export async function postAnnouncement(
  db: D1Database,
  o: Record<string, unknown>,
  by: number,
  today: string,
  now: string,
) {
  const title = text(o, "title", { max: 80 }).trim();
  if (!title) throw new HttpError(400, "Give it a title.");
  const body = text(o, "body", { optional: true, max: 280 }).trim();
  const link = text(o, "link", { optional: true, max: 300 }).trim() || null;
  // A link goes somewhere on the web, never a script (what an admin types is shown to everyone)
  if (link && !/^https:\/\/[^\s]+$/i.test(link)) throw new HttpError(400, "A link should start with https://.");
  const endsOn = typeof o.endsOn === "string" && DAY.test(o.endsOn) ? o.endsOn : "";
  if (!endsOn) throw new HttpError(400, "Say which day it ends.");
  if (endsOn < today) throw new HttpError(400, "That day's gone: pick today or later.");
  const res = await run(
    db,
    "INSERT INTO announcements (title, body, link, ends_on, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [title, body, link, endsOn, by, now],
  );
  return { id: Number(res.meta.last_row_id) };
}

export async function removeAnnouncement(db: D1Database, id: number) {
  const res = await run(db, "DELETE FROM announcements WHERE id = ?", [id]);
  if (!res.meta.changes) throw new HttpError(404, "No such announcement.");
}

/** A member's done with it: gone from their Home, still there for everyone else. */
export async function dismissAnnouncement(db: D1Database, id: number, memberId: number) {
  if (!(await first(db, "SELECT 1 FROM announcements WHERE id = ?", [id])))
    throw new HttpError(404, "No such announcement.");
  await run(db, "INSERT OR IGNORE INTO announcement_dismissals (announcement_id, member_id) VALUES (?, ?)", [
    id,
    memberId,
  ]);
}
