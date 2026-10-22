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

// ─── Answering the sheet (lib/ClashSheet) ───

/** A row's answer: call it off, keep both, or (it stays on) skip the training being saved that night. */
export type Answer = "" | "cancel" | "keep" | "skip";
type Row = { key: string; canCancel: boolean; nights?: string[] };

/**
 * What a row asks: "cancel" (Cancel it / Keep both) if the admin can call it off here, "skip" (Skip the training that
 * night / Keep both) if it stays on and a training is being saved over it, or nothing to choose.
 */
export function choiceOf(c: Row, training: boolean): "cancel" | "skip" | null {
  if (c.canCancel) return "cancel";
  return training && c.nights?.length ? "skip" : null;
}

/** The answer for all of those that can be called off: theirs if they all agree, none if not. */
export function answerOfAll(rows: Row[], picks: Record<string, Answer>): "" | "cancel" | "keep" {
  const own = rows.filter((c) => c.canCancel).map((c) => picks[c.key] ?? "");
  return own.length && own.every((p) => p === own[0]) && (own[0] === "cancel" || own[0] === "keep") ? own[0] : "";
}

/** One answer for all: every row that can be called off set to it; a skip is left as it is. */
export function answerAll(rows: Row[], picks: Record<string, Answer>, to: "cancel" | "keep") {
  return { ...picks, ...Object.fromEntries(rows.filter((c) => c.canCancel).map((c) => [c.key, to])) };
}

/** The days of the training's own nights to call off: those over something kept on that the admin chose to skip. */
export function nightsToSkip(rows: Row[], picks: Record<string, Answer>) {
  const days = rows.filter((c) => picks[c.key] === "skip").flatMap((c) => c.nights ?? []);
  return [...new Set(days)].sort();
}

/** "Skip Juniors that night", short enough to sit beside Keep both (lib/Choice keeps a row to 40 letters). */
export function skipLabel(name: string) {
  const label = `Skip ${name.trim()} that night`;
  return name.trim() && label.length + "Keep both".length <= 40 ? label : "Skip training that night";
}
