// A night's register closes at 06:00 London the morning after (lib/register-closes.ts; ADR 0030, ADR 0007; #11):
// from then who was there, and what it charged, is the record. The register, an admin putting someone in or taking
// them off, Let in, a reset and calling the night off (or back on) are all refused, in the app's words.
import { first } from "@cougars/shared/d1";
import { REGISTER_CLOSED, registerClosed } from "../../src/lib/register-closes";
import { HttpError } from "../api/api.http";

/** Refuses a change to a night held on `heldOn` once its register's closed. */
export function refuseClosedRegister(heldOn: string, now: string) {
  if (registerClosed(heldOn, new Date(now))) throw new HttpError(409, REGISTER_CLOSED);
}

/** The same, for a session by its id; one that doesn't exist is left to the caller's 404. */
export async function refuseClosedSession(db: D1Database, sessionId: number, now: string) {
  const s = await first<{ heldOn: string }>(db, "SELECT held_on heldOn FROM training_sessions WHERE id = ?", [
    sessionId,
  ]);
  if (s) refuseClosedRegister(s.heldOn, now);
}
