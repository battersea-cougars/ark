<script lang="ts" module>
  import type { IconName } from "../app/shell/icons";
  export type SelectOption<T extends string = string> = {
    value: T;
    label: string;
    disabled?: boolean;
    /** On a member's pick (Choice): what it is, at a glance */
    icon?: IconName;
    /** On a member's pick: a line under it (a price, what it covers) */
    hint?: string;
  };
</script>

<script lang="ts" generics="T extends string">
  // Styled select for admin forms (a tournament's details, a member's role); a member's own choices use Choice, taps
  // and sheets, not a drop-down. After Gwenda ops' NativeSelect: native option menus can't be themed, so this is a button that
  // opens a listbox. The menu is fixed-position so panels and scrollers never clip it, and it lives at the end of
  // the page (or of the open dialog it's in), so nothing it sits inside, an animated tab say, can shift it.
  import { portal } from "./overlay";
  import { onMount, tick } from "svelte";
  import Icon from "../app/shell/Icon.svelte";

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

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();
  let menuStyle = $state("");
  let active = $state(-1);

  const label = $derived(options.find((o) => o.value === value)?.label ?? "Select…");
  const enabled = $derived(options.flatMap((o, i) => (o.disabled ? [] : [i])));

  function place() {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const gap = 6;
    const below = innerHeight - r.bottom - gap - 12;
    const above = r.top - gap - 12;
    const up = below < 160 && above > below;
    const height = Math.min(280, up ? above : below);
    const top = up ? Math.max(12, r.top - gap - height) : r.bottom + gap;
    menuStyle = `top:${Math.round(top)}px;left:${Math.round(r.left)}px;min-width:${Math.round(r.width)}px;max-height:${Math.round(height)}px`;
  }

  /** Moves the menu out to the page, or to the native modal it's in: that sits above the page. */
  function focusActive() {
    const el = menu?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!menu || !el) return;
    // In view in the menu only (a long list, the times of day: the one set in the middle), never the page under it
    el.focus({ preventScroll: true });
    if (el.offsetTop < menu.scrollTop || el.offsetTop + el.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = el.offsetTop - (menu.clientHeight - el.offsetHeight) / 2;
  }

  async function setOpen(next: boolean) {
    open = next;
    if (!next) return void (active = -1);
    const current = options.findIndex((o) => o.value === value);
    active = current >= 0 ? current : (enabled[0] ?? -1);
    await tick();
    place();
    // Its height is set now: then the one chosen is brought into view
    await tick();
    focusActive();
  }

  function choose(o: SelectOption<T>) {
    if (o.disabled) return;
    const changed = value !== o.value;
    value = o.value;
    if (changed) onchange?.(o.value);
    void setOpen(false);
    trigger?.focus();
  }

  function onTriggerKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      void setOpen(true);
    }
  }

  function onMenuKey(e: KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      void setOpen(false);
      trigger?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!enabled.length) return;
      const at = enabled.indexOf(active);
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = enabled[at < 0 ? 0 : (at + step + enabled.length) % enabled.length];
      focusActive();
    }
  }

  onMount(() => {
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (open && !trigger?.contains(t) && !menu?.contains(t)) void setOpen(false);
    };
    const onMove = () => open && place();
    addEventListener("pointerdown", onPointer, true);
    addEventListener("resize", onMove);
    addEventListener("scroll", onMove, true);
    return () => {
      removeEventListener("pointerdown", onPointer, true);
      removeEventListener("resize", onMove);
      removeEventListener("scroll", onMove, true);
    };
  });
</script>

<div class="wrap {className}" class:open>
  <button
    bind:this={trigger}
    type="button"
    class="input trigger {size}"
    {id}
    aria-label={ariaLabel && `${ariaLabel}: ${label}`}
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => void setOpen(!open)}
    onkeydown={onTriggerKey}
  >
    <span class="label">{label}</span>
    <span class="chevron"><Icon name="chevronDown" size={16} /></span>
  </button>

  {#if open}
    <div bind:this={menu} use:portal class="menu" style={menuStyle} role="listbox" tabindex="-1" onkeydown={onMenuKey}>
      {#each options as o, i (o.value)}
        <button
          type="button"
          class="option"
          class:active={i === active}
          id="{id}-opt-{i}"
          data-index={i}
          role="option"
          aria-selected={o.value === value}
          disabled={o.disabled}
          onclick={() => choose(o)}
          onpointerenter={() => (active = i)}
        >
          {o.label}
          {#if o.value === value}<Icon name="check" size={16} />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    min-width: 0;
  }
  .trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding-right: var(--s-3);
    text-align: left;
    cursor: pointer;
  }
  .trigger:disabled {
    color: var(--fg-subtle);
    cursor: not-allowed;
  }
  .trigger:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--fg) 24%, transparent);
  }
  .trigger.sm {
    height: var(--control-h-sm);
    padding: 0 var(--s-2) 0 var(--s-3);
    font-size: var(--text-sm);
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chevron {
    color: var(--fg-muted);
    transition: transform var(--t-fast) var(--ease);
  }
  .open .chevron {
    transform: rotate(180deg);
  }

  .menu {
    position: fixed;
    /* Above the editor panel (80) it may open from */
    z-index: 90;
    display: grid;
    gap: 2px;
    padding: var(--s-1);
    overflow: auto;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface-2);
    box-shadow: var(--shadow-pop);
    animation: pop var(--t-fast) var(--ease);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    min-height: var(--control-h-sm);
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-body);
    font-size: var(--text-sm);
    text-align: left;
    white-space: nowrap;
  }
  .option:focus {
    outline: none;
  }
  .option.active:not(:disabled) {
    background: var(--surface-3);
    color: var(--fg);
  }
  .option[aria-selected="true"] {
    color: var(--fg);
    font-weight: 600;
  }
  .option[aria-selected="true"] :global(svg) {
    color: var(--red-hot);
  }
  .option:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
