// London's dates and times as data, the one copy the website, the team app and its Worker all use (#35): which day
// it is in London, the instant of a London wall-clock time, and the evening a moment belongs to. Words people read
// ("Fri 9 Oct", "7:30pm") stay in each app's own lib/dates.ts.
const TZ = "Europe/London";

const dayParts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const clockParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const wallClock = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * The London date of a moment: "2026-10-09", put together from its parts. Never a locale's own order: en-CA reads
 * 2026-10-09 in Chrome but 10/21/2026 in Safari's WebKit, which once broke Home on iPhones.
 */
export function londonDate(at: Date | number = new Date()): string {
  const p = Object.fromEntries(dayParts.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** The London date of an instant: "2026-10-09", like a Sanity `date` field. */
export const londonDay = (iso: string) => londonDate(new Date(iso));

/** Today's date in London, "YYYY-MM-DD". */
export const londonToday = (now = new Date()) => londonDate(now);

/** "19:30": the London wall-clock time of an instant, for a time input or to compare with a stored time. */
export const londonTime = (iso: string) => wallClock.format(new Date(iso));

/** London's offset from UTC at an instant, in ms, from what the clock there reads. */
function offsetAt(t: number): number {
  const p = Object.fromEntries(clockParts.formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t;
}

/** The UTC instant of a London wall-clock time on a date: londonISO("2026-10-09", "19:30"). BST-safe. */
export function londonISO(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(guess - offsetAt(guess)).toISOString();
}

/**
 * The evening a moment belongs to, as London's date (ADR 0074): from 06:00 it's that day's; before 06:00 it's still
 * the night before's, so a Kumite's after-party runs past midnight till the morning.
 */
export function londonEvening(now = new Date()): string {
  const day = londonDate(now);
  if (now.getTime() >= Date.parse(londonISO(day, "06:00"))) return day;
  return new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
