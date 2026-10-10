// Europe/London formatting. A copy of the website's helpers until dates.ts moves to shared/ (#35);
// projects don't import each other's files (ADR 0006).
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
/** "19:30" (a wall-clock time as stored) to read: "7:30pm" */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** { weekday: "Fri", day: "9", month: "Oct" } for date badges. */
export function dateBadge(iso: string) {
  const p = parts.formatToParts(new Date(iso));
  const get = (type: string) => p.find((x) => x.type === type)!.value;
  return { weekday: get("weekday"), day: get("day"), month: get("month") };
}

export const pounds = (pence: number) =>
  (pence / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0 });

/** The UTC instant of a London wall-clock time on a date: londonISO("2026-10-09", "19:30"). BST-safe. */
export function londonISO(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t: number) => {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
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

/** Today's date in London, "YYYY-MM-DD". */
/** "19:30": the London wall-clock time of an instant, for a time input. */
export const londonTime = (iso: string) => time.format(new Date(iso));
export const londonToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
