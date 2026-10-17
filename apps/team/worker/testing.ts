// The fake world the Worker's tests run in (ADR 0031): an in-memory D1 with every migration and a small roster,
// and browsers that keep the cookies the app sets. On a "local" server nothing is emailed, so a sign-in code comes
// back in the reply; tests sign in with it the way a member types it.
import { outbox, type Mail } from "@cougars/shared/email";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { FIRST_KUMITE_SQL } from "@cougars/shared/testing/kumite";
import { parseRoster, rosterSql } from "../../../scripts/lib/roster.mjs";
import { handleApi, type Env } from "./api/api";
import { LiveHub } from "./live/live";
import { pushOutbox, type Sent } from "./push/push";

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

export function testWorld(roster: object[]) {
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
      const res = await handleApi(
        new Request(`${host}${path}`, {
          method,
          headers: Object.entries(sent).filter((e): e is [string, string] => e[1] !== null),
          body: payload === undefined ? undefined : JSON.stringify(payload),
        }),
        env,
        now,
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

  return { db, env, live, browser, ask, signedIn, mails, pushes };
}
