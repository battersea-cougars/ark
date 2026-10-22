// Venues (ADR 0030): places the club goes, picked once, and where something is (a venue, or a name and a map link).
import { syncAll } from "@cougars/shared/agenda";
import { first, run, type Param } from "@cougars/shared/d1";
import { cleanMapUrl } from "@cougars/shared/places";
import { HttpError, int, text, time } from "../api/api.http";

/** Venues as read (api.club.ts). */
export const venuesFrom = (rows: { id: number; name: string; address: string; mapUrl: string; active: number }[]) =>
  rows.map((v) => ({ ...v, active: Boolean(v.active) }));

function mapUrlOf(o: Record<string, unknown>) {
  const url = cleanMapUrl(text(o, "mapUrl", { optional: true, max: 500 }));
  if (url === null) throw new HttpError(400, "The map link should be a web link, from Google Maps say.");
  return url;
}

const venueFields = (o: Record<string, unknown>): Param[] => [
  text(o, "name", { max: 80 }),
  text(o, "address", { optional: true, max: 160 }),
  mapUrlOf(o),
  o.active === false ? 0 : 1,
];

export async function createVenue(db: D1Database, o: Record<string, unknown>) {
  const res = await run(db, "INSERT INTO venues (name, address, map_url, active) VALUES (?, ?, ?, ?)", venueFields(o));
  return { id: Number(res.meta.last_row_id) };
}

export async function updateVenue(db: D1Database, id: number, o: Record<string, unknown>) {
  const res = await run(db, "UPDATE venues SET name = ?, address = ?, map_url = ?, active = ? WHERE id = ?", [
    ...venueFields(o),
    id,
  ]);
  if (!res.meta.changes) throw new HttpError(404, "No such venue.");
  // It's the place of everything held there: the agenda's rows say where (ADR 0042)
  await syncAll(db);
}

/**
 * Where something is: `venueId`, a saved venue, or else a name (under `nameKey`) and the map link pasted for it.
 * With a venue, the name and link are cleared: the venue's are what show. As [venue_id, name, map_url].
 */
export async function placeFields(db: D1Database, o: Record<string, unknown>, nameKey: string): Promise<Param[]> {
  const venueId = int(o, "venueId", { min: 1, nullable: true });
  if (venueId === null) return [null, text(o, nameKey, { optional: true, max: 120 }), mapUrlOf(o)];
  if (!(await first(db, "SELECT 1 FROM venues WHERE id = ?", [venueId]))) throw new HttpError(400, "No such venue.");
  return [venueId, "", ""];
}

/**
 * Where everyone goes afterwards (ADR 0074): `afterVenueId`, a saved venue (none: nowhere), `afterTime` (HH:MM,
 * optional) and `afterNote`, what for. As [after_venue_id, after_time, after_note].
 */
export async function afterFields(db: D1Database, o: Record<string, unknown>): Promise<Param[]> {
  const venueId = int(o, "afterVenueId", { min: 1, nullable: true });
  if (venueId === null) return [null, null, ""];
  if (!(await first(db, "SELECT 1 FROM venues WHERE id = ?", [venueId]))) throw new HttpError(400, "No such venue.");
  const at = o.afterTime == null || o.afterTime === "" ? null : time(o, "afterTime");
  return [venueId, at, text(o, "afterNote", { optional: true, max: 80 }).trim()];
}
