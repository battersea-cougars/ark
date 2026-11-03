<script lang="ts" module>
  import type { IconName } from "../app/shell/icons";
  /** One job in a Manage menu: its icon, what it does, a line on it. */
  export interface ManageItem {
    icon: IconName;
    label: string;
    sub: string;
    run: () => void;
    /** Can't be taken back: its words in red. */
    danger?: boolean;
    /** Its icon in a colour (a CSS colour): what kind of thing it makes, as the calendar shows that kind. */
    tone?: string;
    /** Can't be done now (no goal to take back): shown, greyed. */
    disabled?: boolean;
    /** Where things are already (the team they're on): said, not offered. */
    here?: boolean;
    /** Done at once, nothing opens: no chevron. */
    now?: boolean;
    /** A tap-twice job (lib/arm.svelte.ts) waiting for its second tap: its words in red, the row ringed. */
    armed?: boolean;
    /** Its tap keeps the menu open (the first of a tap-twice): `run` is called, not `go`. */
    stays?: boolean;
  }
  /** A line between the jobs, saying why some aren't there (the register's closed). */
  export interface ManageNote {
    note: string;
  }
</script>

<script lang="ts">
  // A Manage menu's jobs (ADR 0065), thumb-sized, a filled row each, no lines: every page's Manage menu and the
  // calendar's New event (lib/ManageMenu opens them). `go` runs one (the menu closes first).
  import Icon from "../app/shell/Icon.svelte";

  let { items, go }: { items: (ManageItem | ManageNote)[]; go: (run: () => void) => void } = $props();
</script>

<div class="tools">
  {#each items as item, i ("note" in item ? `note ${i}` : item.label)}
    {#if "note" in item}
      <p class="tool-note hint">{item.note}</p>
    {:else}
      <button
        class="tool"
        class:danger={item.danger}
        class:here={item.here}
        class:armed={item.armed}
        style:--tone={item.tone}
        disabled={item.disabled || item.here}
        onclick={() => (item.stays ? item.run() : go(item.run))}
      >
        <Icon name={item.icon} size={22} />
        <span class="tool-text"><strong>{item.label}</strong><span>{item.sub}</span></span>
        {#if !item.now && !item.here}<Icon name="chevronRight" size={18} />{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .tools {
    display: grid;
    gap: var(--s-2);
  }
  .tool {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    min-height: 4.25rem;
    padding: var(--s-3) var(--s-4);
    border: 0;
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--fg-muted);
    font: inherit;
    text-align: left;
  }
  .tool > :global(svg:first-child) {
    flex-shrink: 0;
    color: var(--tone, currentColor);
  }
  .tool:active:not(:disabled) {
    background: var(--surface-3);
  }
  .tool:disabled {
    opacity: 0.5;
  }
  .tool.here {
    opacity: 1;
    background: none;
  }
  /* The second tap's the real one: said in red, the only red here */
  .tool.armed {
    box-shadow: inset 0 0 0 1.5px var(--red-hot);
  }
  .tool.armed strong {
    color: var(--red-hot);
  }
  .tool-note {
    margin: 0;
    padding: var(--s-2) var(--s-4);
  }
  .tool-text {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }
  .tool-text strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .tool-text span {
    font-size: var(--text-sm);
  }
  /* Gone for good: the words in red, the row as the rest (the confirm's red fill is the tap that does it) */
  .tool.danger,
  .tool.danger strong {
    color: var(--red-hot);
  }
</style>
