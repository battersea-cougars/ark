// The live hub (ADR 0072) on its own, with fake timers: the edges the use cases' real waits don't pin down. A change
// with nobody listening, the second's coalescing to the millisecond, a phone's stream that's gone, a notify the hub
// can't read, and paths it doesn't know. A real LiveHub, as the Worker's tests hold one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveHub } from "./live";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T19:00:00Z"));
});
afterEach(() => void vi.useRealTimers());

/** A phone's stream (a member's, `member`): every event it's been sent so far. */
async function listen(hub: LiveHub, member?: number) {
  const res = await hub.fetch(new Request(`https://live/subscribe${member ? `?member=${member}` : ""}`));
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: { changed: string[]; versions: number[]; parts?: any[] }[] = [];
  let text = "";
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      text += decoder.decode(value, { stream: true });
      for (let at = text.indexOf("\n\n"); at >= 0; at = text.indexOf("\n\n")) {
        const block = text.slice(0, at);
        text = text.slice(at + 2);
        const data = block.split("\n").find((l) => l.startsWith("data: "));
        if (block.includes("event: changed") && data) events.push(JSON.parse(data.slice(6)));
      }
    }
  })();
  return { res, events, close: async () => (await reader.cancel(), await pump) };
}
const notify = (hub: LiveHub, body: unknown) =>
  hub.fetch(
    new Request("https://live/notify", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const tick = () => vi.advanceTimersByTimeAsync(0);

describe("the live hub", () => {
  it("a change with nobody listening is sent to nobody, and the first phone after hears only what's next", async () => {
    const hub = new LiveHub();
    expect(await (await notify(hub, { changed: ["sessions"], version: 1 })).json()).toEqual({ listeners: 0 });
    const phone = await listen(hub);
    await vi.advanceTimersByTimeAsync(2000);
    expect(phone.events).toEqual([]);
    await notify(hub, { changed: ["charges"], version: 2 });
    await tick();
    expect(phone.events).toEqual([{ changed: ["charges"], versions: [2] }]);
    await phone.close();
  });

  it("changes inside the second after an event wait until its end, then go as one, versions in order", async () => {
    const hub = new LiveHub();
    const phone = await listen(hub);
    await notify(hub, { changed: ["sessions"], version: 1 });
    await tick();
    expect(phone.events).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);
    await notify(hub, { changed: ["charges"], version: 3 });
    await notify(hub, { changed: ["sessions", "charges"], version: 2 });
    await vi.advanceTimersByTimeAsync(899);
    expect(phone.events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(phone.events[1]).toEqual({ changed: ["charges", "sessions"], versions: [2, 3] });
    await phone.close();
  });

  it("a change a second or more after the last event goes at once", async () => {
    const hub = new LiveHub();
    const phone = await listen(hub);
    await notify(hub, { changed: ["sessions"], version: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    await notify(hub, { changed: ["sessions"], version: 2 });
    await tick();
    expect(phone.events.map((e) => e.versions)).toEqual([[1], [2]]);
    await phone.close();
  });

  it("the last phone leaving forgets what was waiting: a phone that comes back doesn't hear old news", async () => {
    const hub = new LiveHub();
    const first = await listen(hub);
    await notify(hub, { changed: ["sessions"], version: 1 });
    await notify(hub, { changed: ["charges"], version: 2 }); // waiting for the end of the second
    await first.close();
    expect(hub.listeners).toBe(0);
    const again = await listen(hub);
    await vi.advanceTimersByTimeAsync(5000);
    expect(again.events).toEqual([]);
    await again.close();
  });

  it("one phone closing leaves the others listening", async () => {
    const hub = new LiveHub();
    const a = await listen(hub);
    const b = await listen(hub);
    expect(hub.listeners).toBe(2);
    await a.close();
    expect(hub.listeners).toBe(1);
    await notify(hub, { changed: ["sessions"], version: 1 });
    await tick();
    expect(b.events).toHaveLength(1);
    await b.close();
  });

  it("a notify it can't read is a change to nothing: no event, no error", async () => {
    const hub = new LiveHub();
    const phone = await listen(hub);
    const r = await notify(hub, "not json");
    expect(r.status).toBe(200);
    await vi.advanceTimersByTimeAsync(2000);
    // An event with nothing in it, at most: nothing a phone would read for
    expect(phone.events.every((e) => !e.changed.length)).toBe(true);
    await phone.close();
  });

  it("a change without a version (an older Worker) still names its parts", async () => {
    const hub = new LiveHub();
    const phone = await listen(hub);
    await notify(hub, { changed: ["sessions"] });
    await tick();
    expect(phone.events).toEqual([{ changed: ["sessions"], versions: [] }]);
    await phone.close();
  });

  it("pings as a stream opens and every 30 seconds after, as an event the page hears", async () => {
    const hub = new LiveHub();
    const res = await hub.fetch(new Request("https://live/subscribe"));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const read = async () => new TextDecoder().decode((await reader.read()).value);
    expect(await read()).toBe("retry: 10000\n\n");
    expect(await read()).toBe("event: ping\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await read()).toBe("event: ping\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await read()).toBe("event: ping\ndata: {}\n\n");
    await reader.cancel();
  });

  it("a part goes only down the streams of the members it's for; the others hear the names alone", async () => {
    const hub = new LiveHub();
    const mine = await listen(hub, 7);
    const theirs = await listen(hub, 8);
    const match = { tournamentId: 3, games: [{ id: 1, homeGoals: 1 }] };
    await notify(hub, { changed: ["tournaments"], version: 4, pushed: { part: { match }, audience: [7] } });
    await tick();
    expect(mine.events).toEqual([{ changed: ["tournaments"], versions: [4], parts: [{ version: 4, match }] }]);
    expect(theirs.events).toEqual([{ changed: ["tournaments"], versions: [4] }]);
    await mine.close();
    await theirs.close();
  });

  it("a part for everyone goes down every stream, each with its version, in the second's one event", async () => {
    const hub = new LiveHub();
    const a = await listen(hub, 7);
    const b = await listen(hub, 8);
    const at = (version: number, homeGoals: number) => ({
      changed: ["tournaments"],
      version,
      pushed: { part: { match: { tournamentId: 3, games: [{ id: 1, homeGoals }] } }, audience: "everyone" },
    });
    await notify(hub, at(1, 1));
    await tick();
    await notify(hub, at(3, 3));
    await notify(hub, at(2, 2));
    await notify(hub, { changed: ["sessions"], version: 4 });
    await vi.advanceTimersByTimeAsync(1000);
    for (const phone of [a, b]) {
      expect(phone.events).toHaveLength(2);
      expect(phone.events[1].versions).toEqual([2, 3, 4]);
      expect(phone.events[1].parts!.map((p) => [p.version, p.match.games[0].homeGoals])).toEqual([
        [2, 2],
        [3, 3],
      ]);
    }
    await a.close();
    await b.close();
  });

  it("a part without a version goes nowhere: a phone couldn't tell what it follows on from", async () => {
    const hub = new LiveHub();
    const phone = await listen(hub, 7);
    await notify(hub, { changed: ["tournaments"], pushed: { part: { match: {} }, audience: "everyone" } });
    await tick();
    expect(phone.events).toEqual([{ changed: ["tournaments"], versions: [] }]);
    await phone.close();
  });

  it("stores nothing: streams and what's waiting live in memory only, whatever it's sent", async () => {
    const touched: string[] = [];
    const trap = new Proxy({}, { get: (_t, key) => (touched.push(String(key)), () => Promise.resolve()) });
    const hub = new LiveHub({ storage: trap, blockConcurrencyWhile: trap }, {});
    const phone = await listen(hub, 7);
    await notify(hub, {
      changed: ["tournaments"],
      version: 1,
      pushed: { part: { match: { tournamentId: 1, games: [] } }, audience: "everyone" },
    });
    await vi.advanceTimersByTimeAsync(31_000);
    await phone.close();
    expect(phone.events).toHaveLength(1);
    expect(touched).toEqual([]);
  });

  it("answers anything else with a 404", async () => {
    const hub = new LiveHub();
    expect((await hub.fetch(new Request("https://live/notify"))).status).toBe(404);
    expect((await hub.fetch(new Request("https://live/other", { method: "POST" }))).status).toBe(404);
  });
});
