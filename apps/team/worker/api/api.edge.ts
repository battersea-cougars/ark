// What's the same for everyone who sees the club alike, read from D1 once and kept (ADR 0053): in this isolate's
// memory, then in Cloudflare's Cache API (only on a custom domain; on *.workers.dev it does nothing). Each phone's own
// rows are never kept for anyone else.
import type { EdgeRead, Part, Parts, Viewer } from "./api.club";

// Bounded, so a long day's keys can't grow it for ever; the oldest goes first
const MAX_ENTRIES = 64;
// Each database's own: in the tests, every fake world is a database of its own, so none sees another's rows. As JSON,
// not the rows themselves: shaping may change a row in place, and the next reader wants it as it was read
const memories = new WeakMap<D1Database, Map<string, string>>();
// A day: each key's own versions say when it's out of date, so this only clears what's no longer asked for
const KEPT_SECONDS = 86_400;

// The Cache API stores Responses under URLs; this host is never fetched, it only names entries
const edgeUrl = (key: string) => `https://club.cougars.internal/${encodeURIComponent(key)}`;
const edgeCache = (): Cache | null => (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;

/** What a viewer may see, without who they are: the same for everyone of a role on a day. */
const seen = ({ memberId: _m, viewedBy: _v, now: _n, ...flags }: Viewer) => JSON.stringify(flags);

/** Where a read's shared parts are kept and found. */
export interface Keeping {
  db: D1Database;
  viewer: Viewer;
  /** The deploy: a new build may read differently. */
  build: string;
  /** Whose tournament, for one tournament's read; the club's, else. */
  scope: string;
  /** The versions of everything the parts are made of, as one string. */
  versions: string;
  /** Work after the reply (the Cache API's write). */
  later?: (work: Promise<unknown>) => void;
}

/** The edge read readClub takes: these parts, kept for everyone of this viewer's sort at these versions. */
export function kept({ db, viewer, build, scope, versions, later }: Keeping): EdgeRead {
  const memory = memories.get(db) ?? new Map<string, string>();
  memories.set(db, memory);
  // Never stale: a key names the deploy, the scope, every part's version and what the viewer may see (never who they
  // are), so a change to any of them is a new key and an old one is never asked for again. On Workers Free an edge hit
  // still counts as a request; it saves D1's rows and the Worker's time
  const keyOf = (parts: readonly Part[]) =>
    [build, scope, versions, seen(viewer), [...parts].sort().join(",")].join("|");
  return {
    async get(parts) {
      const key = keyOf(parts);
      const here = memory.get(key);
      if (here) return JSON.parse(here) as Partial<Parts>;
      // Not logged: the edge cache is an optimisation, and a miss only means this phone's parts are read from D1
      const hit = await edgeCache()
        ?.match(edgeUrl(key))
        .catch(() => undefined);
      if (!hit) return null;
      const text = await hit.text();
      remember(memory, key, text);
      return JSON.parse(text) as Partial<Parts>;
    },
    put(parts, rows) {
      const key = keyOf(parts);
      const text = JSON.stringify(rows);
      remember(memory, key, text);
      const edge = edgeCache();
      if (!edge) return;
      const reply = new Response(text, {
        headers: { "content-type": "application/json", "cache-control": `max-age=${KEPT_SECONDS}` },
      });
      // A failed write only means the next phone reads D1
      const written = edge.put(edgeUrl(key), reply).catch(() => {});
      if (later) later(written);
    },
  };
}

function remember(memory: Map<string, string>, key: string, text: string) {
  memory.delete(key);
  memory.set(key, text);
  if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
}
