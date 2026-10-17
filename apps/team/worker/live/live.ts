// The club's live hub (ADR 0072): one Durable Object per environment that holds every open live page's stream and
// tells them all at once when something changed. It stores nothing (declared SQLite-backed because the free plan
// asks for it; the streams live in memory, D1 is the source of truth), so if it restarts the phones just reconnect.
// An event is only the names of the club's parts that changed (ADR 0057): what a member sees still comes from their
// own bootstrap. Written in the classic Durable Object shape, with no runtime imports, so the tests hold a real one.
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

export class LiveHub {
  private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;

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
      const { changed = [] } = (await request.json().catch(() => ({}))) as { changed?: string[] };
      this.send(frame("changed", { changed }));
      return Response.json({ listeners: this.listeners });
    }
    return new Response("Not found", { status: 404 });
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
    if (!this.streams.size && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
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

/** After a change: tell everyone listening which parts. Never fails the change. */
export async function notifyLive(env: LiveEnv, changed: readonly string[]): Promise<void> {
  if (!env.LIVE || !changed.length) return;
  try {
    await hub(env).fetch("https://live/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changed }),
    });
  } catch (e) {
    log.warn("live.notify.failed", e);
  }
}
