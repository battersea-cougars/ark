<script lang="ts">
  // A series' or a tournament's awards (ADR 0044), in its editor: a row each, read as text (its name, its line, how
  // it's decided as a quiet tag), which opens the award's sheet (lib/AwardSheet) to change it. Up to 8. An award
  // saved before it said how shows the old guess from its name (lib/awards.ts withDecidedBy, as the editor loads it),
  // so saving keeps what it did. Which award is open is `open`, one value its editor can hold (and a URL drive).
  import Icon from "../app/shell/Icon.svelte";
  import AwardSheet from "./AwardSheet.svelte";
  import { decidedByOf, decidedByTag, fromKey, type Award } from "./awards";

  let {
    awards = $bindable(),
    open = $bindable(null),
  }: {
    awards: Award[];
    /** The award whose sheet is open, by its place in the list; null: none. */
    open?: number | null;
  } = $props();
  const MAX_AWARDS = 8;

  // Added just now: its sheet says New award, and it goes again if it's closed without a name
  let added = $state<number | null>(null);
  function add() {
    awards.push({ name: "", about: "", decidedBy: fromKey("live") });
    added = open = awards.length - 1;
  }
  // Closing: the sheet stays while it slides away, then goes
  let leaving = $state<number | null>(null);
  const shown = $derived(open ?? leaving);
  function closed(i: number) {
    if (open !== i) return;
    open = null;
    if (added === i && !awards[i]?.name.trim()) awards.splice(i, 1);
    else leaving = i;
    added = null;
  }
</script>

{#if awards.length}
  <ul class="awards">
    {#each awards as award, i (i)}
      <li>
        <button type="button" class="award" onclick={() => (open = i)}>
          <span class="text">
            <span class="name">{award.name || "Unnamed"}</span>
            {#if award.about}<span class="about">{award.about}</span>{/if}
          </span>
          <span class="tag">{decidedByTag(decidedByOf(award))}</span>
          <Icon name="chevronRight" size={16} />
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <p class="hint">No awards yet.</p>
{/if}
{#if awards.length < MAX_AWARDS}
  <button type="button" class="btn sm add" onclick={add}><Icon name="plus" size={16} />Add an award</button>
{/if}

{#if shown !== null && awards[shown]}
  {@const i = shown}
  <AwardSheet
    bind:award={awards[i]}
    bind:open={() => open === i, (v) => !v && closed(i)}
    isNew={added === i}
    onclose={() => (leaving = null)}
    onremove={() => {
      open = leaving = added = null;
      awards.splice(i, 1);
    }}
  />
{/if}

<style>
  .awards {
    display: grid;
    gap: 2px;
    /* Short enough that the tag stays by the name it's for */
    max-width: 44rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* A row that reads as text: its name and line, how it's decided at the end; a faint fill under the pointer */
  .award {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--s-1) var(--s-4);
    align-items: center;
    width: 100%;
    min-height: 3.25rem;
    padding: var(--s-2) var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: var(--fg-subtle);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease);
  }
  .award:hover,
  .award:focus-visible {
    background: var(--surface-2);
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    color: var(--fg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .about {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    color: var(--fg-muted);
    font-size: var(--text-xs);
    text-align: right;
  }
  .add {
    justify-self: start;
  }
  /* Narrow: the tag goes under the line */
  @container (max-width: 34rem) {
    .award {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .tag {
      grid-row: 2;
      text-align: left;
    }
    .award > :global(svg) {
      grid-row: 1 / span 2;
      grid-column: 2;
    }
  }
</style>
