// One live page's stream from the club's hub (ADR 0072), kept open while the page is in view: opened through the
// brake, reconnected with a growing wait when it drops, and closed while the page is out of view. The hub says it's
// there every 30 seconds (a `ping` event, and one as the stream opens), so a stream that's gone quiet for a beat and
// a half is a dead one, even when the browser never says so (a phone that changed networks, a proxy holding the
// socket open): it's closed, the page stops saying "Live", and it reconnects and reads what it missed.
//
// No Svelte and no globals: the page's world is handed in (live-updates.svelte.ts), so the tests drive it with a
// fake stream and fake timers.

/** How often the hub pings every open stream (and once as each opens). The hub's beat and the page's watch. */
export const HEARTBEAT_MS = 30_000;
/** Nothing heard for this long, a beat and a half: the stream's dead, though it never said so. */
export const SILENCE_MS = HEARTBEAT_MS * 1.5;
/** Reconnecting after the stream drops: this long, doubling each time, up to five minutes. */
export const FIRST_RETRY_MS = 10_000;
export const MAX_RETRY_MS = 5 * 60_000;

/** As much of an EventSource as a page uses. */
export interface LiveSource {
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  addEventListener(type: string, listener: (e: { data: string }) => void): void;
  close(): void;
}

/** What the stream needs from the page around it. */
export interface StreamWorld {
  /** Open a stream to the hub (`new EventSource("/api/live")`). */
  open(): LiveSource;
  /** Whether the page is in view. */
  visible(): boolean;
  /** Whether the brake lets a connect go out just now, taking it if so (ADR 0055); no: try again later. */
  mayConnect(): boolean;
  /** The stream opened; `catchUp`: it's a reconnect, so read what happened meanwhile. */
  opened(catchUp: boolean): void;
  /** The stream closed (dropped, gone quiet, or the page went out of view). */
  closed(): void;
  /** A `changed` event's data. */
  changed(data: string): void;
}

/**
 * Keep a stream open for a page. `visibilityChanged` on the document's visibilitychange; `stop` when the page goes.
 */
export function keepStream(world: StreamWorld) {
  let source: LiveSource | null = null;
  /** Whether `source` has opened: only a stream that opened is one to say has closed. */
  let isOpen = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let silence: ReturnType<typeof setTimeout> | undefined;
  let wait = FIRST_RETRY_MS;
  let stopped = false;

  /** Heard from the hub: the stream's alive for another beat and a half. */
  const heard = () => {
    clearTimeout(silence);
    silence = setTimeout(() => drop(true), SILENCE_MS);
  };

  /** Open the stream, if the page's in view and the brake allows; `catchUp` reads what happened meanwhile. */
  const connect = (catchUp: boolean) => {
    clearTimeout(retry);
    if (stopped || source || !world.visible()) return;
    if (!world.mayConnect()) return later();
    const es = world.open();
    source = es;
    es.onopen = () => {
      wait = FIRST_RETRY_MS;
      isOpen = true;
      heard();
      world.opened(catchUp);
    };
    es.addEventListener("ping", heard);
    es.addEventListener("changed", (e) => {
      heard();
      world.changed(e.data);
    });
    // Dropped, refused (a server without a hub answers 503), or the day's allowance is spent: the browser would try
    // again in a few seconds forever; the page waits longer each time, and checks on the admins' beat meanwhile
    es.onerror = () => drop(true);
    // Never opens, never errs (a proxy that holds the request): as dead as one that's gone quiet
    heard();
  };
  const drop = (andRetry: boolean) => {
    clearTimeout(silence);
    if (!source) return;
    source.close();
    source = null;
    if (isOpen) world.closed();
    isOpen = false;
    if (andRetry) later();
  };
  const later = () => {
    clearTimeout(retry);
    retry = setTimeout(() => connect(true), wait);
    wait = Math.min(wait * 2, MAX_RETRY_MS);
  };

  connect(false);
  return {
    // Out of view: the stream closes (nothing to show, and the hub's time isn't spent on it). Back in view: it
    // reopens; what happened meanwhile is read by the app itself (backend.svelte.ts)
    visibilityChanged() {
      if (world.visible()) connect(false);
      else drop(false);
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      drop(false);
    },
  };
}
