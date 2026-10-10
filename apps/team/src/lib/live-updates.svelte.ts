// Live pages follow along (ADR 0072): a game being scored, the tournament's home while a game's on, the draft room
// while it's open. The page holds one stream from the club's live hub, which says which parts of the club changed
// the moment they do; the page then reads its own view (one request, a 304 when it already has it). While the
// stream's open the page still checks every minute, as a safety net; when it's down (a dropped connection, a server
// without a hub), it checks on the admins' beat instead (ADR 0072), and says so. Only while the page is in view; the
// brake (ADR 0055) still has the last word: a connect is one of the tab's calls, and nothing goes out while it rests.
import { brake } from "../app/api";
import { refreshIfChanged } from "../app/backend.svelte";
import { db } from "../demo/store.svelte";

/** Seconds between checks, as the admins set it: the pace when there's no stream. */
export const liveRefreshSeconds = () => db.settings.liveRefreshSeconds;

/** As a page says it: "every 10 seconds". */
export const everyHowOften = () => {
  const s = liveRefreshSeconds();
  return s % 60 === 0 ? `every ${s === 60 ? "minute" : `${s / 60} minutes`}` : `every ${s} seconds`;
};

/** Whether a stream is open just now: pages say "Live", or how often they check. */
export const liveFeed = $state({ on: false });

/** While the stream's open, a check this often anyway. */
const SAFETY_MS = 60_000;
/** Reconnecting after the stream drops: this long, doubling each time, up to five minutes. */
const FIRST_RETRY_MS = 10_000;
const MAX_RETRY_MS = 5 * 60_000;

let streams = 0;

/** The parts an event names; not what the hub sends means everything followed, as a check costs one request. */
function whatChanged(data: string, follow: readonly string[]): string[] {
  try {
    return JSON.parse(data).changed ?? [];
  } catch {
    return [...follow];
  }
}

/**
 * Follow the club's changes while the page is in view: the hub's stream for the parts named, and a check on a beat.
 * Call in an effect (it follows the setting), and return what it returns. `steady`: a page everyone sits on (Home,
 * a training's sign-ups) checks once a minute when there's no stream, not on the admins' live beat, so a dropped
 * stream across the whole club doesn't spend the day's requests.
 */
export function checkForUpdates(follow: readonly string[] = ["tournaments"], { steady = false } = {}) {
  let source: EventSource | null = null;
  let beat: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let wait = FIRST_RETRY_MS;
  let stopped = false;

  const check = () => {
    if (document.visibilityState === "visible") refreshIfChanged().catch(() => {});
  };
  const onBeat = () => {
    clearInterval(beat);
    beat = setInterval(check, source || steady ? SAFETY_MS : liveRefreshSeconds() * 1000);
  };
  const opened = (on: boolean) => {
    streams += on ? 1 : -1;
    liveFeed.on = streams > 0;
  };

  /** Open the stream, if the page's in view and the brake allows; `catchUp` reads what happened meanwhile. */
  const connect = (catchUp: boolean) => {
    clearTimeout(retry);
    if (stopped || source || document.visibilityState !== "visible") return;
    if (!brake.mayCheck() || brake.take()) return later();
    const es = new EventSource("/api/live");
    source = es;
    es.onopen = () => {
      wait = FIRST_RETRY_MS;
      opened(true);
      onBeat();
      if (catchUp) check();
    };
    es.addEventListener("changed", (e: MessageEvent<string>) => {
      if (whatChanged(e.data, follow).some((s) => follow.includes(s))) check();
    });
    // Dropped, refused (a server without a hub answers 503), or the day's allowance is spent: the browser would try
    // again in a few seconds forever; the app waits longer each time, and checks on the admins' beat meanwhile
    es.onerror = () => drop(true);
  };
  const drop = (andRetry: boolean) => {
    if (!source) return;
    source.close();
    source = null;
    opened(false);
    onBeat();
    if (andRetry) later();
  };
  const later = () => {
    clearTimeout(retry);
    retry = setTimeout(() => connect(true), wait);
    wait = Math.min(wait * 2, MAX_RETRY_MS);
  };
  // Out of view: the stream closes (nothing to show, and the hub's time isn't spent on it). Back in view: it reopens;
  // what happened meanwhile is read by the app itself (backend.svelte.ts)
  const onVisible = () => {
    if (document.visibilityState === "visible") connect(false);
    else drop(false);
  };

  document.addEventListener("visibilitychange", onVisible);
  check();
  onBeat();
  connect(false);
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(beat);
    clearTimeout(retry);
    drop(false);
  };
}
