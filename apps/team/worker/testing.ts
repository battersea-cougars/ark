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
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomUUID,
  verify,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { SITEVERIFY } from "@cougars/shared/turnstile";
import { authenticator } from "./testing.authenticator";

/** An issue as Sentry's API lists it, with the environment and status the fake filters by. */
export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string | null;
  count: string;
  userCount: number;
  level: string;
  status: "unresolved" | "resolved" | "ignored";
  environment: string;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
}

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

/** What one Worker invocation spent: its subrequests (fetches, emails, live hub calls) and its D1 calls. */
interface Spent {
  fetches: number;
  d1: D1Spent;
}
/** D1 calls: round trips (a batch is one, as Workers counts its 50 queries, ADR 0123) and the statements in them. */
export interface D1Spent {
  roundTrips: number;
  statements: number;
  /** Each round trip's statements, in order, the start of each: what to look at when a count goes up. */
  sql: string[][];
}
const fresh = (): Spent => ({ fetches: 0, d1: { roundTrips: 0, statements: 0, sql: [] } });
/** The D1 calls each reply's request made, everything it awaited included (ADR 0003). */
const spentBy = new WeakMap<Response, D1Spent>();

export interface Reply {
  status: number;
  /** The D1 calls the request made, start to finish: the tests have no waitUntil, so work after the reply counts too. */
  d1: D1Spent;
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
  /** The subrequests and D1 calls of the invocation running, however many run at once (each its own count, ADR 0003). */
  const running = new AsyncLocalStorage<Spent>();
  const counted = () => {
    const mine = running.getStore();
    if (mine) mine.fetches++;
  };
  db.onRoundTrip = (sql) => {
    const mine = running.getStore();
    if (!mine) return;
    mine.d1.roundTrips++;
    mine.d1.statements += sql.length;
    mine.d1.sql.push(sql.map((s) => s.replace(/\s+/g, " ").trim().slice(0, 120)));
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
   * to the live hub, listed once a push service is on (`invocations`); and its D1 calls, always (`spent.d1`).
   */
  async function invocation<T>(run: () => Promise<T>, spent: Spent = fresh()): Promise<T> {
    try {
      return await running.run(spent, run);
    } finally {
      invocations?.push(spent.fetches);
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
      // Google's token endpoint, for the service account's signed assertion (Gmail's refresh tokens are gmail()'s)
      if (url === "https://oauth2.googleapis.com/token" && String(init.body).includes("jwt-bearer")) {
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
   * Gmail on (ADR 0027): the one client, the Web client, with the deployed refresh token it made (from Bitwarden,
   * scripts/gmail-auth.mjs), the key an admin's reconnected token is sealed with; then Google's token endpoint, its
   * consent page and Gmail's send. Google knows each refresh token's client and account; `cancel()` cancels them (a password
   * change), with their access tokens. `busy`: Gmail rate-limits every send. Each email Gmail took is in `sent`, with
   * the refresh token it went with. Every world has fresh tokens, so email.ts's cached access token never carries over.
   */
  function gmail({ account = "dev@example.com" } = {}) {
    const deployed = `deployed-${randomUUID()}`;
    const web = { id: `web-${randomUUID()}.apps.googleusercontent.com`, secret: `web-secret-${randomUUID()}` };
    Object.assign(env, {
      GMAIL_REFRESH_TOKEN: deployed,
      GMAIL_WEB_CLIENT_ID: web.id,
      GMAIL_WEB_CLIENT_SECRET: web.secret,
      GMAIL_TOKEN_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
    });
    const SEND = "https://www.googleapis.com/auth/gmail.send";
    const refreshTokens = new Map<string, { client: string; account: string }>([
      [deployed, { client: web.id, account }],
    ]);
    const accessTokens = new Map<string, string>();
    const codes = new Map<
      string,
      { account: string; scope: string; redirect: string; challenge: string; client: string }
    >();
    const idToken = (email: string) =>
      `x.${Buffer.from(JSON.stringify({ email, email_verified: true })).toString("base64url")}.x`;
    const header = (raw: string, name: string) => {
      const line = raw.split("\r\n").find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}: `));
      const value = line?.slice(name.length + 2) ?? "";
      const encoded = /^=\?UTF-8\?B\?(.*)\?=$/.exec(value);
      return encoded ? Buffer.from(encoded[1], "base64").toString() : value;
    };
    const world = {
      account,
      deployed,
      web,
      /** Each email Gmail took: who it was from and to, its subject, and the refresh token behind it. */
      sent: [] as { from: string; to: string[]; subject: string; token: string }[],
      busy: false,
      /** Google cancels these refresh tokens (all of them, if none named), and their access tokens with them. */
      cancel(...tokens: string[]) {
        for (const t of tokens.length ? tokens : [...refreshTokens.keys()]) {
          refreshTokens.delete(t);
          for (const [access, of] of accessTokens) if (of === t) accessTokens.delete(access);
        }
      },
      /** The refresh tokens Google would still take. */
      live: () => [...refreshTokens.keys()],
      /**
       * Google's consent page, as the admin goes through it from the app's link: they sign in as `as`, and tick
       * "Send email on your behalf" (`send`) or not, or press Cancel (`deny`). Where Google sends the browser back.
       */
      consent(link: string, { as = account, send = true, deny = false } = {}): string {
        const u = new URL(link);
        if (u.origin + u.pathname !== "https://accounts.google.com/o/oauth2/v2/auth")
          throw new Error(`Not Google: ${link}`);
        const q = u.searchParams;
        if (q.get("client_id") !== web.id) throw new Error(`Not the Web client: ${q.get("client_id")}`);
        const back = new URL(q.get("redirect_uri")!);
        back.searchParams.set("state", q.get("state") ?? "");
        if (deny) {
          back.searchParams.set("error", "access_denied");
          return back.pathname + back.search;
        }
        const asked = (q.get("scope") ?? "").split(" ");
        const scope = asked.filter((s) => s !== SEND || send).join(" ");
        const code = `code-${randomUUID()}`;
        codes.set(code, {
          account: as,
          scope,
          redirect: q.get("redirect_uri")!,
          challenge: q.get("code_challenge") ?? "",
          client: web.id,
        });
        back.searchParams.set("code", code);
        back.searchParams.set("scope", scope);
        return back.pathname + back.search;
      },
    };
    serve((url, init) => {
      if (url === "https://oauth2.googleapis.com/token") {
        const p = new URLSearchParams(String(init.body));
        if (p.get("grant_type") === "refresh_token") {
          const known = refreshTokens.get(p.get("refresh_token") ?? "");
          if (!known || known.client !== p.get("client_id") || p.get("client_secret") !== web.secret)
            return Response.json(
              { error: "invalid_grant", error_description: "Token has been expired or revoked." },
              { status: 400 },
            );
          const access = `access-${randomUUID()}`;
          accessTokens.set(access, p.get("refresh_token")!);
          return Response.json({ access_token: access, expires_in: 3599, id_token: idToken(known.account) });
        }
        if (p.get("grant_type") === "authorization_code") {
          const c = codes.get(p.get("code") ?? "");
          codes.delete(p.get("code") ?? "");
          const verifier = createHash("sha256")
            .update(p.get("code_verifier") ?? "")
            .digest("base64url");
          if (
            !c ||
            p.get("client_id") !== c.client ||
            p.get("client_secret") !== web.secret ||
            p.get("redirect_uri") !== c.redirect ||
            verifier !== c.challenge
          )
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          const refresh = `reconnected-${randomUUID()}`;
          refreshTokens.set(refresh, { client: c.client, account: c.account });
          const access = `access-${randomUUID()}`;
          accessTokens.set(access, refresh);
          return Response.json({
            access_token: access,
            expires_in: 3599,
            refresh_token: refresh,
            scope: c.scope,
            id_token: idToken(c.account),
          });
        }
        return null;
      }
      if (url !== "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") return null;
      const bearer = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
      const token = accessTokens.get(bearer);
      if (!token) return Response.json({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 });
      if (world.busy)
        return Response.json(
          { error: { message: "User-rate limit exceeded", errors: [{ reason: "rateLimitExceeded" }] } },
          { status: 429 },
        );
      const raw = Buffer.from(JSON.parse(String(init.body)).raw, "base64url").toString();
      world.sent.push({
        from: header(raw, "From"),
        to: header(raw, "To").split(", "),
        subject: header(raw, "Subject"),
        token,
      });
      return Response.json({ id: `msg-${world.sent.length}` });
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
   * Sentry's API on (ADR 0111): the read-only token, and each project's issues as Sentry lists them
   * (`GET /api/0/projects/battersea-cougars/{project}/issues/`), the open ones in the environment asked for. A test
   * puts issues in `issues.team` or `issues.web` (`issue()` makes one), and says `down` (no answer) or `refuses` (the
   * token isn't let in). `asked`: each request's project and query, as Sentry got them.
   */
  function sentry() {
    env.SENTRY_ISSUES_TOKEN = "sentry-issues-test-token";
    const world = {
      issues: { team: [] as SentryIssue[], web: [] as SentryIssue[] },
      asked: [] as { project: string; query: string; statsPeriod: string | null }[],
      down: false,
      refuses: false,
    };
    serve((url, init) => {
      const m = /^https:\/\/de\.sentry\.io\/api\/0\/projects\/battersea-cougars\/(team|web)\/issues\/(\?.*)?$/.exec(
        url,
      );
      if (!m) return null;
      const q = new URL(url).searchParams;
      world.asked.push({ project: m[1], query: q.get("query") ?? "", statsPeriod: q.get("statsPeriod") });
      if (world.down) throw new Error("connect ETIMEDOUT");
      const auth = new Headers(init.headers).get("authorization");
      if (world.refuses || auth !== `Bearer ${env.SENTRY_ISSUES_TOKEN}`)
        return Response.json({ detail: "Invalid token" }, { status: 401 });
      const environment = /environment:(\S+)/.exec(q.get("query") ?? "")?.[1];
      const open = world.issues[m[1] as "team" | "web"].filter(
        (i) => i.status === "unresolved" && (!environment || i.environment === environment),
      );
      // Sentry gives its fields, not the environment it was filtered by
      return Response.json(open.map(({ environment: _e, ...i }) => i));
    });
    let n = 0;
    /** An issue as Sentry has it: `count` a string, as Sentry gives it. */
    const issue = (o: Partial<SentryIssue> & { title: string }): SentryIssue => {
      n++;
      return {
        id: String(4000 + n),
        shortId: `TEAM-${n}`,
        culprit: "GET /api/bootstrap",
        count: "1",
        userCount: 1,
        level: "error",
        status: "unresolved",
        environment: "dev",
        firstSeen: NOW.toISOString(),
        lastSeen: NOW.toISOString(),
        permalink: `https://battersea-cougars.sentry.io/issues/${4000 + n}/`,
        ...o,
      };
    };
    return Object.assign(world, { issue });
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

  /** The cron triggers' notification drain (index.ts `scheduled`: a five-minute run's batch), at this time. */
  const cron = (now: Date) => invocation(() => drainPush(env, now));
  /**
   * One run of a Cron Trigger, whole, as Cloudflare runs it (index.ts `scheduled`, inside Sentry's wrapper, which
   * wants the execution context): every job it does, in one invocation, with what it left to waitUntil finished in it.
   */
  const scheduled = (trigger: "* * * * *" | "*/5 * * * *" | "7 * * * *", now: Date) =>
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
      const spent = fresh();
      const res = await invocation(
        () =>
          handleApi(
            new Request(`${host}${path}`, {
              method,
              headers: Object.entries(sent).filter((e): e is [string, string] => e[1] !== null),
              body: payload === undefined ? undefined : JSON.stringify(payload),
            }),
            env,
            now,
          ),
        spent,
      );
      spentBy.set(res, spent.d1);
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
      return { status: res.status, body: isJson ? await res.json() : {}, headers: res.headers, d1: spentBy.get(res)! };
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
    /** The next event (not a comment, nor the hub's heartbeat), as {event, data}. */
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
          const event = field("event") ?? "message";
          if (data === undefined || event === "ping") continue;
          return { event, data: JSON.parse(data) };
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
    gmail,
    webPush,
    turnstile,
    sentry,
    /** A device's passkeys (testing.authenticator.ts): real keys, real signatures. */
    authenticator,
    cron,
    scheduled,
    luck,
  };
}
