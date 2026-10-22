// Club events (ADR 0042): one-offs on the calendar.
import { syncClubEvent } from "@cougars/shared/agenda";
import { batch, run, statement, type Param } from "@cougars/shared/d1";
import { fillingUp } from "../entries/entries";
import { HttpError, bool, int, text } from "../api/api.http";
import { placeFields } from "../settings/venues";

/** One-off events as read (api.club.ts): those that haven't ended. */
export const clubEventsFrom = (
  rows: {
    id: number;
    title: string;
    startsAt: string;
    endsAt: string;
    venueId: number | null;
    venue: string;
    mapUrl: string;
    description: string;
    public: number;
    signup: number;
    capacity: number | null;
    cancelledAt: string | null;
  }[],
) => rows.map((e) => ({ ...e, public: Boolean(e.public), signup: Boolean(e.signup) }));

async function clubEventFields(db: D1Database, o: Record<string, unknown>) {
  const startsAt = text(o, "startsAt", { max: 30 });
  const endsAt = text(o, "endsAt", { max: 30 });
  if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt)) || endsAt < startsAt)
    throw new HttpError(400, "The start and end should be times, the end after the start.");
  return [
    text(o, "title", { max: 80 }),
    startsAt,
    endsAt,
    ...(await placeFields(db, o, "venue")),
    text(o, "description", { optional: true, max: 280 }),
    // Shown on the website unless said otherwise
    o.public === false ? 0 : 1,
    bool(o, "signup") ? 1 : 0,
    int(o, "capacity", { min: 1, max: 500, nullable: true }),
  ] as Param[];
}

export async function createClubEvent(db: D1Database, o: Record<string, unknown>) {
  const res = await run(
    db,
    `INSERT INTO club_events (title, starts_at, ends_at, venue_id, venue, map_url, description, public, signup_enabled,
       capacity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    await clubEventFields(db, o),
  );
  await syncClubEvent(db, Number(res.meta.last_row_id));
  return { id: Number(res.meta.last_row_id) };
}

/** Change an event; a limit raised moves the first waiting up into its room, in the same batch (ADR 0030). */
export async function updateClubEvent(
  db: D1Database,
  id: number,
  o: Record<string, unknown>,
  today: string,
  now: string,
) {
  const [res] = await batch(db, [
    statement(
      db,
      `UPDATE club_events SET title = ?, starts_at = ?, ends_at = ?, venue_id = ?, venue = ?, map_url = ?, description = ?,
         public = ?, signup_enabled = ?, capacity = ? WHERE id = ?`,
      [...(await clubEventFields(db, o)), id],
    ),
    fillingUp(db, "event", { sql: "t.id = ?", params: [id] }, today, now),
  ]);
  if (!res.meta.changes) throw new HttpError(404, "No such event.");
  await syncClubEvent(db, id);
}

/** Cancelling keeps the event (and who said they're in), marked as off; un-cancelling puts it back. */
export async function setClubEventCancelled(db: D1Database, id: number, cancelled: boolean, now: string) {
  const res = await run(db, "UPDATE club_events SET cancelled_at = ? WHERE id = ?", [cancelled ? now : null, id]);
  if (!res.meta.changes) throw new HttpError(404, "No such event.");
  await syncClubEvent(db, id);
}
