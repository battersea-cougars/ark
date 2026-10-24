// Live pages follow along (ADR 0072): a game being scored, the tournament's home while a game's on, the draft room
// while it's open. The page holds one stream from the club's live hub, which says which parts of the club changed
// the moment they do (a live match comes with it, #161); the app then reads just those parts (one read at a time, after a short random wait, so a burst
// is one read: app/catch-up.ts, #112). The stream itself, and the hub's heartbeat that tells a dead one from a quiet
// one, are lib/live-stream.ts. While the stream's open the page still checks every minute, as a safety net
// (a 304 when the copy has every change); when it's down (a dropped connection, a server
// without a hub), it checks on the admins' beat instead (ADR 0072), and says so. Only while the page is in view; the
// brake (ADR 0055) still has the last word: a connect is one of the tab's calls, and nothing goes out while it rests.
import { brake } from "../app/api";
import { reportUnexpected } from "../app/errors.early";
import { checked, copy, refreshIfChanged } from "../app/backend.svelte";
import type { Heard } from "../app/catch-up";
import { db } from "../demo/store.svelte";
import { keepStream } from "./live-stream";

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

/** The club read this recently (the app just opened): a page opening now doesn't check again. */
const FRESH_MS = 10_000;

let streams = 0;

/**
 * What an event says changed: the parts, the versions that changed them, and a live match sent along (#161). Not what the hub sends means everything
 * followed, with no versions, which only a check of the whole club can settle (a 304 when nothing has changed).
 */
function whatChanged(data: string, follow: readonly string[]): Pick<Heard, "changed"> & Partial<Heard> {
  try {
    const { changed = [], versions, parts } = JSON.parse(data);
    return { changed, versions, parts };
  } catch {
    return { changed: [...follow] };
  }
}

/**
 * Follow the club's changes while the page is in view: the hub's stream for the parts named, and a check on a beat.
 * Call in an effect (it follows the setting), and return what it returns. `steady`: a page everyone sits on (Home,
 * a training's sign-ups) checks once a minute when there's no stream, not on the admins' live beat, so a dropped
 * stream across the whole club doesn't spend the day's requests.
 */
export function checkForUpdates(follow: readonly string[] = ["tournaments"], { steady = false } = {}) {
  let beat: ReturnType<typeof setInterval> | undefined;
  let streaming = false;

  const check = () => {
    // Offline or refused: the next beat tries again. Anything else leaves the page stale unseen, so Sentry hears of it
    if (document.visibilityState === "visible")
      refreshIfChanged().catch((e) => reportUnexpected(e, "Couldn't check for the club's changes"));
  };
  const onBeat = () => {
    clearInterval(beat);
    beat = setInterval(check, streaming || steady ? SAFETY_MS : liveRefreshSeconds() * 1000);
  };
  const opened = (on: boolean) => {
    streaming = on;
    streams += on ? 1 : -1;
    liveFeed.on = streams > 0;
    onBeat();
  };

  const unfollow = copy.follow(follow);
  // Opened just after the app read the club (Home, as the app opens): nothing to check yet (ADR 0120)
  if (Date.now() - checked.at > FRESH_MS) check();
  const stream = keepStream({
    open: () => new EventSource("/api/live"),
    visible: () => document.visibilityState === "visible",
    mayConnect: () => brake.mayCheck() && !brake.take(),
    opened: (catchUp) => {
      opened(true);
      if (catchUp) check();
    },
    closed: () => opened(false),
    // The app's copy reads what it lacks, if this page (or another open) follows any of it
    changed: (data) => copy.hear(whatChanged(data, follow)),
  });
  const onVisible = () => stream.visibilityChanged();
  document.addEventListener("visibilitychange", onVisible);
  onBeat();
  return () => {
    unfollow();
    document.removeEventListener("visibilitychange", onVisible);
    stream.stop();
    clearInterval(beat);
  };
}
