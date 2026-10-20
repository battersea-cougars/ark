// The next weekly session and what the home page's scoreboard says about it ("FACE-OFF IN 2D 04H", "PLAYING NOW").
// Pure, so it's tested at any moment; the times are London's (lib/dates.ts), whatever the visitor's clock is set to.
// Browser and server both use it: no Astro or Worker imports.
import { londonDay, londonISO } from "./dates";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY = 24 * 60 * 60_000;

export interface Session {
  startsAt: string;
  endsAt: string;
}

/** The session on now, or the next one: the weekly slot ("Friday", "19:30", "21:30") from `now`. */
export function nextSession(day: string, start: string, end: string, now = Date.now()): Session | null {
  const weekday = DAYS.indexOf(day);
  if (weekday < 0) return null;
  // London's today, at noon UTC so stepping a day at a time never lands on the wrong date around the clock change
  const today = Date.parse(`${londonDay(new Date(now).toISOString())}T12:00:00Z`);
  for (let n = 0; n <= 7; n++) {
    const date = new Date(today + n * DAY);
    if (date.getUTCDay() !== weekday) continue;
    const ymd = date.toISOString().slice(0, 10);
    const session = { startsAt: londonISO(ymd, start), endsAt: londonISO(ymd, end) };
    if (now < Date.parse(session.endsAt)) return session;
  }
  return null;
}

const two = (n: number) => String(n).padStart(2, "0");

/** The scoreboard line: days and hours, then minutes, then a ticking clock in the last hour; during it, till when. */
export function scoreboard(session: Session, now = Date.now()): string {
  const start = Date.parse(session.startsAt);
  if (now >= start) {
    const till = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(session.endsAt));
    return `Playing now · till ${till}`;
  }
  const s = Math.ceil((start - now) / 1000);
  const [d, h, m] = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60)];
  if (d > 0) return `Face-off in ${d}d ${two(h)}h`;
  if (h > 0) return `Face-off in ${h}h ${two(m)}m`;
  return `Face-off in ${two(m)}:${two(s % 60)}`;
}
