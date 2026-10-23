// The club's clock moved, for the journeys (ADR 0124): a request may say what time it is (`x-dev-now`, an ISO time),
// and the API reckons the day, the evening and what's open by it, as if it were then. Only where the simulator is
// (dev, your own machine: simulatorHere fails closed, so production never reads the header), and on dev only for an
// admin (manage:all): dev's D1 is the whole club, and a moved day writes charges, sessions and the record by it. On
// your own machine anyone may, as the journeys move each person they play. Who's signed in, and signing in, keep the
// real clock: a session isn't expired or renewed by a journey's day.
import { simulatorHere } from "../tournaments/simulate";

export const DEV_NOW_HEADER = "x-dev-now";

/** A whole time in UTC, as `Date.toISOString` writes it (seconds and milliseconds optional): nothing looser. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/**
 * The time a request asked to be at, where it may ask and from someone who may (`actions`, theirs); otherwise null
 * (the real clock).
 */
export function devClock(
  request: Request,
  env: { SITE_ENV?: string; TEAM_ENV?: string },
  actions: ReadonlySet<string>,
): Date | null {
  const asked = request.headers.get(DEV_NOW_HEADER);
  if (!asked || !simulatorHere(env) || !ISO_UTC.test(asked)) return null;
  const ownMachine = env.TEAM_ENV === "local" && env.SITE_ENV === undefined;
  if (!ownMachine && !actions.has("manage:all")) return null;
  const at = Date.parse(asked);
  return Number.isNaN(at) ? null : new Date(at);
}
