// Europe/London dates, money and numbers for members to read: the team app's own words and formats, the one copy of
// each (#153; scripts/team-one-home.test.mjs fails on a date formatted in a component, an ordinal or plural by hand).
// The conversions (London's date today, a wall-clock time's instant, the evening) are the one shared copy in
// @cougars/shared/london (#35), passed on here so the app's pages import their dates from one place.
export { londonEvening, londonISO, londonTime, londonToday } from "@cougars/shared/london";
const TZ = "Europe/London";
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });

const dayDate = fmt({ weekday: "short", day: "numeric", month: "short" });
const time = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
const parts = fmt({ day: "numeric", month: "short", weekday: "short" });

/** "Fri 9 Oct" */
export const formatDayDate = (iso: string) =>
  dayDate
    .formatToParts(new Date(iso))
    .filter((p) => p.type !== "literal")
    .map((p) => p.value)
    .join(" ");
/** "7:30pm", "7pm": a London time to read. 12-hour for everyone until members can choose (#94). */
export const formatTime = (iso: string) => clock(time.format(new Date(iso)));
/** "19:05": a London time on the 24-hour clock, for a time stamp on an admin's screen (Usage, the app's brake). */
export const londonClock = (when: string | number) => time.format(new Date(when));
const stamp = fmt({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** "Fri 23 Oct, 14:05": when something happened, to the minute, in London (the last backup). */
export const formatStamp = (iso: string) => stamp.format(new Date(iso));
/** "19:30" (a wall-clock time as stored) to read: "7:30pm" */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** Two wall-clock times as a span: "7:30 to 9:30pm" (am/pm said once when they share it), "11am to 2:30pm". */
export function clockRange(from: string, to: string): string {
  const a = clock(from);
  const b = clock(to);
  if (a === b) return a;
  const same = a.slice(-2) === b.slice(-2);
  return `${same ? a.slice(0, -2) : a} to ${b}`;
}
/** The same for two instants, in London time. */
export const timeRange = (fromIso: string, toIso: string) =>
  clockRange(time.format(new Date(fromIso)), time.format(new Date(toIso)));

/** A calendar day as stored ("2026-10-23", no time, no zone) in words: `dayWords(day, { weekday: "short" })` is "Fri".
 * Read at its noon, so no clock change or zone moves it to the day before or after. */
export const dayWords = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

/** { weekday: "Fri", day: "9", month: "Oct" } for date badges. */
export function dateBadge(iso: string) {
  const p = parts.formatToParts(new Date(iso));
  const get = (type: string) => p.find((x) => x.type === type)!.value;
  return { weekday: get("weekday"), day: get("day"), month: get("month") };
}

/** Money: whole pounds short ("£10"), anything with pence in both digits of them ("£10.50", never "£10.5"). */
export const pounds = (pence: number) =>
  (pence / 100).toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: pence % 100 ? 2 : 0,
  });

// Numbers in words, the one copy (#153), beside the dates and money they're read with: ordinals ("21st", never "21th")
// and counts with their noun. Plain functions, for the app and the Worker.

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 101st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10];
  return `${n}${suffix ?? "th"}`;
}

/** A count and its noun: "1 goal", "3 goals", "2 matches" (`many` for the irregular ones). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
