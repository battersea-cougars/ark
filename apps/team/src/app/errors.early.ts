// The app's errors from its first moment (ADR 0111): Sentry loads beside the club's data, off the first-paint path
// (errors.ts, ADR 0120), so anything that goes wrong before it's ready (the start-up failing, an error thrown while
// Home mounts) waits here and is handed to it once it starts. Tiny and with no imports, so it costs Home nothing; it
// is main.ts's first import, so it listens before the rest of the app runs. A build without a DSN keeps nothing.

/**
 * How it went wrong: thrown and caught by nobody, a promise nobody caught, the start-up that failed, or something the
 * app caught and carried on past (reportCaught).
 */
export type How = "onerror" | "onunhandledrejection" | "start" | "caught";
export type Sink = (error: unknown, how: How) => void;

/** At most this many wait: a loop that throws before Sentry is up shouldn't fill the phone. */
const MAX = 20;
const waiting: { error: unknown; how: How }[] = [];
let sink: Sink | null = null;

/** An error to report: to Sentry if it's up, else kept until it is. */
export function reportEarly(error: unknown, how: How) {
  if (sink) sink(error, how);
  else if (waiting.length < MAX) waiting.push({ error, how });
}

/**
 * A failure the app caught and carried on past, where carrying on hides it (the clash question it couldn't ask, so
 * the save went ahead unasked): to Sentry, and on your machine to the console too, which the dev strip shows
 * (dev-errors.ts), so it isn't invisible. `what` says what the app was doing.
 */
export function reportCaught(error: unknown, what: string) {
  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.error(`${what}:`, error);
  reportEarly(error, "caught");
}

/** Sentry is up: it gets what waited, then everything reported here. Its own handlers take uncaught errors from now. */
export function handOff(to: Sink) {
  sink = to;
  for (const { error, how } of waiting.splice(0)) to(error, how);
}

/** Listens from the very start, until Sentry takes over; nothing at all in a build without a DSN (your machine). */
export function listenEarly(target: Pick<Window, "addEventListener"> = window) {
  target.addEventListener("error", (e) => {
    if (!sink) reportEarly(e.error ?? e.message, "onerror");
  });
  target.addEventListener("unhandledrejection", (e) => {
    if (!sink) reportEarly(e.reason, "onunhandledrejection");
  });
}

if (import.meta.env.VITE_SENTRY_DSN && typeof window !== "undefined") listenEarly();
