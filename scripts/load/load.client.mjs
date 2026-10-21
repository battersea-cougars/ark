// Members' phones for a load run (docs/load-testing.md): each signed in as itself, with its own address unless the run
// says they share one (the rink's wifi), doing what the team app does: the bootstrap with its ETag (ADR 0053), a
// change with the page's Origin, and a live page's stream (ADR 0072), reloading on an event naming a part it follows.

/** Every request's time and answer, by what it was (`label`). */
export class Stats {
  constructor() {
    this.rows = [];
    this.errors = new Map();
    this.started = performance.now();
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

/**
 * A member's phone: `call` for a request (timed into `stats`), `boot` for the bootstrap with its ETag, `follow` for a
 * live page's stream.
 */
export async function phone(url, email, stats, { address } = {}) {
  const origin = new URL(url).origin;
  const base = { ...(address ? { "cf-connecting-ip": address } : {}) };
  const res = await fetch(`${url}/api/auth/dev`, {
    method: "POST",
    headers: { ...base, "content-type": "application/json", origin },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Couldn't sign in ${email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
  const { memberId } = await res.json();
  let etag = null;
  let club = null;

  async function call(label, method, path, payload, headers = {}) {
    const t = performance.now();
    let status = 0;
    let body;
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
    } catch (e) {
      body = { error: String(e) };
    }
    stats.add(label, performance.now() - t, status, body?.error);
    return { status, body };
  }

  /** The club, as the app reads it: a 304 when nothing's changed since its last copy. */
  async function boot(label = "bootstrap") {
    const r = await call(label, "GET", "/api/bootstrap", undefined, etag ? { "if-none-match": etag } : {});
    if (r.status === 200) club = r.body;
    return club;
  }

  /**
   * A live page: the stream open, and on each event naming a part in `parts`, a reload (`onChange` after it). Returns
   * a stop function. Events and the time from a change to this phone having reloaded go into `stats`.
   */
  function follow(parts, onChange = () => {}) {
    const ctl = new AbortController();
    const done = (async () => {
      const t = performance.now();
      const r = await fetch(`${url}/api/live`, { headers: { ...base, cookie }, signal: ctl.signal }).catch(() => null);
      stats.add("live: connect", performance.now() - t, r?.status ?? 0);
      if (!r?.ok || !r.body) return;
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      // Each event its own check, as the app does (live-updates.svelte.ts: no waiting for the last one)
      const reload = async (heardAt) => {
        await boot("live: reload");
        stats.add("live: change to screen", performance.now() - heardAt, 200);
        onChange(club);
      };
      for (;;) {
        const { value, done: end } = await reader.read().catch(() => ({ done: true }));
        if (end) return;
        buffered += decoder.decode(value, { stream: true });
        for (let at = buffered.indexOf("\n\n"); at >= 0; at = buffered.indexOf("\n\n")) {
          const block = buffered.slice(0, at);
          buffered = buffered.slice(at + 2);
          const data = block
            .split("\n")
            .find((l) => l.startsWith("data:"))
            ?.slice(5);
          if (!data) continue;
          let changed;
          try {
            changed = JSON.parse(data).changed ?? [];
          } catch {
            changed = parts;
          }
          if (changed.some((p) => parts.includes(p))) {
            stats.add("live: event", 0, 200);
            reload(performance.now());
          }
        }
      }
    })();
    return async () => {
      ctl.abort();
      await done.catch(() => {});
    };
  }

  return { email, memberId, call, boot, follow, club: () => club };
}

/** Phones for these members, signed in a few at a time. `shared`: all from one address (a rink's wifi). */
export async function phones(url, emails, stats, { shared = false } = {}) {
  const out = [];
  for (let i = 0; i < emails.length; i += 10)
    out.push(
      ...(await Promise.all(
        emails.slice(i, i + 10).map((e, k) =>
          phone(url, e, stats, {
            address: shared ? "10.0.0.1" : `10.1.${Math.floor((i + k) / 250)}.${(i + k) % 250}`,
          }),
        ),
      )),
    );
  return out;
}
