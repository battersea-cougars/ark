// The club is in London: always format in Europe/London, whatever the build
// machine's timezone is.
const TZ = "Europe/London";

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });

const dayDate = fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const shortDay = fmt({ weekday: "short", day: "numeric", month: "short" });
const longDate = fmt({ day: "numeric", month: "long", year: "numeric" });
const time = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
const parts = fmt({ day: "numeric", month: "short" });
// en-CA formats dates as YYYY-MM-DD
const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const formatDate = (iso: string) => longDate.format(new Date(iso));
/** "Fri 4 Dec 2026" (Intl puts a comma after the weekday; we drop it). */
export const formatDayDate = (iso: string) =>
  dayDate
    .formatToParts(new Date(iso))
    .filter((p) => p.type !== "literal")
    .map((p) => p.value)
    .join(" ");
/** "Fri 4 Dec", for lists of what's coming up, where the year goes without saying. */
export const formatShortDay = (iso: string) =>
  shortDay
    .formatToParts(new Date(iso))
    .filter((p) => p.type !== "literal")
    .map((p) => p.value)
    .join(" ");
export const formatTime = (iso: string) => time.format(new Date(iso));
const weekday = fmt({ weekday: "short" });
/** "Fri": a weekly thing's day ("Every Fri"). */
export const formatWeekday = (iso: string) => weekday.format(new Date(iso));

/** { day: "14", month: "Nov" } for calendar-style date badges. */
export function dateBadge(iso: string) {
  const p = parts.formatToParts(new Date(iso));
  return { day: p.find((x) => x.type === "day")!.value, month: p.find((x) => x.type === "month")!.value };
}

export function formatRange(startIso: string, endIso?: string | null) {
  const start = `${formatDayDate(startIso)} · ${formatTime(startIso)}`;
  if (!endIso) return start;
  const sameDay = formatDayDate(startIso) === formatDayDate(endIso);
  return sameDay ? `${start} to ${formatTime(endIso)}` : `${start} to ${formatDayDate(endIso)} · ${formatTime(endIso)}`;
}

/** "2026-10-02": the calendar day in London, like a Sanity `date` field. */
export const londonDay = (iso: string) => isoDay.format(new Date(iso));

/** The UTC instant of a London wall-clock time on a date: londonISO("2026-10-09", "19:30"). BST-safe. */
export function londonISO(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // London's offset at that moment, from what the clock there reads
  const offset = (t: number) => {
    const p = fmt({
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(t));
    const get = (type: string) => Number(p.find((x) => x.type === type)!.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - t;
  };
  return new Date(guess - offset(guess)).toISOString();
}
