// The club's live hub (ADR 0072): one Durable Object per environment that holds every open live page's stream and
// tells them all at once when something changed. It stores nothing (declared SQLite-backed because the free plan
// asks for it; the streams live in memory, D1 is the source of truth), so if it restarts the phones just reconnect.
// An event is only the names of the club's parts that changed (ADR 0057) and the data versions that changed them: what
// a member sees still comes from their own read. A burst of changes (a Friday's taps) goes out as one event a second
// at most, naming every part and version in it, so each phone reads once (#112). Written in the classic Durable
// Object shape, with no runtime imports, so the tests hold a real one.
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("live");

/** How often a comment goes down every stream, so a phone that's gone is dropped and the connection stays warm. */
const HEARTBEAT_MS = 30_000;
/** What a browser waits before reconnecting on its own; the app closes and reconnects through its brake instead. */
const RETRY_MS = 10_000;

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** At most one event this often: the changes in between go out together, at the end of it. */
const EVENT_EVERY_MS = 1000;

export class LiveHub {
  private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  /** What's changed since the last event, waiting for the next. */
  private readonly changed = new Set<string>();
  private readonly versions: number[] = [];
  private lastSent = 0;
  private waiting: ReturnType<typeof setTimeout> | undefined;

  // The object's state and environment: unused, it keeps nothing
  constructor(_state?: unknown, _env?: unknown) {}

  /** How many phones are listening. */
  get listeners() {
    return this.streams.size;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/subscribe") return this.subscribe();
    if (request.method === "POST" && pathname === "/notify") {
      const { changed = [], version } = (await request.json().catch(() => ({}))) as {
        changed?: string[];
        version?: number;
      };
      this.heard(changed, version);
      return Response.json({ listeners: this.listeners });
    }
    return new Response("Not found", { status: 404 });
  }

  /**
   * A change: out at once if the last event was a second or more ago, else with the others at the end of that second.
   * Nobody listening, nothing to send: a change made before anyone's on a live page starts no wait.
   */
  private heard(changed: readonly string[], version: number | undefined) {
    if (!this.streams.size) return;
    for (const c of changed) this.changed.add(c);
    if (version !== undefined) this.versions.push(version);
    if (this.waiting) return;
    const left = this.lastSent + EVENT_EVERY_MS - Date.now();
    if (left <= 0) this.flush();
    else this.waiting = setTimeout(() => this.flush(), left);
  }

  private flush() {
    this.waiting = undefined;
    this.lastSent = Date.now();
    const event = { changed: [...this.changed], versions: [...this.versions].sort((a, b) => a - b) };
    this.changed.clear();
    this.versions.length = 0;
    this.send(frame("changed", event));
  }

  /** One phone's stream, open until the page closes it. */
  private subscribe(): Response {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        this.streams.add(c);
        c.enqueue(encoder.encode(`retry: ${RETRY_MS}\n: hello\n\n`));
        this.heartbeat ??= setInterval(() => this.send(encoder.encode(": ping\n\n")), HEARTBEAT_MS);
      },
      // The page closed it, or the connection went
      cancel: () => this.drop(controller),
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  /** To every stream; one that's gone (the phone closed it, the network dropped it) is forgotten. */
  private send(bytes: Uint8Array) {
    for (const c of this.streams) {
      try {
        c.enqueue(bytes);
      } catch {
        this.drop(c);
      }
    }
  }

  private drop(c: ReadableStreamDefaultController<Uint8Array>) {
    this.streams.delete(c);
    if (this.streams.size) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    // Nobody left to tell
    clearTimeout(this.waiting);
    this.waiting = undefined;
    this.changed.clear();
    this.versions.length = 0;
  }
}

/** The hub's binding, as the Worker has it; absent on a server without one (the tests make their own). */
export interface LiveEnv {
  LIVE?: DurableObjectNamespace;
  SITE_ENV?: string;
}

/** The one hub for this environment. */
const hub = (env: LiveEnv) => env.LIVE!.get(env.LIVE!.idFromName(env.SITE_ENV ?? "local"));

/** A member's stream of changes, from the hub; a 503 that says so on a server without one. */
export async function liveStream(env: LiveEnv): Promise<Response> {
  if (!env.LIVE)
    return Response.json(
      { error: "Live updates aren't on here; the page checks for changes instead." },
      { status: 503 },
    );
  return hub(env).fetch("https://live/subscribe");
}

/** After a change: tell everyone listening which parts, and the data version the change made. Never fails the change. */
export async function notifyLive(env: LiveEnv, changed: readonly string[], version?: number): Promise<void> {
  if (!env.LIVE || !changed.length) return;
  try {
    await hub(env).fetch("https://live/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changed, version }),
    });
  } catch (e) {
    // An error, not a warning: every phone on a live page misses this change until its next check (ADR 0111)
    log.error("live.notify.failed", e, { changed });
  }
}
