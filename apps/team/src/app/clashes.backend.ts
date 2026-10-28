// Something already on then (ADR 0122): asking the Worker what a new time is over, and calling off what the admin
// chose after their save went in. Only the editors ask, so it's its own module, not on Home's first paint (ADR 0120).
import type { ClashQuestion, Skip } from "../lib/clashes";
import { api } from "./api";
import { save, setCancelled, setClubEventCancelled } from "./backend.svelte";

/** Something on the calendar a new time is over (worker/calendar/clashes.ts). */
export interface Clash {
  /** Which it is ("session:12"), as a training's save says it was asked about. */
  key: string;
  source: "session" | "tournament" | "club_event";
  /** Null for a training night its rule gives that isn't made yet. */
  id: number | null;
  seriesId: number | null;
  title: string;
  day: string;
  startsAt: string;
  endsAt: string;
  canCancel: boolean;
  signedUp: number;
  /** Asked with a training's rule: the days of its nights this is over, which it could skip instead. */
  nights?: string[];
}
/**
 * What's on between these two times (`except`: the thing being edited, "tournament:5"), or over the nights a
 * training's save adds or moves (lib/clashes.ts).
 */
export async function findClashes(q: ClashQuestion) {
  const params: Record<string, string> =
    "weekdays" in q
      ? {
          ...(q.seriesId ? { series: String(q.seriesId) } : {}),
          weekdays: q.weekdays.join(","),
          repeatEvery: String(q.repeatEvery),
          startsOn: q.startsOn,
          endsOn: q.endsOn ?? "",
          startTime: q.startTime,
          endTime: q.endTime,
        }
      : { startsAt: q.startsAt, endsAt: q.endsAt, ...(q.except ? { except: q.except } : {}) };
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return (await api<{ clashes: Clash[] }>("GET", `/api/calendar/clashes?${query.join("&")}`)).clashes;
}
/**
 * Call off what the admin chose, after their save went in: each by its own cancel (the members told, nobody charged),
 * a training night past the weeks made ahead made first. Saving a tournament (`tournamentId`), a night goes off for
 * it, so it comes back when the tournament's deleted or moved (#186). How many went off.
 */
export async function cancelClashes(chosen: Clash[], tournamentId?: number) {
  let off = 0;
  for (const c of chosen) {
    if (c.source === "club_event" && c.id) {
      if ((await setClubEventCancelled(c.id, true)) !== null) off++;
    } else if (c.source === "session" && (await cancelNight(c.seriesId!, c.day, c.id, tournamentId))) off++;
  }
  return off;
}
/**
 * A training skipping its own nights over something that stays on (the Kumite), after its save went in: each night
 * made if it isn't yet (the same one if it is), then off by its own cancel, for the tournament it's over. How many
 * went off.
 */
export async function skipNights(seriesId: number, skips: Skip[]) {
  let off = 0;
  for (const s of skips) if (await cancelNight(seriesId, s.day, null, s.tournamentId ?? undefined)) off++;
  return off;
}
/** One training night off by its own cancel; one the weeks ahead haven't made yet is made first. */
async function cancelNight(seriesId: number, day: string, id: number | null, tournamentId?: number) {
  const night =
    id ?? (await save(() => api<{ id: number }>("POST", `/api/series/${seriesId}/sessions`, { heldOn: day }), ""))?.id;
  return !!night && (await setCancelled(night, true, tournamentId)) !== null;
}
