// When the push outbox sends, and how much at a time (ADR 0108): every number it goes by, in one place. Change one
// here and the outbox, its tests and the cron follow; ADR 0108 says why each is what it is.
import { londonDate, londonISO } from "@cougars/shared/london";

/**
 * Quiet hours, London's wall clock (so across the clock changes): a notification that isn't about something happening
 * now (`Notice.live`) and comes in this window waits for its end. `from` after `until` wraps midnight.
 */
export const QUIET_HOURS = { from: "22:00", until: "08:00" } as const;

/**
 * The debounce: a member told something about one thing (a `Notice.key`: their place on a night, their team) isn't
 * told about it again for this long. What comes in that time waits out the rest, each newer one replacing it (the
 * latest wins), and if it ends where they were last told, it isn't sent at all.
 */
export const DEBOUNCE_MINUTES = 2;

// Workers Free allows 50 subrequests (fetches) an invocation, and FCM takes one request per phone, Web Push one per
// browser. A send is at most SEND_AT_ONCE devices: with Google's access token (one fetch, once an hour per Worker
// instance), the live hub and whatever else the request or cron run fetches (a Sentry report), that leaves about ten
// to spare. The rest wait in push_outbox for the cron (index.ts `scheduled`).
export const SEND_AT_ONCE = 40;
/**
 * A five-minute cron run sends fewer: the same invocation also sends dues reminders (an email each, REMINDERS.perRun)
 * and asks for a website rebuild, and all of it shares the 50 (docs/load-testing.md has the sums). The run every
 * minute between them does nothing else, so it sends SEND_AT_ONCE.
 */
export const DRAIN_AT_ONCE = 25;
/** Tries a notification gets before it's given up: again after 5, 10 and 20 minutes. */
export const PUSH_TRIES = 4;
export const RETRY_AFTER_MINUTES = 5;
/** A claim this old was a send that died before it finished: its rows are taken again. */
export const CLAIM_EXPIRES_MINUTES = 10;
/** Sent (or dropped) notifications, and what each member was last told, are kept this long, then pruned. */
export const KEEP_DAYS = 7;
export const PRUNE_AT_ONCE = 500;

/** London's wall clock, "HH:MM", 00:00 to 23:59. */
const london = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * When quiet hours end, if `now` is inside them (London): the next `until` (08:00), as an instant; otherwise null.
 * London's clock decides, so the night the clocks go back 08:00 is 08:00 GMT, and the night they go forward 08:00 BST.
 */
export function quietUntil(now: Date): Date | null {
  const { from, until } = QUIET_HOURS;
  const clock = london.format(now);
  const day = londonDate(now);
  const wraps = from > until;
  const quiet = wraps ? clock >= from || clock < until : clock >= from && clock < until;
  if (!quiet) return null;
  // Past midnight (or a window within one day) it ends today; before midnight, tomorrow
  const endsOn = wraps && clock >= from ? nextDay(day) : day;
  return new Date(londonISO(endsOn, until));
}
