<script lang="ts">
  // Find a member by typing (a combobox): the list narrows as you type, arrows move, Enter picks, Escape closes. Like
  // Select, its list is fixed-position at the end of the page so a panel or scroller never clips it. With `value`
  // it shows who's picked and can change them; without (`clearOnPick`), it's an "add someone" box that empties after
  // each pick.
  import { onMount, tick } from "svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { findPeople } from "./person-search";

  let {
    members,
    value = null,
    exclude,
    placeholder = "Type a name…",
    clearOnPick = false,
    id = "person",
    "aria-label": ariaLabel,
    autofocus = false,
    onpick,
    ondone,
  }: {
    members: { id: number; name: string }[];
    value?: number | null;
    /** Members who can't be picked here (already on a team). */
    exclude?: Set<number>;
    placeholder?: string;
    clearOnPick?: boolean;
    id?: string;
    "aria-label"?: string;
    /** Focus it as soon as it shows (changing who's picked). */
    autofocus?: boolean;
    onpick: (id: number) => void;
    /** Escape, or focus left without a pick. */
    ondone?: () => void;
  } = $props();

  const nameOf = (v: number | null) => members.find((m) => m.id === v)?.name ?? "";
  // What's typed; when closed, the picked member's name
  let query = $state("");
  let open = $state(false);
  let active = $state(0);
  let input = $state<HTMLInputElement>();
  let menu = $state<HTMLDivElement>();
  let menuStyle = $state("");

  $effect(() => {
    if (!open) query = clearOnPick ? "" : nameOf(value);
  });

  // Names that start with what's typed first, then names with a word that does, then any match
  const matches = $derived.by(() => {
    const q = (open ? query : "").trim().toLowerCase();
    const pool = members.filter((m) => m.id === value || !exclude?.has(m.id));
    if (!clearOnPick && q === nameOf(value).toLowerCase()) return pool.slice(0, 60);
    return findPeople(pool, q);
  });

  function place() {
    if (!input) return;
    const r = input.getBoundingClientRect();
    const gap = 6;
    const below = innerHeight - r.bottom - gap - 12;
    const above = r.top - gap - 12;
    const up = below < 180 && above > below;
    const height = Math.min(300, up ? above : below);
    const top = up ? Math.max(12, r.top - gap - height) : r.bottom + gap;
    menuStyle = `top:${Math.round(top)}px;left:${Math.round(r.left)}px;width:${Math.round(r.width)}px;max-height:${Math.round(height)}px`;
  }
  function portal(node: HTMLElement) {
    (input?.closest("dialog") ?? document.body).append(node);
    return { destroy: () => node.remove() };
  }

  async function show() {
    if (open) return;
    open = true;
    active = 0;
    await tick();
    place();
    input?.select();
  }
  function hide() {
    open = false;
  }
  function cancel() {
    hide();
    ondone?.();
  }
  function choose(memberId: number) {
    onpick(memberId);
    hide();
    if (clearOnPick) query = "";
    input?.focus();
  }

  async function scrollActive() {
    await tick();
    menu?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return void show();
      if (!matches.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      void scrollActive();
    } else if (e.key === "Enter") {
      // Never submits the form: Enter picks the highlighted member
      e.preventDefault();
      if (open && matches[active]) choose(matches[active].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Tab") {
      cancel();
    }
  }

  onMount(() => {
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (open && !input?.contains(t) && !menu?.contains(t)) cancel();
    };
    if (autofocus) input?.focus();
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

<div class="wrap" class:open>
  <span class="glass" aria-hidden="true"><Icon name="search" size={16} /></span>
  <input
    bind:this={input}
    bind:value={query}
    class="input"
    {id}
    {placeholder}
    autocomplete="off"
    role="combobox"
    aria-label={ariaLabel}
    aria-expanded={open}
    aria-controls="{id}-list"
    aria-autocomplete="list"
    aria-activedescendant={open && matches[active] ? `${id}-opt-${active}` : undefined}
    onfocus={show}
    onclick={show}
    oninput={() => {
      active = 0;
      void show();
    }}
    onkeydown={onKey}
  />

  {#if open}
    <div bind:this={menu} use:portal class="menu" id="{id}-list" style={menuStyle} role="listbox">
      {#each matches as m, i (m.id)}
        <div
          class="option"
          class:active={i === active}
          id="{id}-opt-{i}"
          data-index={i}
          role="option"
          tabindex="-1"
          aria-selected={m.id === value}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => choose(m.id)}
          onkeydown={() => {}}
          onpointerenter={() => (active = i)}
        >
          {m.name}
          {#if m.id === value}<Icon name="check" size={16} />{/if}
        </div>
      {:else}
        <p class="none">Nobody called “{query.trim()}”.</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    min-width: 0;
  }
  .glass {
    position: absolute;
    top: 50%;
    left: var(--s-3);
    display: flex;
    color: var(--fg-subtle);
    translate: 0 -50%;
    pointer-events: none;
  }
  .input {
    width: 100%;
    padding-left: calc(var(--s-3) + 16px + var(--s-2));
  }
  .menu {
    position: fixed;
    /* Above the editor panel (80) it may open from */
    z-index: 90;
    display: grid;
    align-content: start;
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
    border-radius: var(--r-sm);
    color: var(--fg-body);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .option.active {
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
  .none {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
</style>
