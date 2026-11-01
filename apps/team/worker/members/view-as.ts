// Viewing the app as a member (ADR 0024, #40): an admin's sign-in records who they're viewing as, and the API answers
// it as that member would be answered, refusing every change but going back. It's the sign-in's, so it lasts through a
// reload and ends with signing out; a member who's left the club, or an admin who may no longer, ends it on the next
// request.
import { first, run } from "@cougars/shared/d1";
import { can, type Action } from "../../src/access/actions";
import { shortName } from "../../src/lib/names";
import { HttpError } from "../api/api.http";
import { audit } from "../settings/audit";
import { actionsOf } from "./members";

/** The member a sign-in is viewing as, as the refusal names them. */
export interface Viewed {
  id: number;
  name: string;
  webName: string | null;
}

/** Who this sign-in is viewing as (null: nobody): the record's subject for starting and ending (ADR 0095). */
export async function viewingAsOf(db: D1Database, sessionId: number | null) {
  if (sessionId == null) return null;
  const row = await first<{ viewing_as: number | null }>(db, "SELECT viewing_as FROM auth_sessions WHERE id = ?", [
    sessionId,
  ]);
  return row?.viewing_as ?? null;
}

/** Start viewing as a member. The route has checked who may; this says yes to anyone active who isn't you. */
export async function startViewing(db: D1Database, sessionId: number, memberId: number) {
  await run(db, "UPDATE auth_sessions SET viewing_as = ? WHERE id = ?", [memberId, sessionId]);
}

/** Back to yourself. */
export async function endViewing(db: D1Database, sessionId: number) {
  await run(db, "UPDATE auth_sessions SET viewing_as = NULL WHERE id = ?", [sessionId]);
}

/**
 * Who a request is answered as, and with what actions: the member signed in, or the one they're still viewing as
 * (`viewing`), with that member's.
 */
export async function answeredAs(
  db: D1Database,
  now: Date,
  who: { memberId: number; sessionId?: number; viewingAs?: number | null },
  actions: Set<Action>,
) {
  const { memberId, sessionId, viewingAs } = who;
  const viewing =
    viewingAs != null && sessionId != null
      ? await stillViewing(db, now, { memberId, sessionId, viewingAs }, actions)
      : null;
  if (!viewing) return { viewing, memberId, actions };
  return { viewing, memberId: viewing.id, actions: await actionsOf(db, viewing.id) };
}

/**
 * The member a sign-in is still viewing as: someone in the club, viewed by someone who still holds View as a member.
 * Anything else ends it, on the record, and the sign-in is its own member's again (null).
 */
async function stillViewing(
  db: D1Database,
  now: Date,
  who: { memberId: number; sessionId: number; viewingAs: number },
  actions: ReadonlySet<Action>,
): Promise<Viewed | null> {
  const viewed = await first<Viewed>(
    db,
    "SELECT id, name, web_name webName FROM members WHERE id = ? AND status = 'active'",
    [who.viewingAs],
  );
  if (viewed && can(actions, "impersonate:Member")) return viewed;
  const ended = await run(db, "UPDATE auth_sessions SET viewing_as = NULL WHERE id = ? AND viewing_as = ?", [
    who.sessionId,
    who.viewingAs,
  ]);
  if (ended.meta.changes === 1)
    await audit(db, now, who.memberId, "view_as.ended", { memberId: who.viewingAs, from: who.viewingAs, to: null });
  return null;
}

/** Why a change is refused while viewing as someone: in words, with the way back. */
export const viewingRefusal = (viewed: Viewed) =>
  `You're viewing as ${shortName(viewed)}: go back to yourself to change anything.`;

/** A sign-in's own change outside the API (a passkey, a phone for notifications): refused while it's viewing as someone. */
export async function refuseWhileViewing(db: D1Database, viewingAs: number | null) {
  if (viewingAs == null) return;
  const viewed = await first<Viewed>(db, "SELECT id, name, web_name webName FROM members WHERE id = ?", [viewingAs]);
  throw new HttpError(403, viewingRefusal(viewed ?? { id: viewingAs, name: "someone", webName: null }));
}
