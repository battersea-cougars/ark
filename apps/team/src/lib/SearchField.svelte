<script lang="ts">
  // Search at the top of a list. The clear button keeps its place, so typing never moves anything. `collapsible`:
  // just the magnifier, round, until you tap it; then it widens into the field (to --open-width, the row by
  // default), and narrows back when you leave it empty.
  import Icon from "../app/shell/Icon.svelte";

  let {
    value = $bindable(""),
    placeholder = "Search",
    label = "Search",
    collapsible = false,
  }: { value?: string; placeholder?: string; label?: string; collapsible?: boolean } = $props();
  let input = $state<HTMLInputElement | undefined>();
</script>

<label class="search" class:collapsible class:filled={!!value}>
  <Icon name="search" size={16} />
  <input
    type="search"
    bind:this={input}
    bind:value
    {placeholder}
    aria-label={label}
    onkeydown={(e) => {
      if (e.key === "Escape" && collapsible) {
        value = "";
        input?.blur();
      }
    }}
  />
  <button type="button" class="clear" aria-label="Clear search" hidden={!value} onclick={() => (value = "")}>
    <Icon name="x" size={14} />
  </button>
</label>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    width: min(100%, 20rem);
    height: 2.5rem;
    padding: 0 var(--s-2) 0 var(--s-3);
    /* A pill of faint glass, no edge to speak of, a touch brighter while you type. Where it lies over something (a
       phone's tabs), the page sets --search-frost so that blurs away behind it */
    border: 1px solid color-mix(in srgb, var(--fg) 6%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--fg) 5%, transparent);
    backdrop-filter: var(--search-frost, none);
    -webkit-backdrop-filter: var(--search-frost, none);
    color: var(--fg-muted);
    transition:
      background-color var(--t-fast) var(--ease-in-out),
      border-color var(--t-fast) var(--ease-in-out);
  }
  .search:focus-within {
    border-color: color-mix(in srgb, var(--fg) 12%, transparent);
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    color: var(--fg-body);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-sm);
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .clear {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-muted);
  }
  .clear[hidden] {
    display: grid;
    visibility: hidden;
  }
  /* Phones: it fills the row, leaving room for a small control beside it */
  @media (max-width: 900px) {
    .search {
      flex: 1 1 12rem;
      width: auto;
      min-width: 0;
    }
  }
  /* Collapsible: open, it's the field at --open-width; closed (empty, not in use), a round magnifier the size of an
     icon button, quiet until hovered. The width eases between the two; what's past the edge is clipped */
  .search.collapsible {
    flex: none;
    width: var(--open-width, 100%);
    overflow: hidden;
    padding-left: calc((2.5rem - 2px - 16px) / 2);
    transition:
      width var(--t-slow) var(--ease),
      background-color var(--t-fast) var(--ease-in-out),
      border-color var(--t-fast) var(--ease-in-out);
  }
  .search.collapsible:not(:focus-within, .filled) {
    width: 2.5rem;
    border-color: transparent;
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    box-shadow: none;
    cursor: pointer;
  }
  .search.collapsible:not(:focus-within, .filled):hover {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    color: var(--fg);
  }
  .search.collapsible:not(:focus-within, .filled) input {
    cursor: pointer;
  }
  .search.collapsible:not(:focus-within, .filled) input::placeholder {
    color: transparent;
  }
</style>
