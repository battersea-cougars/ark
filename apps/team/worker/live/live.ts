// The club's live hub (ADR 0072): one Durable Object per environment that holds every open live page's stream and
// tells them all at once when something changed. It stores nothing (declared SQLite-backed because the free plan
// asks for it; the streams live in memory, D1 is the source of truth), so if it restarts the phones just reconnect.
// An event is only the names of the club's parts that changed (ADR 0057) and the data versions that changed them: what
// a member sees still comes from their own read. A burst of changes (a Friday's taps) goes out as one event a second
// at most, naming every part and version in it, so each phone reads once (#112). Each stream is a member's and a
// sign-in's: three a member at most, and closed when its sign-in ends (#72, #73). Written in the classic Durable
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

/**
 * Streams one member may hold at once (#73): a phone, a laptop and a tab or two, since a page out of view closes its
 * own. Another one opening closes their oldest, so a stale one never shuts out the page in front of them, and one
 * member (or a stolen session) can't hold dozens of the hub's connections.
 */
export const STREAMS_PER_MEMBER = 3;

/** Whose a stream is: the member, and the sign-in it came with (none: a local server's auto admin). */
interface Listener {
  memberId: number;
  sessionId: number | null;
}

export class LiveHub {
  /** Every open stream, oldest first, and whose it is. */
  private readonly streams = new Map<ReadableStreamDefaultController<Uint8Array>, Listener>();
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
    const { pathname, searchParams } = new URL(request.url);
    if (request.method === "GET" && pathname === "/subscribe") {
      const session = searchParams.get("session");
      return this.subscribe({
        memberId: Number(searchParams.get("member")),
        sessionId: session ? Number(session) : null,
      });
    }
    // Signed out (#72): their streams close, so a session that's ended stops hearing the club at once
    if (request.method === "POST" && pathname === "/end") {
      const { memberId, sessionIds = [] } = (await request.json().catch(() => ({}))) as {
        memberId?: number;
        sessionIds?: number[];
      };
      let ended = 0;
      for (const [c, who] of this.streams)
        if (who.memberId === memberId || (who.sessionId !== null && sessionIds.includes(who.sessionId))) {
          this.end(c);
          ended++;
        }
      return Response.json({ ended });
    }
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

  /** One phone's stream, open until the page closes it, or the member opens too many others. */
  private subscribe(who: Listener): Response {
    const theirs = [...this.streams].filter(([, w]) => w.memberId === who.memberId).map(([c]) => c);
    for (const c of theirs.slice(0, Math.max(0, theirs.length - STREAMS_PER_MEMBER + 1))) this.end(c);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        this.streams.set(c, who);
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
    for (const c of this.streams.keys()) {
      try {
        c.enqueue(bytes);
      } catch {
        this.drop(c);
      }
    }
  }

  /** Close a stream from this end: the page's EventSource sees it go, and reconnects through its brake. */
  private end(c: ReadableStreamDefaultController<Uint8Array>) {
    try {
      c.close();
    } catch {
      // gone already
    }
    this.drop(c);
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
export async function liveStream(env: LiveEnv, who: Listener): Promise<Response> {
  if (!env.LIVE)
    return Response.json(
      { error: "Live updates aren't on here; the page checks for changes instead." },
      { status: 503 },
    );
  const q = new URLSearchParams({ member: String(who.memberId), session: String(who.sessionId ?? "") });
  return hub(env).fetch(`https://live/subscribe?${q}`);
}

/** Close the streams of a member who's been signed out everywhere, or of these sign-ins (#72). Never fails. */
export async function endLive(env: LiveEnv, which: { memberId: number } | { sessionIds: number[] }): Promise<void> {
  if (!env.LIVE) return;
  try {
    await hub(env).fetch("https://live/end", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(which),
    });
  } catch (e) {
    // The session is ended all the same: its stream hears nothing it shouldn't for long (the next request is a 401)
    log.warn("live.end.failed", { error: String(e) });
  }
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
