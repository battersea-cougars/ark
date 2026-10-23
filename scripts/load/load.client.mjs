// Members' phones for a load run (docs/load-testing.md): each signed in as itself, with its own address unless the run
// says they share one (the rink's wifi; against dev every phone is this machine's one address), doing what the team
// app does: the bootstrap with its ETag at the version its
// copy holds (ADR 0053), a change with the page's Origin and its reply's parts put in place, and a live page's stream
// (ADR 0072), its copy of the club reading the parts an event names, or taking the live match it brings (the app's own
// catch-up.ts, #112, #161).
import { ClubCopy, withMatch } from "../../apps/team/src/app/catch-up.ts";
import { atVersion, VERSION_HEADER } from "../../apps/team/src/app/club-tag.ts";

/** Every request's time and answer, by what it was (`label`). */
export class Stats {
  constructor() {
    this.rows = [];
    this.errors = new Map();
    this.started = performance.now();
    /** The clock's time at the start, so a request's moment can be put in the rate limiter's minutes. */
    this.startedAt = Date.now();
  }
  add(label, ms, status, why) {
    this.rows.push({ label, ms, status, at: performance.now() - this.started });
    if ((status === 0 || status >= 500 || status === 429) && why) {
      const key = `${label}: ${status} ${String(why).slice(0, 160)}`;
      this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
    }
  }
  labels() {
    return [...new Set(this.rows.map((r) => r.label))];
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

/** Signed in as dev-sign-in does (POST /api/auth/dev): a local server only. */
async function devSignIn(url, email, base) {
  const res = await fetch(`${url}/api/auth/dev`, {
    method: "POST",
    headers: { ...base, "content-type": "application/json", origin: new URL(url).origin },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Couldn't sign in ${email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
  const { memberId } = await res.json();
  return { cookie, memberId };
}

/**
 * A member's phone: `call` for a request (timed into `stats`), `boot` for the bootstrap with its ETag, `follow` for a
 * live page's stream. `target`: { url, signIn? } (load.mjs); with `signIn` (a session minted for it, load.club.mjs)
 * the phone sends that cookie, else it signs in as dev-sign-in does. `address`: the cf-connecting-ip it claims, on a
 * local server only (Cloudflare sets its own).
 */
export async function phone(target, email, stats, { address } = {}) {
  const { url } = target;
  const origin = new URL(url).origin;
  const base = { ...(address ? { "cf-connecting-ip": address } : {}) };
  const { cookie, memberId } = target.signIn ? await target.signIn(email) : await devSignIn(url, email, base);
  let etag = null;
  let club = null;
  /** Whether the last read of the whole club got an answer. */
  let booted = false;
  /** The pages following along, each told when the copy changes. */
  const following = new Set();
  /** When the oldest change not yet on this phone's screen was heard of. */
  let heardAt = null;
  const onScreen = () => {
    if (heardAt !== null) stats.add("live: change to screen", performance.now() - heardAt, 200);
    heardAt = null;
    for (const f of following) f(club);
  };
  const copy = new ClubCopy({
    readParts: async (names) => {
      const r = await call("live: read parts", "GET", `/api/slices?names=${names.join(",")}`);
      if (r.status !== 200) throw new Error(String(r.status));
      return r.body;
    },
    readWhole: async () => {
      await boot("live: read the whole club");
      if (!booted) throw new Error("no club");
      onScreen();
    },
    apply: (slices) => {
      club = { ...club, ...slices };
      onScreen();
    },
    // A live match the hub sent (#161), as the app puts it in place
    applyMatch: (match) => {
      const tournaments = withMatch(club?.tournaments, match);
      if (!tournaments) return false;
      club = { ...club, tournaments };
      onScreen();
      return true;
    },
    visible: () => true,
  });

  async function call(label, method, path, payload, headers = {}) {
    if (target.stopping?.()) return { status: 0, body: { error: "stopped" }, version: null };
    const t = performance.now();
    let status = 0;
    let body;
    let version = null;
    try {
      const r = await fetch(`${url}${path}`, {
        method,
        headers: {
          ...base,
          cookie,
          ...(method === "GET" ? {} : { "content-type": "application/json", origin }),
          ...headers,
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      status = r.status;
      const text = await r.text();
      body = text && (r.headers.get("content-type") ?? "").includes("json") ? JSON.parse(text) : { error: text };
      if (path === "/api/bootstrap" && status === 200) etag = r.headers.get("etag");
      version = Number(r.headers.get(VERSION_HEADER)) || null;
    } catch (e) {
      body = { error: String(e) };
    }
    stats.add(label, performance.now() - t, status, body?.error);
    return { status, body, version };
  }

  /** The club, as the app reads it: a 304 when nothing's changed since the version its copy holds. */
  async function boot(label = "bootstrap") {
    const ask = etag && copy.held ? { "if-none-match": atVersion(etag, copy.held) } : {};
    const r = await call(label, "GET", "/api/bootstrap", undefined, ask);
    if (r.status === 200) {
      club = r.body;
      copy.wholeAt(r.version ?? 0);
    }
    booted = r.status === 200 || r.status === 304;
    return club;
  }

  /** A change, as the app's `save` makes it: the parts its reply brings put in place. */
  async function change(label, method, path, payload) {
    const r = await call(label, method, path, payload);
    if (r.status < 300 && r.body?.changed && r.version) club = { ...club, ...copy.partsAt(r.version, r.body.changed) };
    return r;
  }

  /**
   * A live page: the stream open, each event to the phone's copy of the club, which reads what it lacks if a part in
   * `parts` is among it (`onChange` after). Returns a stop function. Events and the time from a change being heard of
   * to this phone having it go into `stats`.
   */
  function follow(parts, onChange = () => {}) {
    const ctl = new AbortController();
    const unfollow = copy.follow(parts);
    following.add(onChange);
    const done = (async () => {
      const t = performance.now();
      const r = await fetch(`${url}/api/live`, { headers: { ...base, cookie }, signal: ctl.signal }).catch(() => null);
      stats.add("live: connect", performance.now() - t, r?.status ?? 0);
      if (!r?.ok || !r.body) return;
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        const { value, done: end } = await reader.read().catch(() => ({ done: true }));
        if (end) return;
        buffered += decoder.decode(value, { stream: true });
        for (let at = buffered.indexOf("\n\n"); at >= 0; at = buffered.indexOf("\n\n")) {
          const block = buffered.slice(0, at);
          buffered = buffered.slice(at + 2);
          // The hub's heartbeat (a ping every 30 seconds) says nothing changed
          if (!block.split("\n").includes("event: changed")) continue;
          const data = block
            .split("\n")
            .find((l) => l.startsWith("data:"))
            ?.slice(5);
          if (!data) continue;
          let heard;
          try {
            heard = JSON.parse(data);
          } catch {
            heard = { changed: parts };
          }
          if ((heard.changed ?? []).some((p) => parts.includes(p))) stats.add("live: event", 0, 200);
          copy.hear({ changed: heard.changed ?? [], versions: heard.versions, parts: heard.parts });
          // Something to read: from now until it's on the screen
          if (copy.lacking(true).length) heardAt ??= performance.now();
        }
      }
    })();
    return async () => {
      ctl.abort();
      unfollow();
      following.delete(onChange);
      copy.stop();
      await done.catch(() => {});
    };
  }

  return { email, memberId, call, change, boot, follow, copy, club: () => club };
}

/** The address a phone claims on a local server (`shared`: the rink's wifi); none against dev, where it's ours. */
export const addressFor = (target, n, shared) =>
  target.remote ? undefined : shared ? "10.0.0.1" : `10.1.${Math.floor(n / 250)}.${n % 250}`;

/** Phones for these members, signed in a few at a time. `shared`: all from one address (a rink's wifi). */
export async function phones(target, emails, stats, { shared = false } = {}) {
  const out = [];
  for (let i = 0; i < emails.length; i += 10)
    out.push(
      ...(await Promise.all(
        emails.slice(i, i + 10).map((e, k) => phone(target, e, stats, { address: addressFor(target, i + k, shared) })),
      )),
    );
  return out;
}
