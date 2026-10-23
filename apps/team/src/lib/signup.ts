// When a tournament takes sign-ups (ADR 0074), shared by the app and the Worker: once an admin opens it by hand, or
// from the day it's set to open, until the end of its closing day (London) or an admin closes it sooner (its own
// record, signupClosedAt, so its dates stay as they were). And a training night's (below).
import { addDays } from "./recurrence";

interface SigningUp {
  status: string;
  signupOpensOn: string | null;
  signupClosesOn: string | null;
  /** When an admin closed it early (Close sign-up); null or left out: they haven't. */
  signupClosedAt?: string | null;
}

/** Sign-up is open on `today` (a London YYYY-MM-DD). */
export const signupOpen = (t: SigningUp, today: string) =>
  !signupOver(t, today) &&
  (t.status === "open" || (t.status === "planned" && !!t.signupOpensOn && today >= t.signupOpensOn));

/** Over: an admin closed it, or it's past its closing day. */
export const signupOver = (t: Pick<SigningUp, "signupClosesOn" | "signupClosedAt">, today: string) =>
  !!t.signupClosedAt || (!!t.signupClosesOn && today > t.signupClosesOn);

// A training night's sign-up (ADR 0030): a training may say its nights open a number of days before, at midnight
// London time (Friday Training: 4, the Monday); null is always open. The register and admins put people in whenever.

/** The London day a night's sign-up opens, `days` before it; null: always open. */
export const nightOpensOn = (heldOn: string, days: number | null | undefined) =>
  days == null ? null : addDays(heldOn, -days);

/** A night takes members' sign-ups on `today` (a London YYYY-MM-DD). */
export const nightOpen = (heldOn: string, days: number | null | undefined, today: string) => {
  const opens = nightOpensOn(heldOn, days);
  return !opens || today >= opens;
};

const weekday = (day: string, style: "long" | "short") =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: style, timeZone: "UTC" });
const dayMonth = (day: string, style: "long" | "short") =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: style, timeZone: "UTC" });

/** When it opens, in words: the weekday within the week ("Monday"), else with its date ("Monday 19 October");
 * `short` for a button ("Mon", "Mon 19 Oct"). */
export function opensWords(opensOn: string, today: string, short = false) {
  const style = short ? "short" : "long";
  return addDays(today, 6) >= opensOn
    ? weekday(opensOn, style)
    : `${weekday(opensOn, style)} ${dayMonth(opensOn, style)}`;
}
