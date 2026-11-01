// A series' History, read a page at a time (#175, ADR 0074; worker/tournaments/editions.routes.ts): the played ones,
// newest first, each a line of what it was, and the all-time leaders as the Worker counts them. Kept while the app's
// open, so going back to History is instant; asked about again (with its tag, a 304 if unchanged) when it's next
// shown after the club's tournaments change.
import type { Season } from "@cougars/shared/seasons";
import type { LeaderRow } from "../lib/leaders";
import type { Tournament } from "../demo/model";
import { readTagged } from "./api";

/** A played edition in a line (worker/tournaments/editions.ts summaryOf). */
export interface EditionSummary {
  id: number;
  typeId: number | null;
  name: string;
  heldOn: string;
  season: Season | null;
  startTime: string;
  endTime: string;
  venueId: number | null;
  location: string;
  feePence: number;
  kind: "draft" | "teams";
  capacity: number | null;
  status: string;
  going: number;
  teams: { id: number; name: string; logo: string | null; captainMemberId: number | null }[];
  champion: number | null;
  final: {
    homeTeamId: number | null;
    awayTeamId: number | null;
    homeGoals: number | null;
    awayGoals: number | null;
  } | null;
  games: number;
}

/** One series' played ones (or every series': `typeId` null), as far as they've been read. */
export class PastList {
  editions = $state<EditionSummary[]>([]);
  /** Where the next page starts; null: there's no more. */
  next = $state<string | null>(null);
  loading = $state(false);
  /** The first page has come (an empty History is said only then). */
  read = $state(false);
  #tag: string | null = null;

  constructor(readonly typeId: number | null) {}

  get #path() {
    return this.typeId === null ? "/api/tournaments/editions" : `/api/tournament-types/${this.typeId}/editions`;
  }

  /** The first page, again: unchanged since, nothing more is read. */
  async refresh() {
    this.loading = true;
    try {
      const { data, tag } = await readTagged<{ editions: EditionSummary[]; next: string | null }>(
        this.#path,
        this.#tag,
      );
      this.#tag = tag;
      if (data) [this.editions, this.next] = [data.editions, data.next];
      this.read = true;
    } finally {
      this.loading = false;
    }
  }

  /** The page after the last one read, if there is one. */
  async more() {
    if (this.loading || !this.next) return;
    this.loading = true;
    try {
      const { data } = await readTagged<{ editions: EditionSummary[]; next: string | null }>(
        `${this.#path}?before=${this.next}`,
        null,
      );
      if (!data) return;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- not shown: the store is what pages read
      const seen = new Set(this.editions.map((e) => e.id));
      this.editions = [...this.editions, ...data.editions.filter((e) => !seen.has(e.id))];
      this.next = data.next;
    } finally {
      this.loading = false;
    }
  }
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not shown: the store is what pages read
const lists = new Map<number | null, PastList>();
/** The series' list, kept while the app's open. */
export function pastList(typeId: number | null) {
  let list = lists.get(typeId);
  if (!list) lists.set(typeId, (list = new PastList(typeId)));
  return list;
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not shown: the store is what pages read
const leaders = new Map<number, { rows: LeaderRow[]; tag: string | null }>();
/** Every played edition's leaders in the series, counted by the Worker. */
export async function allTimeLeaders(typeId: number): Promise<LeaderRow[]> {
  const held = leaders.get(typeId);
  const { data, tag } = await readTagged<{ leaders: LeaderRow[] }>(
    `/api/tournament-types/${typeId}/leaders`,
    held?.tag ?? null,
  );
  const rows = data?.leaders ?? held?.rows ?? [];
  leaders.set(typeId, { rows, tag });
  return rows;
}

/**
 * A played one as Settings → Tournaments' schedule shows a row of it, before it's read in full: what the row says
 * (its day, place, fee, how many were in, its teams, Done). Opening it reads it whole (app/editions.svelte.ts).
 */
export const rowOf = (e: EditionSummary): Tournament =>
  ({
    ...e,
    mapUrl: "",
    status: "finished",
    games: [],
    going: Array.from({ length: e.going }, () => 0),
    waitlist: [],
    teams: e.teams.map((t) => ({ ...t, captainName: "", contact: "", pick: null, players: [] })),
  }) as unknown as Tournament;
