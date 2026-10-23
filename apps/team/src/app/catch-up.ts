// Keeping a phone's copy of the club up to date as the live hub says what changed (ADR 0072, #112), at the least cost
// in D1's rows read: the free day's limit a busy evening passes when every phone reads the whole club for every change.
//
// The club's data version goes up by one with every change, and each of the hub's events names the parts that changed
// and the versions they came with. The copy knows the version it holds all of (`held`), and so which parts it lacks:
// on an event naming a part a page follows, it reads just the parts it lacks (`/api/slices`), not the whole club. A
// version it never heard of (a change that told nobody, a stream that dropped) leaves it short, and the next whole
// check reads the club; a whole check at the version held is a 304.
//
// A live match comes with its event (#161): it's the same for every member, so the Worker builds it once and the hub
// sends it along. A copy that holds the version just before puts it in place as it is, and reads nothing; any other
// copy reads as the names say, so a missed event costs a read, never a wrong screen.
//
// One read at a time, after a short random wait, so a burst of events is one read, and 120 phones don't all ask in
// the same instant. Nothing while the page is out of view: coming back checks the whole club anyway.
//
// No imports, and only what Node can run as it is: the load runs' phones use this too (scripts/load/load.client.mjs).

/** A live match as the hub sends it (#161): a tournament's games, as every member sees them. */
export interface PushedMatch {
  tournamentId: number;
  games: unknown[];
}

/** What the hub sends with a change, besides its names: the data version the change made, and the match. */
export interface Pushed {
  version: number;
  match: PushedMatch;
}

/** What changed, as the hub says it: the parts, the data versions that changed them, and any match sent along. */
export interface Heard {
  changed: readonly string[];
  versions: readonly number[];
  parts?: readonly Pushed[];
}

/** The part of the club a match goes into: the change that made it changed nothing else (api/api.ts). */
const MATCH_IN = "tournaments";

/** The tournaments with this match's games in place, or null when its tournament isn't among them (read instead). */
export function withMatch<T extends { id: number }>(tournaments: T[] | undefined, match: PushedMatch): T[] | null {
  if (!tournaments?.some((t) => t.id === match.tournamentId)) return null;
  return tournaments.map((t) => (t.id === match.tournamentId ? { ...t, games: match.games } : t));
}

/** How the copy reads and stores; the app's are in backend.svelte.ts, the load runs' phones have their own. */
export interface CopyIO {
  /** These parts of the club, and the data version they were read at (or after). */
  readParts(names: string[]): Promise<{ version: number; slices: Record<string, unknown> }>;
  /** The whole club, if it's changed since the version held: it calls `wholeAt` when it reads it. */
  readWhole(): Promise<void>;
  /** Put these parts in place. */
  apply(slices: Record<string, unknown>): void;
  /** Put a match the hub sent in place (`withMatch`); false: the copy has no such tournament. None: always read. */
  applyMatch?(match: PushedMatch): boolean;
  /** Whether the page is in view. */
  visible(): boolean;
  /** The longest random wait before a read, in ms. */
  waitMs?: number;
  random?: () => number;
}

/** Parts that change what someone may see (their roles and actions): those come with the whole club. */
const WHOLE: readonly string[] = ["members", "roles", "everydayRole"];

export class ClubCopy {
  /** Every change up to this version is in the copy. */
  held = 0;
  /** Changes heard of past the version held, by version: the parts each changed. */
  private readonly heard = new Map<number, readonly string[]>();
  /** Parts read past the version held: the version each was read at. */
  private readonly fresh = new Map<string, number>();
  /** What the pages in view follow, a list a page. */
  private readonly following = new Set<readonly string[]>();
  private readonly io: CopyIO;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flying = false;
  private stopped = false;
  /** An event that didn't say its versions (a Worker from before they did): only the whole club can tell. */
  private unsure = false;

  constructor(io: CopyIO) {
    this.io = io;
  }

  /** A page follows these parts while it's open; the function it returns stops it. */
  follow(parts: readonly string[]): () => void {
    this.following.add(parts);
    return () => {
      this.following.delete(parts);
    };
  }

