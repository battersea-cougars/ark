// The calendar's running order, a month at a time (pages/Calendar): each month once, in its year, as London has it.
import { londonToday } from "./dates";

const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Europe/London" });

/**
 * What's on, grouped by month in the order it comes (already sorted by when it starts): each group keyed by its year
 * and month ("2027-10"), so October this year and next are two groups (#165), and named by the month, with its year
 * when it isn't this year's ("October", "October 2027").
 */
export function byMonth<T extends { startsAt: string }>(items: T[], today = londonToday()) {
  const out: { key: string; label: string; events: T[] }[] = [];
  for (const e of items) {
    const key = londonToday(new Date(e.startsAt)).slice(0, 7);
    const last = out.at(-1);
    if (last?.key === key) {
      last.events.push(e);
      continue;
    }
    const name = monthName.format(new Date(e.startsAt));
    out.push({ key, label: key.startsWith(today.slice(0, 4)) ? name : `${name} ${key.slice(0, 4)}`, events: [e] });
  }
  return out;
}
