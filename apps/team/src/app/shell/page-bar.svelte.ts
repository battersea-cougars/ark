import type { Snippet } from "svelte";
import { FormOwner } from "../../lib/dirty";

/**
 * What the shell and the page on screen exchange. The page (PageHeader) lends the shell its actions and filters:
 * the phone bar shows the actions and puts the filters behind a Filters button, in a sheet. The shell lends the
 * page its section's strip (Games, Standings, Draft), which the desktop header shows as pills in its toolbar row.
 */
export const pageBar: {
  actions?: Snippet;
  filters?: Snippet;
  /** How many filters are on: the number on the Filters button. */
  active: number;
  onclear?: () => void;
  /** The section's pages, from the shell; the current one by id. */
  strip: { id: string; path: string; label: string }[];
  current: string;
} = $state({ active: 0, strip: [], current: "" });

/**
 * Which page's header has lent the bar its actions now. A page arriving claims it before the one leaving has gone, so
 * the leaving one clears only what's still its own; kept out of reactive state, which a teardown reads as it was
 * (lib/dirty.ts FormOwner).
 */
export const barOwner = new FormOwner<symbol>();
