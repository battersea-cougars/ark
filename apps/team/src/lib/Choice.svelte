<script lang="ts" generics="T extends string">
  import type { SelectOption } from "./Select.svelte";
  // A choice for members (no drop-downs; admin forms use Select): a few short options as a segmented row, one tap
  // each; a longer list a row that opens them as big rows, a sheet on a phone, a side drawer on a desktop.
  import Icon from "../app/shell/Icon.svelte";
  import Drawer from "./Drawer.svelte";
  import Sheet from "./Sheet.svelte";
  import { phone } from "./viewport.svelte";

  let {
    value = $bindable(),
    options,
    size = "md",
    id = "sel",
    class: className = "",
    "aria-label": ariaLabel,
    onchange,
  }: {
    value: T;
    options: SelectOption<T>[];
    size?: "md" | "sm";
    id?: string;
    class?: string;
    "aria-label"?: string;
    /** After the value changes by a pick (not when the parent sets it). */
    onchange?: (value: T) => void;
  } = $props();

  // Few and short enough to sit side by side
  const inline = $derived(options.length <= 5 && options.reduce((n, o) => n + o.label.length, 0) <= 40);
  const label = $derived(options.find((o) => o.value === value)?.label ?? "Choose…");
  let open = $state(false);

  function choose(o: SelectOption<T>) {
    if (o.disabled) return;
    const changed = value !== o.value;
    value = o.value;
    if (changed) onchange?.(o.value);
    open = false;
  }
</script>

{#snippet list()}
  <div class="options" role="listbox" aria-label={ariaLabel}>
    {#each options as o (o.value)}
      <button
        type="button"
        class="option"
        role="option"
        aria-selected={o.value === value}
        disabled={o.disabled}
        onclick={() => choose(o)}
      >
        <span>{o.label}</span>
        {#if o.value === value}<Icon name="check" size={18} />{/if}
      </button>
    {/each}
  </div>
{/snippet}

{#if inline}
  <!-- The brand's Pick: separate tiles, the chosen one lit red; with hints, tiles with a line under each -->
  <div
    class="seg block wrap-seg {className}"
    class:sm={size === "sm"}
    class:tiles={options.some((o) => o.hint)}
    {id}
    role="group"
    aria-label={ariaLabel}
  >
    {#each options as o (o.value)}
      <button type="button" aria-pressed={o.value === value} disabled={o.disabled} onclick={() => choose(o)}>
        {#if o.icon}<Icon name={o.icon} size={o.hint ? 22 : 18} />{/if}
        {#if o.hint}<span class="name">{o.label}</span><span class="sub">{o.hint}</span>{:else}{o.label}{/if}
      </button>
    {/each}
  </div>
{:else}
  <button
    type="button"
    class="input trigger {size} {className}"
    {id}
    aria-label={ariaLabel}
    onclick={() => (open = true)}
  >
    <span class="label">{label}</span>
    <Icon name="chevronRight" size={16} />
  </button>
  {#if phone.current}
    <Sheet bind:open title={ariaLabel ?? "Choose"}>{@render list()}</Sheet>
  {:else}
    <Drawer bind:open title={ariaLabel ?? "Choose"}>{@render list()}</Drawer>
  {/if}
{/if}

<style>
  /* The segments wrap rather than run off a phone */
  .wrap-seg {
    flex-wrap: wrap;
  }
  .trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    text-align: left;
    cursor: pointer;
  }
  .trigger.sm {
    height: var(--control-h-sm);
    font-size: var(--text-sm);
  }
  .label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .options {
    display: grid;
    gap: var(--s-1);
  }
  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    min-height: 3.5rem;
    padding: 0 var(--s-4);
    border: 0;
    border-radius: var(--r-lg);
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-md);
    text-align: left;
  }
  .option:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .option[aria-selected="true"] {
    background: var(--surface-2);
    font-weight: 600;
  }
  .option:disabled {
    opacity: 0.4;
  }
</style>
