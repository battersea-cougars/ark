// A member's profile photo (ADR 0123): their phone shrinks it to a small square, it's kept in D1 as a data: URL, and
// the app shows it at /api/members/<id>/photo?v=<when it was set>, so browsers keep it until it changes.
import { first, run } from "@cougars/shared/d1";
import { HttpError } from "../api/api.http";

const PHOTO = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/]+=*)$/;
/** A 512px square at the app's quality is 30–80 KB; this leaves room for a busy one, and no more. */
export const MAX_PHOTO = 300 * 1024;
/** What the route may be sent: the photo, base64 in JSON. */
export const MAX_PHOTO_BODY = MAX_PHOTO + 1024;

/** Your own photo: `{ photo }`, a PNG, JPEG or WebP data: URL, or null to take it down (your initials show). */
export async function setPhoto(db: D1Database, id: number, o: Record<string, unknown>, now: string) {
  const photo = o.photo == null || o.photo === "" ? null : o.photo;
  if (photo !== null && (typeof photo !== "string" || photo.length > MAX_PHOTO || !PHOTO.test(photo)))
    throw new HttpError(400, "A photo should be a small PNG, JPEG or WebP image.");
  await run(db, "UPDATE members SET photo = ?, photo_at = ? WHERE id = ?", [photo, photo && now, id]);
}

/**
 * A member's photo, as an image, for anyone who may see them in the app: an active member, yourself, or anyone if you
 * manage members (as the bootstrap's members, ADR 0036). Its address carries when it was set, so it's kept a year.
 */
export async function photoOf(db: D1Database, id: number, viewer: { memberId: number; seesAll: boolean }) {
  const m = await first<{ photo: string | null; status: string }>(
    db,
    "SELECT photo, status FROM members WHERE id = ?",
    [id],
  );
  const shown = m && (viewer.seesAll || m.status === "active" || id === viewer.memberId);
  const [, type, data] = (shown && m.photo?.match(PHOTO)) || [];
  if (!type) return new Response("No photo.", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(
    Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)),
    {
      headers: {
        "content-type": `image/${type}`,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
