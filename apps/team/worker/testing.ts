// The fake world the Worker's tests run in (ADR 0031): an in-memory D1 with every migration and a small roster,
// and browsers that keep the cookies the app sets. On a "local" server nothing is emailed, so a sign-in code comes
// back in the reply; tests sign in with it the way a member types it.
import { outbox, type Mail } from "@cougars/shared/email";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { FIRST_KUMITE_SQL } from "@cougars/shared/testing/kumite";
import { parseRoster, rosterSql } from "../../../scripts/lib/roster.mjs";
import { handleApi, type Env } from "./api/api";
import worker from "./index";
import { LiveHub } from "./live/live";
import { vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { drainPush, pushOutbox, type Sent } from "./push/push";
import {
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomUUID,
  verify,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { SITEVERIFY } from "@cougars/shared/turnstile";

/** The token a person's Turnstile widget gives, rendered for this form (testWorld's turnstile()). */
export const humanToken = (action: string) => `person:${action}`;

/**
 * A namespace with one object in it, for the fake world: what `env.LIVE` is on a real Worker. A call to it is one of the
 * invocation's subrequests, as on Cloudflare (`counted`).
 */
const liveNamespace = (hub: LiveHub, counted: () => void) =>
  ({
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        counted();
        return hub.fetch(new Request(input, init));
      },
    }),
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
  /** The subrequests of the invocation running, however many run at once (each its own count, ADR 0003). */
  const running = new AsyncLocalStorage<{ fetches: number }>();
  const counted = () => {
    const mine = running.getStore();
    if (mine) mine.fetches++;
  };
  const env: Env = { DB: db, TEAM_ENV: "local", LIVE: liveNamespace(live, counted) };
  // The club's email, faked: each one the app would have sent, whole, in order (packages/shared/email.ts outbox).
  // Each is one request to Gmail on a real Worker, so it counts as one of the invocation's subrequests
  const mails: Mail[] = [];
  outbox.capture = (m) => {
    mails.push(m);
    counted();
  };
  // Notifications on phones (ADR 0108), faked the same way: each one Firebase would have delivered, one per phone
  const pushes: Sent[] = [];
  pushOutbox.capture = (p) => void pushes.push(p);

  /** Subrequests made by each invocation (a request, or a cron run) since a push service was turned on (firebase(),
   * webPush()): fetches, emails and live hub calls. */
  let invocations: number[] | null = null;
  /**
   * Run one Worker invocation, counting its subrequests (the free plan allows 50, ADR 0003): fetches, emails and calls
   * to the live hub. Counted once a push service is on (`invocations`).
   */
  async function invocation<T>(run: () => Promise<T>): Promise<T> {
    if (!invocations) return run();
    const mine = { fetches: 0 };
    try {
      return await running.run(mine, run);
    } finally {
      invocations.push(mine.fetches);
    }
  }

  // The outside world the Worker fetches, once a test turns a service on: each answers its own addresses (null for
  // anyone else's), and any fetch nobody answers throws with its URL. Every fetch is one of the invocation's subrequests
  const services: ((url: string, init: RequestInit) => Response | null)[] = [];
  function serve(service: (url: string, init: RequestInit) => Response | null) {
    invocations ??= [];
    if (!services.length)
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL, init: RequestInit) => {
          counted();
          for (const answer of services) {
            const res = answer(String(url), init);
            if (res) return res;
          }
          throw new Error(`The fake world doesn't know ${url}`);
        }),
      );
    services.push(service);
    return invocations;
  }
  /** The member a device is signed in as. */
  const memberOf = (token: string) =>
    (
      db.raw
        .prepare("SELECT s.member_id m FROM push_devices d JOIN auth_sessions s ON s.id = d.session_id WHERE token = ?")
        .get(token) as { m: number } | undefined
    )?.m ?? 0;

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
      answers: new Map<string, "gone" | "failed" | "apns">(),
      down: false,
      fetches: 0,
      /** Subrequests made by each invocation (a request, or a cron run) since a push service was turned on. */
      invocations: [] as number[],
    };
    world.invocations = serve((url: string, init: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        world.fetches++;
        return Response.json({ access_token: "access", expires_in: 3600 });
      }
      if (url !== sendUrl) return null;
      world.fetches++;
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
      if (answer === "apns")
        return Response.json(
          {
            error: {
              message: "Invalid APNs credential.",
              status: "UNAUTHENTICATED",
              details: [{ errorCode: "THIRD_PARTY_AUTH_ERROR" }],
            },
          },
          { status: 401 },
        );
      pushes.push({ ...sent, memberId: memberOf(sent.token) });
      return Response.json({ name: `projects/${project}/messages/${world.asked.length}` });
    });
    return world;
  }

  /**
   * Web Push on (ADR 0108, #24): the club's VAPID key pair, and the browsers' push services. A test makes a browser's
   * subscription with `subscription()` (its own key pair and secret, as a browser does); the fake push service takes
   * a send to it only with a VAPID signature that checks out for that service, opens the message with the browser's
   * key (RFC 8291, worked out here with node:crypto, apart from webpush.ts) and delivers it to `pushes`, unless the
   * test says "gone" or "failed" (`answers`, or `down` for every browser). What it refused, and why, is in `refused`.
   */
  function webPush() {
    const jwkOf = (k: KeyObject) => k.export({ format: "jwk" });
    const pointOf = (k: KeyObject) => {
      const { x, y } = jwkOf(k);
      return Buffer.concat([Buffer.from([4]), Buffer.from(x!, "base64url"), Buffer.from(y!, "base64url")]);
    };
    const pointKey = (point: Buffer) =>
      createPublicKey({
        key: {
          kty: "EC",
          crv: "P-256",
          x: point.subarray(1, 33).toString("base64url"),
          y: point.subarray(33).toString("base64url"),
        },
        format: "jwk",
      });
    const vapid = generateKeyPairSync("ec", { namedCurve: "P-256" });
    env.VAPID_PUBLIC_KEY = pointOf(vapid.publicKey).toString("base64url");
    env.VAPID_PRIVATE_KEY = jwkOf(vapid.privateKey).d!;
    const browsers = new Map<string, { key: KeyObject; auth: Buffer }>();
    const SERVICES = [
      "https://fcm.googleapis.com/fcm/send/",
      "https://updates.push.services.mozilla.com/wpush/v2/",
      "https://web.push.apple.com/",
      "https://wns2-par02p.notify.windows.com/w/?token=",
    ];
    const world = {
      /** A browser's subscription, as PushSubscription.toJSON() gives it, on Google's push service or another. */
      subscription(service: "google" | "mozilla" | "apple" | "windows" = "google") {
        const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
        const auth = Buffer.from(randomUUID().replace(/-/g, ""), "hex");
        const at = ["google", "mozilla", "apple", "windows"].indexOf(service);
        const endpoint = `${SERVICES[at]}${randomUUID()}`;
        browsers.set(endpoint, { key: privateKey, auth });
        return {
          endpoint,
          expirationTime: null,
          keys: { p256dh: pointOf(privateKey).toString("base64url"), auth: auth.toString("base64url") },
        };
      },
      /** Every send a push service was asked for and opened, in order, whatever it answered. */
      asked: [] as { endpoint: string; title: string; body: string; path: string; tag: string }[],
      refused: [] as string[],
      answers: new Map<string, "gone" | "failed">(),
      down: false,
      invocations: [] as number[],
    };
    const refuse = (why: string) => (world.refused.push(why), new Response(why, { status: 403 }));
    world.invocations = serve((url: string, init: RequestInit) => {
      if (!SERVICES.some((s) => url.startsWith(s))) return null;
      const browser = browsers.get(url);
      if (!browser) return new Response("no such subscription", { status: 404 });
      const headers = new Headers(init.headers);
      // The VAPID signature (RFC 8292): our key, for this push service, unexpired, signed
      const [, jwt, k] = headers.get("authorization")?.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
      if (!jwt || k !== env.VAPID_PUBLIC_KEY) return refuse("not our VAPID key");
      const [head, payload, signature] = jwt.split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (claims.aud !== new URL(url).origin) return refuse(`aud ${claims.aud}`);
      if (!/^(https:|mailto:)/.test(claims.sub)) return refuse("no sub");
      const signed = verify(
        "sha256",
        Buffer.from(`${head}.${payload}`),
        { key: pointKey(Buffer.from(k, "base64url")), dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      );
      if (!signed) return refuse("bad signature");
      if (headers.get("content-encoding") !== "aes128gcm" || !headers.get("ttl")) return refuse("headers");
      // Opened as the browser opens it (RFC 8291 §3.4, RFC 8188)
      const message = Buffer.from(init.body as Uint8Array);
      const salt = message.subarray(0, 16);
      const keyId = message.subarray(21, 21 + message[20]);
      const uaPublic = pointOf(browser.key);
      const ecdh = diffieHellman({ privateKey: browser.key, publicKey: pointKey(keyId) });
      const info = (s: string, ...more: Buffer[]) => Buffer.concat([Buffer.from(s), ...more]);
      const ikm = Buffer.from(hkdfSync("sha256", ecdh, browser.auth, info("WebPush: info\0", uaPublic, keyId), 32));
      const cek = Buffer.from(hkdfSync("sha256", ikm, salt, info("Content-Encoding: aes128gcm\0"), 16));
      const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, info("Content-Encoding: nonce\0"), 12));
      const sealed = message.subarray(21 + message[20]);
      const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(sealed.subarray(-16));
      const record = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
      const opened = JSON.parse(record.subarray(0, record.lastIndexOf(2)).toString());
      world.asked.push({ endpoint: url, ...opened });
      const answer = world.down ? "failed" : world.answers.get(url);
      if (answer === "gone") return new Response("unsubscribed", { status: 410 });
      if (answer === "failed") return new Response("busy", { status: 503 });
      pushes.push({ token: url, title: opened.title, body: opened.body, path: opened.path, memberId: memberOf(url) });
      return new Response(null, { status: 201 });
    });
    return world;
  }

  /**
   * Cloudflare Turnstile on (#13): the team app has a secret, and siteverify answers. A browser's widget gives
   * `humanToken(action)`, which Cloudflare confirms for that action; any other token, or none, it says no to. `down`:
   * Cloudflare can't be reached. `asked`: each check, as Cloudflare got it.
   */
  function turnstile() {
    env.TURNSTILE_SECRET_KEY = "turnstile-test-secret";
    const world = { asked: [] as Record<string, string>[], down: false };
    serve((url, init) => {
      if (url !== SITEVERIFY) return null;
      const sent = Object.fromEntries(new URLSearchParams(String(init.body)));
      world.asked.push(sent);
      if (world.down) throw new Error("connect ETIMEDOUT");
      const action = /^person:(.+)$/.exec(sent.response)?.[1];
      const known = sent.secret === env.TURNSTILE_SECRET_KEY && !!action;
      return Response.json(
        known ? { success: true, action } : { success: false, "error-codes": ["invalid-input-response"] },
      );
    });
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
  /**
   * One run of a Cron Trigger, whole, as Cloudflare runs it (index.ts `scheduled`, inside Sentry's wrapper, which
   * wants the execution context): every job it does, in one invocation, with what it left to waitUntil finished in it.
   */
  const scheduled = (trigger: "*/5 * * * *" | "7 * * * *", now: Date) =>
    invocation(async () => {
      const after: Promise<unknown>[] = [];
      const ctx = { waitUntil: (p: Promise<unknown>) => void after.push(p), passThroughOnException() {} };
      const run = worker.scheduled as unknown as (c: ScheduledController, e: Env, x: ExecutionContext) => Promise<void>;
      await run(
        { cron: trigger, scheduledTime: now.getTime(), noRetry() {} } as ScheduledController,
        env,
        ctx as never,
      );
      await Promise.all(after);
    });

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

  /** Ask for a code, as a person (their Turnstile token, checked once turnstile() is on); the reply (with the code,
   * on a local server). */
  const ask = async (b: ReturnType<typeof browser>, email: string, now = NOW) =>
    (await b.call("POST", "/api/auth/start", { email, turnstile: humanToken("sign-in") }, { now })).body;

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

  return {
    db,
    env,
    live,
    browser,
    ask,
    signedIn,
    listening,
    mails,
    pushes,
    firebase,
    webPush,
    turnstile,
    cron,
    scheduled,
    luck,
  };
}
