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
  }
</script>

<script lang="ts">
  // A Manage menu's jobs (ADR 0065), thumb-sized, a filled row each, no lines: every page's Manage menu and the
  // calendar's New event (lib/ManageMenu opens them). `go` runs one (the menu closes first).
  import Icon from "../app/shell/Icon.svelte";

  let { items, go }: { items: ManageItem[]; go: (run: () => void) => void } = $props();
</script>

<div class="tools">
  {#each items as item (item.label)}
    <button class="tool" class:danger={item.danger} style:--tone={item.tone} onclick={() => go(item.run)}>
      <Icon name={item.icon} size={22} />
      <span class="tool-text"><strong>{item.label}</strong><span>{item.sub}</span></span>
      <Icon name="chevronRight" size={18} />
    </button>
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
  .tool:active {
    background: var(--surface-3);
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
