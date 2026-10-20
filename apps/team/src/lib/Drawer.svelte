<script lang="ts">
  // A side drawer for a quick job on top of the page (the register): it slides in from the right and leaves the
  // page visible beside it on desktop. Escape, the close button or the scrim close it. On a phone it's the one
  // overlay every job uses there (ADR 0103): lib/Sheet, tall, as it opens; kept that way while it's open.
  import type { Snippet } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { easeOut, fadeMs } from "../app/motion";
  import Icon from "../app/shell/Icon.svelte";
  import { portal } from "./portal";
  import Sheet from "./Sheet.svelte";
  import { drawnAsSheet } from "./sheet";
  import { phone } from "./viewport.svelte";

  let {
    open = $bindable(false),
    title,
    sub,
    head,
    top,
    children,
    footer,
    wide = false,
  }: {
    open?: boolean;
    title: string;
    sub?: string;
    /** Beside the title (a status badge). */
    head?: Snippet;
    /** Under the header, outside the scroll (stats and a search that stay put). */
    top?: Snippet;
    children: Snippet;
    footer?: Snippet;
    /** A form that needs the room (Charge a quarter): wider on desktop; phones are full width anyway. */
    wide?: boolean;
  } = $props();

  // What it was when it last opened: kept while it's open (lib/sheet.ts)
  let wasSheet = phone.current;
  const asSheet = $derived.by(() => (wasSheet = drawnAsSheet(open, wasSheet, phone.current)));

  function onkeydown(e: KeyboardEvent) {
    // The sheet is a native dialog: its Escape closes the top layer only
    if (asSheet) return;
    // A pop-over's own Escape (DateField, Select) closes just the pop-over
    if (open && e.key === "Escape" && !e.defaultPrevented) open = false;
  }
</script>

<svelte:window {onkeydown} />

{#if asSheet}
  <Sheet bind:open {title} {sub} {head} {top} {footer} tall lazy>{@render children()}</Sheet>
{:else}
  <!-- In <body>, so the scrim covers the dock and the desktop corners too (lib/portal.ts) -->
  <div class="layer" use:portal>
    {#if open}
      <button class="scrim" aria-label="Close" onclick={() => (open = false)} transition:fade={{ duration: fadeMs }}
      ></button>
      <div
        class="drawer"
        class:wide
        role="dialog"
        aria-modal="true"
        aria-label={title}
        transition:fly={{ x: 420, duration: 320, easing: easeOut, opacity: 1 }}
      >
        <header>
          <div class="titles">
            <h2>{title}</h2>
            {#if sub}<p class="hint">{sub}</p>{/if}
          </div>
          {@render head?.()}
          <button class="btn ghost icon close-x" aria-label="Close" onclick={() => (open = false)}>
            <Icon name="x" size={18} />
          </button>
        </header>
        {#if top}<div class="top">{@render top()}</div>{/if}
        <div class="body">{@render children()}</div>
        {#if footer}<footer>{@render footer()}</footer>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .layer {
    display: contents;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 70;
    border: 0;
    padding: 0;
    background: color-mix(in srgb, var(--bg) 40%, transparent);
  }
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 71;
    display: flex;
    flex-direction: column;
    width: min(26rem, 100vw);
    border-left: 1px solid var(--border-strong);
    background: var(--surface-1);
    box-shadow: var(--shadow-pop);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: max(var(--s-4), env(safe-area-inset-top)) var(--s-4) var(--s-3) var(--s-5);
    border-bottom: 1px solid var(--border);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--fg);
  }
  .top {
    display: grid;
    gap: var(--s-4);
    padding: var(--s-4) var(--s-5) 0;
  }
  .body {
    /* min-height: 0 lets the body shrink below its content, so it scrolls instead of pushing the footer off */
    flex: 1;
    min-height: 0;
    display: grid;
    align-content: start;
    /* Rows keep their full height (a .list clips, so it would otherwise shrink to fit); the body scrolls instead */
    grid-auto-rows: max-content;
    gap: var(--s-4);
    padding: var(--s-4) var(--s-5) var(--s-5);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  footer {
    padding: var(--s-3) var(--s-5) max(var(--s-4), env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }
  .drawer.wide {
    width: min(36rem, 100vw);
  }
  /* Opened on a desktop, then narrowed past the phone breakpoint: full width until it closes */
  @media (max-width: 900px) {
    .drawer,
    .drawer.wide {
      width: 100vw;
      border-left: 0;
    }
  }
</style>
