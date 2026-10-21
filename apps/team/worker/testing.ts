// The fake world the Worker's tests run in (ADR 0031): an in-memory D1 with every migration and a small roster,
// and browsers that keep the cookies the app sets. On a "local" server nothing is emailed, so a sign-in code comes
// back in the reply; tests sign in with it the way a member types it.
import { outbox, type Mail } from "@cougars/shared/email";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { FIRST_KUMITE_SQL } from "@cougars/shared/testing/kumite";
import { parseRoster, rosterSql } from "../../../scripts/lib/roster.mjs";
import { handleApi, type Env } from "./api/api";
import { LiveHub } from "./live/live";
import { vi } from "vitest";
import { drainPush, pushOutbox, type Sent } from "./push/push";

/** A namespace with one object in it, for the fake world: what `env.LIVE` is on a real Worker. */
const liveNamespace = (hub: LiveHub) =>
  ({
    idFromName: (name: string) => name,
    get: () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => hub.fetch(new Request(input, init)) }),
  }) as unknown as DurableObjectNamespace;

// Tuesday 6 October 2026, midday in London
export const NOW = new Date("2026-10-06T11:00:00Z");
export const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

export interface Reply {
  status: number;
  // The tests read whatever the API sent back; its shapes are checked by the assertions themselves.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Headers;
}

/** The seeded luck of the last world that asked for it (luck()): a new world starts with the real thing. */
let seeded: { mockRestore(): void } | null = null;

