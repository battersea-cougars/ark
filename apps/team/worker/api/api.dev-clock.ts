// The club's clock moved for the journeys (ADR 0031): a request may say what time it is (`x-dev-now`), and the API
// reckons the day and what's open by it, as if it were then.
import { simulatorHere } from "../tournaments/simulate";

export const DEV_NOW_HEADER = "x-dev-now";

/** A whole time in UTC, as `Date.toISOString` writes it (seconds and milliseconds optional): nothing looser. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/**
 * The time a request asked to be at, where it may ask and from someone who may (`actions`, theirs); otherwise null
 * (the real clock). Only where the simulator is: simulatorHere fails closed, so production never reads the header. On
 * dev only an admin (manage:all), since dev's D1 is the whole club and a moved day writes by it; on your own machine
 * anyone, as the journeys move each person they play. Signing in keeps the real clock.
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
