// What's already on when something new would be (ADR 0122): the calendar's timed things that overlap a window, so an
// admin putting the Kumite on a Friday night is asked whether Friday Training is off. Read from the agenda (ADR 0042),
// which every part of the club keeps, plus the nights a training's rule gives that aren't made yet (sessions are
// made 12 weeks ahead, ADR 0030; a tournament is often further off).
import { all } from "@cougars/shared/d1";
import { londonDay, londonISO } from "@cougars/shared/london";
import { can, type Action } from "../../src/access/actions";
import { addDays, ruleDates, type Weekday } from "../../src/lib/recurrence";
import { HttpError } from "../api/api.http";

export interface Clash {
  /** What it is: a training night, a tournament's day, a one-off. */
  source: "session" | "tournament" | "club_event";
  /** Its row; null for a training night the rule gives that isn't made yet. */
  id: number | null;
  /** A training night's series (to make the night before cancelling it). */
  seriesId: number | null;
  title: string;
  day: string;
  startsAt: string;
  endsAt: string;
  /** Whether whoever asked can call it off here: training and one-offs, by their own cancel. A tournament can't. */
  canCancel: boolean;
  /** Who's in or waiting: who'd hear it's off. */
  signedUp: number;
}

/** Each kind's cancel, and the action it needs (training.routes.ts, events.routes.ts). */
const CANCEL: Record<Clash["source"], Action | null> = {
  session: "manage:Training",
  club_event: "update:Event",
  tournament: null,
};

const ms = (iso: string) => Date.parse(iso);
/** Half-open windows: one ending as the other starts doesn't clash. */
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/**
 * What's on between `startsAt` and `endsAt` that isn't off already: training nights, tournament days and one-offs
 * with a time (not a deadline or a draft night, which have none, nor a tournament that's only a season so far).
 * `except` is the thing being edited ("tournament:5", "club_event:3"), which can't clash with itself.
 */
export async function findClashes(
  db: D1Database,
  window: { startsAt: string; endsAt: string; except?: string | null },
  today: string,
  actions: Set<Action>,
): Promise<Clash[]> {
  const span: [number, number] = [ms(window.startsAt), ms(window.endsAt)];
  if (Number.isNaN(span[0]) || Number.isNaN(span[1]) || span[1] < span[0])
    throw new HttpError(400, "startsAt and endsAt should be times, the end after the start.");
  // A night that runs past midnight is on two days; nothing that's been is worth asking about
  const from = londonDay(window.startsAt) > today ? londonDay(window.startsAt) : today;
  const to = londonDay(window.endsAt);
  if (to < from) return [];

  const [rows, series, made] = await Promise.all([
    all<{ source: Clash["source"]; id: number; title: string; day: string; startsAt: string; endsAt: string }>(
      db,
      // Through the day index (agenda_day); the evening before too, for one that runs past midnight
      `SELECT source, source_id id, title, day, starts_at startsAt, ends_at endsAt FROM agenda
       WHERE day BETWEEN ? AND ? AND kind IN ('training', 'tournament', 'event')
         AND all_day = 0 AND date_tbc = 0 AND cancelled = 0 AND audience = 'everyone'`,
      [addDays(from, -1), to],
    ),
    all<{
      id: number;
      name: string;
      repeatEvery: number;
      weekdays: string;
      startsOn: string;
      endsOn: string | null;
      startTime: string;
      endTime: string;
    }>(
      db,
      `SELECT id, name, repeat_every repeatEvery, weekdays, starts_on startsOn, ends_on endsOn, start_time startTime,
              end_time endTime
       FROM training_series WHERE active = 1`,
    ),
    // Every night made on those days, cancelled or moved too: a night the rule gives that's here isn't still to make
    all<{ seriesId: number; heldOn: string; movedFrom: string | null }>(
      db,
      `SELECT series_id seriesId, held_on heldOn, moved_from movedFrom FROM training_sessions
       WHERE held_on BETWEEN ? AND ? OR moved_from BETWEEN ? AND ?`,
      [addDays(from, -1), to, addDays(from, -1), to],
    ),
  ]);

  const found: Omit<Clash, "canCancel" | "signedUp">[] = rows.map((r) => ({
    source: r.source,
    id: r.id,
    seriesId: null,
    title: r.title,
    day: r.day,
    startsAt: r.startsAt,
    endsAt: endOf(r.startsAt, r.endsAt),
  }));
  // The nights still to make: what each rule gives on those days, less what's made
  const taken = new Set(made.flatMap((s) => [`${s.seriesId}:${s.heldOn}`, `${s.seriesId}:${s.movedFrom}`]));
  for (const s of series) {
    const rule = {
      repeatEvery: s.repeatEvery,
      weekdays: s.weekdays.split(",") as Weekday[],
      startsOn: s.startsOn,
      endsOn: s.endsOn,
    };
    for (const day of ruleDates(rule, addDays(from, -1), to))
      if (!taken.has(`${s.id}:${day}`)) {
        const startsAt = londonISO(day, s.startTime);
        found.push({
          source: "session",
          id: null,
          seriesId: s.id,
          title: s.name,
          day,
          startsAt,
          endsAt: endOf(startsAt, londonISO(day, s.endTime)),
        });
      }
  }

  const clashes = found.filter(
    (c) => `${c.source}:${c.id}` !== window.except && c.day >= today && overlaps(span, [ms(c.startsAt), ms(c.endsAt)]),
  );
  const sessionIds = clashes.filter((c) => c.source === "session" && c.id).map((c) => c.id);
  const eventIds = clashes.filter((c) => c.source === "club_event").map((c) => c.id);
  const [sessionMeta, signedUp] = await Promise.all([
    all<{ id: number; seriesId: number }>(
      db,
      "SELECT id, series_id seriesId FROM training_sessions WHERE id IN (SELECT value FROM json_each(?))",
      [JSON.stringify(sessionIds)],
    ),
    // Who'd hear it's off (push.notices.ts sessionOff): those in or waiting
    all<{ source: string; id: number; n: number }>(
      db,
      `SELECT 'session' source, session_id id, COUNT(*) n FROM attendance
       WHERE session_id IN (SELECT value FROM json_each(?)) AND signup IN ('in', 'waitlist') GROUP BY session_id
       UNION ALL
       SELECT 'club_event', event_id, COUNT(*) FROM club_event_entries
       WHERE event_id IN (SELECT value FROM json_each(?)) AND signup IN ('in', 'waitlist') GROUP BY event_id`,
      [JSON.stringify(sessionIds), JSON.stringify(eventIds)],
    ),
  ]);
  return clashes
    .map((c) => {
      const cancel = CANCEL[c.source];
      return {
        ...c,
        seriesId: c.seriesId ?? sessionMeta.find((s) => s.id === c.id)?.seriesId ?? null,
        canCancel: cancel !== null && can(actions, cancel),
        signedUp: signedUp.find((n) => n.source === c.source && n.id === c.id)?.n ?? 0,
      };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
}

/** A night whose end is before its start runs past midnight: it ends the next day. */
function endOf(startsAt: string, endsAt: string | null) {
  if (!endsAt) return startsAt;
  return ms(endsAt) < ms(startsAt) ? new Date(ms(endsAt) + 86_400_000).toISOString() : endsAt;
}
