// A live page's stream (ADR 0072) against a fake hub, with fake timers: the hub's ping keeps "Live" on, and a stream
// that's gone quiet for a beat and a half (a phone that changed networks, a proxy holding the socket) is closed and
// reconnected, reading what it missed, instead of saying "Live" for minutes after updates stopped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_RETRY_MS, HEARTBEAT_MS, keepStream, SILENCE_MS, type LiveSource } from "./live-stream";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

/** A stream to the hub, as a page's EventSource: the test opens it, pings it, or lets it go quiet. */
class FakeSource implements LiveSource {
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((e: { data: string }) => void)[]>();
  addEventListener(type: string, listener: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  opens() {
    this.onopen?.(new Event("open"));
  }
  sends(type: "ping" | "changed", data = "{}") {
    for (const l of this.listeners.get(type) ?? []) l({ data });
  }
}

/** A page following the club: whether it says "Live", what it caught up on, and every stream it opened. */
function page() {
  const sources: FakeSource[] = [];
  const seen = { live: false, caughtUp: 0, closes: 0, changes: [] as string[], visible: true };
  const stream = keepStream({
    open: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    visible: () => seen.visible,
    mayConnect: () => true,
    opened: (catchUp) => {
      seen.live = true;
      if (catchUp) seen.caughtUp++;
    },
    closed: () => {
      seen.live = false;
      seen.closes++;
    },
    changed: (data) => void seen.changes.push(data),
  });
  const latest = () => sources[sources.length - 1];
  return { seen, sources, latest, stream };
}

describe("a live page's stream", () => {
  it("says Live once the stream opens", () => {
    const p = page();
    expect(p.seen.live).toBe(false);
    p.latest().opens();
    p.latest().sends("ping");
    expect(p.seen.live).toBe(true);
    p.stream.stop();
  });

  it("stays Live for as long as the hub pings, however quiet the club", async () => {
    const p = page();
    p.latest().opens();
    p.latest().sends("ping");
    for (let beat = 0; beat < 10; beat++) {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      p.latest().sends("ping");
    }
    expect(p.seen.live).toBe(true);
    expect(p.sources).toHaveLength(1);
    p.stream.stop();
  });

  it("a change counts as hearing from the hub, and is passed on", async () => {
    const p = page();
    p.latest().opens();
    await vi.advanceTimersByTimeAsync(SILENCE_MS - 1);
    p.latest().sends("changed", '{"changed":["sessions"]}');
    await vi.advanceTimersByTimeAsync(SILENCE_MS - 1);
    expect(p.seen.live).toBe(true);
    expect(p.seen.changes).toEqual(['{"changed":["sessions"]}']);
    p.stream.stop();
  });

  it("gone quiet for a beat and a half: not Live, closed, and reconnecting after the usual wait", async () => {
    const p = page();
    p.latest().opens();
    p.latest().sends("ping");
    await vi.advanceTimersByTimeAsync(SILENCE_MS - 1);
    expect(p.seen.live).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.seen.live).toBe(false);
    expect(p.sources[0].closed).toBe(true);
    expect(p.sources).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS);
    expect(p.sources).toHaveLength(2);
    p.stream.stop();
  });

  it("back to Live when the new stream opens and pings, reading what it missed", async () => {
    const p = page();
    p.latest().opens();
    await vi.advanceTimersByTimeAsync(SILENCE_MS + FIRST_RETRY_MS);
    expect(p.seen.live).toBe(false);
    p.latest().opens();
    p.latest().sends("ping");
    expect(p.seen.live).toBe(true);
    expect(p.seen.caughtUp).toBe(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    p.latest().sends("ping");
    expect(p.seen.live).toBe(true);
    p.stream.stop();
  });

  it("a stream that never opens is given up on the same way", async () => {
    const p = page();
    await vi.advanceTimersByTimeAsync(SILENCE_MS);
    expect(p.sources[0].closed).toBe(true);
    // It never said it was open, so it never says it's closed: the app's count of open streams stays true
    expect(p.seen.closes).toBe(0);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS);
    expect(p.sources).toHaveLength(2);
    p.stream.stop();
  });

  it("while the page is out of view the stream's closed and nothing runs; back in view it reopens", async () => {
    const p = page();
    p.latest().opens();
    p.seen.visible = false;
    p.stream.visibilityChanged();
    expect(p.seen.live).toBe(false);
    expect(p.sources[0].closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(p.sources).toHaveLength(1);

    p.seen.visible = true;
    p.stream.visibilityChanged();
    expect(p.sources).toHaveLength(2);
    p.latest().opens();
    expect(p.seen.live).toBe(true);
    // Coming back into view, the app reads the club itself (backend.svelte.ts): no catch-up of the stream's own
    expect(p.seen.caughtUp).toBe(0);
    p.stream.stop();
  });

  it("stopped (the page went): closed, and nothing left running", () => {
    const p = page();
    p.latest().opens();
    p.stream.stop();
    expect(p.sources[0].closed).toBe(true);
    expect(p.seen.live).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
