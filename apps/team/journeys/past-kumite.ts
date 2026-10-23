// A journey's way to a past Kumite (ADR 0123, dev and local only): a Kumite on a day gone by, signed up for, its
// draft, every match and every award played out on that evening, so it's history with a whole evening behind it. Only
// to get a story to a step that isn't the one under test (what a past Kumite shows), as `asMember` is; say so where
// it's called.
import { asMember } from "./journey";

/** A member's changes are limited to 60 a minute (api.limits.ts): the simulator's floor, as the app keeps to. */
const FLOOR_MS = 1250;

/**
 * As the admin `email`, a Kumite of series `typeId` on `heldOn` (YYYY-MM-DD, before today), played out to its last
 * award a few moves a request (Spin kick). Its id.
 */
export async function kumiteOnAPastDay(email: string, heldOn: string, typeId = 1): Promise<number> {
  const api = asMember(email);
  const { id } = (await api("POST", "/api/tournaments/past-day", { typeId, heldOn })) as { id: number };
  for (let i = 0; i < 400; i++) {
    const began = Date.now();
    const move = (await api("POST", `/api/tournaments/${id}/simulate`, { moves: 4, onItsDay: true })) as {
      done: boolean;
    };
    if (move.done) return id;
    await new Promise((go) => setTimeout(go, Math.max(0, began + FLOOR_MS - Date.now())));
  }
  throw new Error(`The Kumite on ${heldOn} never finished playing out.`);
}
