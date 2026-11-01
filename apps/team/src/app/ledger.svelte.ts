// A member's dues ledger, read a page at a time (#177, ADR 0007; worker/dues/dues.ledger.ts): every charge and
// payment, newest first, each line with what they owed after it, worked out by the server. Opening the app sends only
// your unpaid charges and what each owes; the ledger is read when the Dues tab or the member sheet shows it, more as
// it scrolls. Kept while the app's open; after any change to dues (the store's `dues` comes back) a ledger shown is
// read again, as far down as it had been read (with its tag: unchanged, an empty 304), so a line taken back deep in it
// doesn't jump to the top.
// What a night or a tournament collected is read the same way, for its editor.
import type { LedgerLine } from "../lib/dues";
import { readTagged } from "./api";

interface Page {
  lines: LedgerLine[];
  next: string | null;
  paid?: number;
  quarters?: string[];
}

/** Lines a page, as the app scrolls; and the most read again at once after a change (the Worker's limit). */
const PAGE = 30;
const MOST = 200;

/** One member's ledger, as far as it's been read. */
export class Ledger {
  lines = $state<LedgerLine[]>([]);
  next = $state<string | null>(null);
  /** What they've paid in all, and the quarters charged lately (member sheet → Charge a quarter). */
  paid = $state(0);
  quarters = $state<string[]>([]);
  loading = $state(false);
  /** The first page has come: "nothing yet" is said only then. */
  read = $state(false);
  #tag: string | null = null;
  /** Asked again while a read was on its way: read once more after it. */
  #again = false;

  constructor(readonly memberId: number) {}

  get #path() {
    return `/api/members/${this.memberId}/ledger`;
  }

  /**
   * Read again, as far down as before: when it's shown, and after each change to dues (the page's effect follows the
   * store's `dues`). Unchanged, an empty 304.
   */
  async show(): Promise<void> {
    if (this.loading) return void (this.#again = true);
    this.loading = true;
    try {
      const limit = Math.min(MOST, Math.max(PAGE, this.lines.length));
      const { data, tag } = await readTagged<Page>(`${this.#path}?limit=${limit}`, this.#tag);
      this.#tag = tag;
      if (data)
        [this.lines, this.next, this.paid, this.quarters] = [
          data.lines,
          data.next,
          data.paid ?? 0,
          data.quarters ?? [],
        ];
      this.read = true;
    } finally {
      this.loading = false;
    }
    if (this.#again) {
      this.#again = false;
      await this.show();
    }
  }

  /** The page after the last one read, if there is one. */
  async more() {
    if (this.loading || !this.next) return;
    this.loading = true;
    try {
      const { data } = await readTagged<Page>(`${this.#path}?limit=${PAGE}&before=${this.next}`, null);
      if (!data) return;
      this.lines = [...this.lines, ...data.lines];
      this.next = data.next;
    } finally {
      this.loading = false;
    }
  }
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not shown: the store is what pages read
const ledgers = new Map<number, Ledger>();
/** A member's ledger, kept while the app's open. */
export function ledgerOf(memberId: number) {
  let l = ledgers.get(memberId);
  if (!l) ledgers.set(memberId, (l = new Ledger(memberId)));
  return l;
}

// ─── What a night or a tournament collected ───

export interface Collected {
  refId: number;
  due: number;
  paid: number;
  people: number;
  paidPeople: number;
}

/**
 * What these nights and tournaments were due and collected (the editors'), read from the server: from how many, for
 * anyone who edits them; the money, for who sees everyone's dues (the rest is nothing).
 */
export async function readCollected(which: { sessions?: number[]; tournaments?: number[] }) {
  const query = [
    which.sessions?.length ? `sessions=${which.sessions.join(",")}` : "",
    which.tournaments?.length ? `tournaments=${which.tournaments.join(",")}` : "",
  ].filter(Boolean);
  if (!query.length) return { sessions: [], tournaments: [] };
  const { data } = await readTagged<{ sessions: Collected[]; tournaments: Collected[] }>(
    `/api/dues/collected?${query.join("&")}`,
    null,
  );
  return data ?? { sessions: [], tournaments: [] };
}
