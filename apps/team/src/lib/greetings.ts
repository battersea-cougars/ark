// Home's title: which greeting set to use, and filling one in. The lines are quips (lib/quips.ts), so admins edit
// them in Settings → Quips. A set is picked by the time of day in London, a training night, or too many looks today.
import type { GreetingKind } from "./quips";

/** From this many visits in a day, Home nags instead. */
export const NAG_FROM = 4;

const hourFormat = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" });

/** Which set to greet from: too many visits wins, then late at night, then a training night, then the hour. */
export function slot(now: Date, trainingToday: boolean, visitsToday = 1): GreetingKind {
  const hour = Number(hourFormat.format(now));
  if (visitsToday >= NAG_FROM) return "nag";
  if (hour >= 23 || hour < 5) return "late";
  if (trainingToday) return "training";
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10];
  return `${n}${suffix ?? "th"}`;
}

/** Fill in a greeting: `{name}` is the first name, `{nth}` today's visit ("45th"), `{day}` the training's day. */
export function fill(line: string, values: { name: string; visits: number; day: string }): string {
  const nth = ordinal(values.visits);
  return line
    .replaceAll("{name}", () => values.name)
    .replaceAll("{nth}", () => nth)
    .replaceAll("{day}", () => values.day);
}