  /** The whole club is in the copy, as at this version: what was read in parts before it is gone with it. */
  wholeAt(version: number) {
    this.held = version;
    this.fresh.clear();
    for (const v of this.heard.keys()) if (v <= version) this.heard.delete(v);
    this.advance();
  }

  /**
   * These parts were read at this version (a read, or a change's own reply): the ones newer than what the copy holds
   * of them, which the caller puts in place. A read that left before a newer one came back is older: it's dropped.
   */
  partsAt(version: number, slices: Record<string, unknown>): Record<string, unknown> {
    const newer = Object.entries(slices).filter(([name]) => version >= Math.max(this.held, this.fresh.get(name) ?? 0));
    for (const [name] of newer) this.fresh.set(name, version);
    this.advance();
    return Object.fromEntries(newer);
  }

  /**
   * The hub says this changed: a match it sent that follows on from the version held goes in place; anything else
   * the copy now lacks is read, soon, if a page follows it (with whatever else it lacks, in the same read).
   */
  hear({ changed, versions = [], parts = [] }: Partial<Heard> & Pick<Heard, "changed">) {
    for (const v of versions) if (v > this.held) this.heard.set(v, changed);
    this.advance();
    for (const part of [...parts].sort((a, b) => a.version - b.version)) this.take(part);
    if (!versions.length && changed.some((c) => this.followed().has(c))) this.unsure = true;
    if (this.unsure || this.lacking(true).length) this.soon();
  }

  /**
   * A match sent with its change. That change changed only the match's tournament (api/api.ts), so it's all of it:
   * holding the version just before, and nothing newer of the tournaments, the copy puts it in place and moves on.
   */
  private take({ version, match }: Pushed) {
    if (version <= this.held) return;
    this.heard.set(version, [MATCH_IN]);
    if (version !== this.held + 1 || (this.fresh.get(MATCH_IN) ?? 0) >= version) return this.advance();
    if (!this.io.applyMatch?.(match)) return;
    this.fresh.set(MATCH_IN, version);
    this.advance();
  }

  /** The parts the copy lacks a change to; `followed`, only if a page follows one of them. */
  lacking(followed = false): string[] {
    const out = new Set<string>();
    for (const [v, parts] of this.heard) for (const p of parts) if ((this.fresh.get(p) ?? 0) < v) out.add(p);
    const names = [...out];
    if (!followed) return names;
    const wanted = this.followed();
    return names.some((n) => wanted.has(n)) ? names : [];
  }

  private followed() {
    return new Set([...this.following].flat());
  }

  /** Stop: nothing more is read (the tests, a load run's phone closing). */
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  // The version held moves on while the next change is heard of and every part it changed is in
  private advance() {
    for (;;) {
      const parts = this.heard.get(this.held + 1);
      if (!parts || parts.some((p) => (this.fresh.get(p) ?? 0) < this.held + 1)) break;
      this.heard.delete(++this.held);
    }
    for (const [name, v] of this.fresh) if (v <= this.held) this.fresh.delete(name);
  }

  /** A read after a short random wait; one at a time, so whatever's heard meanwhile goes in the next. */
  private soon() {
    if (this.timer || this.flying || this.stopped) return;
    const wait = (this.io.random ?? Math.random)() * (this.io.waitMs ?? 1000);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.read();
    }, wait);
  }

  private async read() {
    // Out of view: coming back checks the whole club anyway
    if (!this.io.visible()) return;
    const names = this.lacking();
    if (!names.length && !this.unsure) return;
    this.flying = true;
    let ok = false;
    try {
      if (this.unsure || names.some((n) => WHOLE.includes(n))) {
        this.unsure = false;
        await this.io.readWhole();
      } else {
        const { version, slices } = await this.io.readParts(names);
        this.io.apply(this.partsAt(version, slices));
      }
      ok = true;
    } catch {
      // Refused, offline, or the brake says wait: the page's own check on its beat catches up
    } finally {
      this.flying = false;
    }
    if (ok && (this.unsure || this.lacking(true).length)) this.soon();
  }
}