export function testWorld(roster: object[]) {
  seeded?.mockRestore();
  seeded = null;
  const db = createTestD1();
  db.raw.exec(rosterSql(parseRoster(JSON.stringify(roster)), NOW));
  db.raw.exec(FIRST_KUMITE_SQL);
  // The live hub (ADR 0072) as the Worker reaches it: one object, behind a namespace that always finds it
  const live = new LiveHub();
  const env: Env = { DB: db, TEAM_ENV: "local", LIVE: liveNamespace(live) };
  // The club's email, faked: each one the app would have sent, whole, in order (packages/shared/email.ts outbox)
  const mails: Mail[] = [];
  outbox.capture = (m) => void mails.push(m);
  // Notifications on phones (ADR 0108), faked the same way: each one Firebase would have delivered, one per phone
  const pushes: Sent[] = [];
  pushOutbox.capture = (p) => void pushes.push(p);

  // Firebase Cloud Messaging, once a test turns it on (firebase()): what it was asked, and fetches per invocation
  let fcm: Awaited<ReturnType<typeof firebase>> | null = null;
  /** Run one Worker invocation, counting the fetches it makes (the free plan allows 50, ADR 0108). */
  async function invocation<T>(run: () => Promise<T>): Promise<T> {
    if (!fcm) return run();
    const start = fcm.fetches;
    try {
      return await run();
    } finally {
      fcm.invocations.push(fcm.fetches - start);
    }
  }

  /**
   * Firebase on: a service account with a fresh key and project (so fcm.ts's cached access token never carries
   * over), Google's token endpoint, and FCM's send. Each phone's answer is "sent" unless the test says "gone" or
   * "failed" (`answers`, or `down` for every phone); a delivered one lands in `pushes` like an uncaught one. Any other
   * fetch throws with its URL.
   */
  async function firebase() {
    const { privateKey } = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = btoa(
      String.fromCharCode(...new Uint8Array((await crypto.subtle.exportKey("pkcs8", privateKey)) as ArrayBuffer)),
    );
    const project = `cougars-test-${crypto.randomUUID().slice(0, 8)}`;
    env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: project,
      client_email: `push@${project}.iam.gserviceaccount.com`,
      private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`,
    });
    const sendUrl = `https://fcm.googleapis.com/v1/projects/${project}/messages:send`;
    const world = {
      sendUrl,
      /** Every send FCM was asked for, in order, whatever it answered. */
      asked: [] as { token: string; title: string; body: string; path: string }[],
      answers: new Map<string, "gone" | "failed">(),
      down: false,
      fetches: 0,
      /** Fetches made by each invocation (a request, or a cron run) since Firebase was turned on. */
      invocations: [] as number[],
    };
    const memberOf = (token: string) =>
      (
        db.raw
          .prepare(
            "SELECT s.member_id m FROM push_devices d JOIN auth_sessions s ON s.id = d.session_id WHERE token = ?",
          )
          .get(token) as { m: number } | undefined
      )?.m ?? 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        world.fetches++;
        if (url === "https://oauth2.googleapis.com/token")
          return Response.json({ access_token: "access", expires_in: 3600 });
        if (url !== sendUrl) throw new Error(`The fake world doesn't know ${url}`);
        const { message } = JSON.parse(String(init.body));
        const sent = {
          token: message.token,
          title: message.notification.title,
          body: message.notification.body,
          path: message.data.path,
        };
        world.asked.push(sent);
        const answer = world.down ? "failed" : world.answers.get(sent.token);
        if (answer === "gone")
          return Response.json(
            { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } },
            { status: 404 },
          );
        if (answer === "failed") return Response.json({ error: { status: "UNAVAILABLE" } }, { status: 503 });
        pushes.push({ ...sent, memberId: memberOf(sent.token) });
        return Response.json({ name: `projects/${project}/messages/${world.asked.length}` });
      }),
    );
    fcm = world;
    return world;
  }

  /**
   * Luck, seeded: from here on every `crypto.getRandomValues` (the draft's draw, sign-in codes, tokens) comes from a
   * small seeded generator (mulberry32), so a draw comes out the same each run. Unseeded, it's the real thing.
   */
  function luck(seed: number) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
    seeded?.mockRestore();
    seeded = vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (array) {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < bytes.length; i += 4) {
          const n = next();
          for (let k = 0; k < 4 && i + k < bytes.length; k++) bytes[i + k] = (n >>> (8 * k)) & 0xff;
        }
      }
      return array;
    });
  }

  /** The cron triggers' notification drain (index.ts `scheduled`, every five minutes and hourly), at this time. */
  const cron = (now: Date) => invocation(() => drainPush(env, now));

  interface Options {
    now?: Date;
    /** Extra headers; `null` leaves one out (a change with no Origin). */
    headers?: Record<string, string | null>;
    host?: string;
  }

  /** A browser: it keeps the cookies the app sets. */
  function browser() {
    const jar = new Map<string, string>();
    /** The reply as the Worker sent it: for a stream, or its headers. */
    async function open(
      method: string,
      path: string,
      { now = NOW, headers = {}, host = "https://team.test" }: Options = {},
      payload?: unknown,
    ): Promise<Response> {
      // Like a real browser, a change carries the page's Origin
      const sent: Record<string, string | null> = {
        "content-type": "application/json",
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(method === "GET" || method === "HEAD" ? {} : { origin: new URL(host).origin }),
        ...headers,
      };
      const res = await invocation(() =>
        handleApi(
          new Request(`${host}${path}`, {
            method,
            headers: Object.entries(sent).filter((e): e is [string, string] => e[1] !== null),
            body: payload === undefined ? undefined : JSON.stringify(payload),
          }),
          env,
          now,
        ),
      );
      for (const c of res.headers.getSetCookie()) {
        const [pair, ...attrs] = c.split("; ");
        const [k, v] = pair.split("=");
        if (attrs.includes("Max-Age=0")) jar.delete(k);
        else jar.set(k, v);
      }
      return res;
    }
    async function call(method: string, path: string, payload?: unknown, options: Options = {}): Promise<Reply> {
      const res = await open(method, path, options, payload);
      const isJson = res.headers.get("content-type")?.includes("json");
      return { status: res.status, body: isJson ? await res.json() : {}, headers: res.headers };
    }
    return { call, open, jar };
  }

  /** Ask for a code; the reply (with the code, on a local server). */
  const ask = async (b: ReturnType<typeof browser>, email: string, now = NOW) =>
    (await b.call("POST", "/api/auth/start", { email }, { now })).body;

  /** A browser signed in as the member with this email. */
  async function signedIn(email: string) {
    const b = browser();
    const { devCode } = await ask(b, email);
    const r = await b.call("POST", "/api/auth/verify", { code: devCode });
    if (r.status !== 200) throw new Error(`Couldn't sign in ${email}: ${JSON.stringify(r.body)}`);
    return b;
  }

  /** A phone with a live page open (ADR 0072): the events its stream brings, in order. */
  async function listening(email: string, now = NOW) {
    const b = await signedIn(email);
    const res = await b.open("GET", "/api/live", { now });
    if (res.status !== 200 || res.headers.get("content-type") !== "text/event-stream")
      throw new Error(`No stream for ${email}: ${res.status}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    /** The next event (not a comment), as {event, data}. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function next(): Promise<{ event: string; data: any }> {
      for (;;) {
        const at = buffered.indexOf("\n\n");
        if (at >= 0) {
          const block = buffered.slice(0, at);
          buffered = buffered.slice(at + 2);
          const lines = block.split("\n").filter((l) => !l.startsWith(":"));
          if (!lines.length) continue;
          const field = (name: string) =>
            lines
              .find((l) => l.startsWith(`${name}:`))
              ?.slice(name.length + 1)
              .trim();
          const data = field("data");
          if (data === undefined) continue;
          return { event: field("event") ?? "message", data: JSON.parse(data) };
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("the stream ended");
        buffered += decoder.decode(value, { stream: true });
      }
    }
    return { ...b, next, close: () => reader.cancel() };
  }

  return { db, env, live, browser, ask, signedIn, listening, mails, pushes, firebase, cron, luck };
}
