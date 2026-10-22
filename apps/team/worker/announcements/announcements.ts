// Announcements (#85): an admin's note at the top of Home ("No training on the 24th, the hall's booked"), until its
// last day; each member can dismiss it for themselves. One or two at a time, newest first (the club read takes the
// two newest still on), not a feed. "Got it" is a member being done with one; all of them can be looked back over, a
// page at a time, with whether you got each.
import { all, first, run } from "@cougars/shared/d1";
import { HttpError, isDay, text } from "../api/api.http";

export const PAST_PAGE = 20;
const PAST_PAGE_MAX = 100;

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
  const endsOn = isDay(o.endsOn) ? o.endsOn : "";
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

/** One announcement, looking back: who posted it (if they're still a member), and whether this member got it. */
export interface PastAnnouncement {
  id: number;
  title: string;
  body: string;
  link: string | null;
  endsOn: string;
  createdAt: string;
  by: string | null;
  gotIt: boolean;
}

/** Every announcement before `before` (an id; none: the newest), newest first, a page at a time, in one read. */
export async function pastAnnouncements(
  db: D1Database,
  memberId: number,
  { before = null, limit = PAST_PAGE }: { before?: number | null; limit?: number } = {},
): Promise<{ announcements: PastAnnouncement[]; more: boolean }> {
  const n = Math.min(Math.max(1, limit), PAST_PAGE_MAX);
  const rows = await all<Omit<PastAnnouncement, "gotIt"> & { gotIt: number }>(
    db,
    `SELECT a.id, a.title, a.body, a.link, a.ends_on endsOn, a.created_at createdAt, m.name "by",
            EXISTS (SELECT 1 FROM announcement_dismissals d WHERE d.announcement_id = a.id AND d.member_id = ?) gotIt
     FROM announcements a LEFT JOIN members m ON m.id = a.created_by
     WHERE ? IS NULL OR a.id < ?
     ORDER BY a.id DESC LIMIT ?`,
    [memberId, before, before, n + 1],
  );
  return { announcements: rows.slice(0, n).map((r) => ({ ...r, gotIt: !!r.gotIt })), more: rows.length > n };
}
