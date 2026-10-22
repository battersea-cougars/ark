// When a save is worth asking about (ADR 0122, lib/ClashSheet): a new time, as London instants, or a training's rule.
// Only a day and hours that are new or moved are asked about, so saving a name change over a night already kept
// doesn't ask again.
import { londonISO } from "./dates";
import type { Weekday } from "./recurrence";

export interface ClashWindow {
  startsAt: string;
  endsAt: string;
  /** The thing being edited ("tournament:5"), which can't be over itself. */
  except?: string;
}

/** A training's rule and hours: the Worker works out the nights its save adds or moves, and what's on over them. */
export interface TrainingQuestion {
  /** The training being edited (none: a new one), whose own nights aren't over it. */
  seriesId?: number;
  repeatEvery: number;
  weekdays: Weekday[];
  startsOn: string;
  endsOn: string | null;
  startTime: string;
  endTime: string;
}

export type ClashQuestion = ClashWindow | TrainingQuestion;

/** An end before its start runs past midnight: the next day. */
const span = (startsAt: string, endsAt: string): [string, string] => [
  startsAt,
  Date.parse(endsAt) < Date.parse(startsAt) ? new Date(Date.parse(endsAt) + 86_400_000).toISOString() : endsAt,
];

type When = { heldOn: string; season: unknown; startTime: string; endTime: string };

/** A tournament's day and hours, unless it's only a season so far or its time hasn't moved. */
export function tournamentWindow(t: When & { id: number }, saved?: When): ClashWindow | null {
  if (t.season || !t.heldOn) return null;
  if (
    saved &&
    !saved.season &&
    saved.heldOn === t.heldOn &&
    saved.startTime === t.startTime &&
    saved.endTime === t.endTime
  )
    return null;
  const [startsAt, endsAt] = span(londonISO(t.heldOn, t.startTime), londonISO(t.heldOn, t.endTime));
  return { startsAt, endsAt, except: t.id ? `tournament:${t.id}` : undefined };
}

/** A one-off's times, unless they haven't moved. */
export function eventWindow(
  e: { id?: number; startsAt: string; endsAt: string },
  saved?: { startsAt: string; endsAt: string },
): ClashWindow | null {
  if (saved && saved.startsAt === e.startsAt && saved.endsAt === e.endsAt) return null;
  const [startsAt, endsAt] = span(e.startsAt, e.endsAt);
  return { startsAt, endsAt, except: e.id ? `club_event:${e.id}` : undefined };
}

type Training = Omit<TrainingQuestion, "seriesId"> & { id: number; active: boolean };

/** A training's rule and hours, unless it's paused (it puts nothing on) or its days and hours haven't moved. */
export function trainingQuestion(t: Training, saved?: Training): TrainingQuestion | null {
  if (!t.active || !t.weekdays.length) return null;
  const norm = (x: Training | undefined, k: keyof Training) =>
    JSON.stringify(k === "weekdays" ? [...(x?.weekdays ?? [])].sort() : x?.[k]);
  const same = (k: keyof Training) => norm(t, k) === norm(saved, k);
  if (saved?.active && (["repeatEvery", "weekdays", "startsOn", "endsOn", "startTime", "endTime"] as const).every(same))
    return null;
  const { repeatEvery, weekdays, startsOn, endsOn, startTime, endTime } = t;
  return { seriesId: t.id || undefined, repeatEvery, weekdays, startsOn, endsOn, startTime, endTime };
}
