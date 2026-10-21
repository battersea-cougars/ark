// London wall-clock dates and times, for code shared by the website and the team app (the agenda). Each app keeps
// its own formatting helpers; these are the two conversions both sides store.
const TZ = "Europe/London";

const dayParts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The London date of a moment: "2026-10-09", put together from its parts. Never a locale's own order: en-CA reads
 * 2026-10-09 in Chrome but 10/21/2026 in Safari's WebKit, which once broke Home on iPhones.
 */
export function londonDate(at: Date | number = new Date()): string {
  const p = Object.fromEntries(dayParts.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** The London date of an instant: "2026-10-09". */
export const londonDay = (iso: string) => londonDate(new Date(iso));

/** The UTC instant of a London wall-clock time on a date: londonISO("2026-10-09", "19:30"). BST-safe. */
export function londonISO(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // London's offset at that moment, from what the clock there reads
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(t)
        .map((x) => [x.type, Number(x.value)]),
    );
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t;
  };
  return new Date(guess - offset(guess)).toISOString();
}
