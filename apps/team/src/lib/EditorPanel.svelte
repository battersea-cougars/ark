<script lang="ts">
  // A card, opened: the modal editor every non-player card opens into (Settings → Training, Settings → Tournaments),
  // as Gwenda ops opens its sessions. It fills the space the page has, beside the dock and under the top bar (on a
  // phone, the whole screen): a header with what it is and a close button top right, then a body that scrolls on
  // its own. It zooms in as it opens and out as it closes. Player cards flip instead (PlayerCardZoom, MemberSheet).
  // On a phone it's the one overlay every job uses there (ADR 0103): lib/Sheet, tall, decided as it opens.
  import { onMount, type Snippet } from "svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { pageColumnStyle } from "./page-column";
  import type { IconName } from "../app/shell/icons";
  import { EASE_IN, EASE_OUT, prefersReducedMotion } from "../app/motion";
  import { portal } from "./portal";
  import Sheet from "./Sheet.svelte";
  import { phone } from "./viewport.svelte";

  // Opens in the page's own column (desktop), the same width as the cards under it
  // …measured again when the window changes size, so it keeps to the page as the page reflows
  let colStyle = $state(pageColumnStyle());
  let settle: ReturnType<typeof setTimeout> | undefined;
  function remeasure() {
    colStyle = pageColumnStyle();
    // The page's sides ease across when the window crosses a width (the settings list grows): again once they land
    clearTimeout(settle);
    settle = setTimeout(() => (colStyle = pageColumnStyle()), 400);
  }
  let {
    eyebrow,
    title,
    icon,
    tone,
    onclose,
    actions,
    footer,
    children,
  }: {
    eyebrow: string;
    title: string;
    icon?: IconName;
    tone?: string;
    onclose: () => void;
    /** Buttons in the header, left of the close button. */
    actions?: Snippet;
    /** The footer bar along the bottom, actions on the right (Save), as every Gwenda modal has. */
    footer?: Snippet;
    children: Snippet;
  } = $props();

  let panel = $state<HTMLElement | undefined>();
  let closing = false;
  // Mounted as it opens: a phone then gets the sheet, kept while it's open
  const asSheet = phone.current;
  let shown = $state(true);
  const ZOOM_IN = [
    { transform: "scale(0.94)", filter: "blur(8px)", opacity: 0 },
    { transform: "none", filter: "blur(0)", opacity: 1 },
  ];

  onMount(() => {
    if (asSheet) return;
    panel?.focus({ preventScroll: true });
    if (!prefersReducedMotion) panel?.animate(ZOOM_IN, { duration: 380, easing: EASE_OUT });
  });

  export function close() {
    if (closing) return;
    closing = true;
    // The sheet goes down the way every sheet does, then says it's closed
    if (asSheet) return void (shown = false);
    if (prefersReducedMotion || !panel) return onclose();
    panel.animate([...ZOOM_IN].reverse(), { duration: 220, easing: EASE_IN, fill: "forwards" }).onfinish = () =>
      onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    // The sheet is a native dialog: its Escape closes the top layer only
    if (asSheet) return;
    // A menu's own Escape (Select) closes just the menu
    if (e.key === "Escape" && !e.defaultPrevented) close();
  }
</script>

<svelte:window {onkeydown} onresize={remeasure} />

{#if asSheet}
  <Sheet
    bind:open={shown}
    {title}
    sub={eyebrow}
    head={actions}
    {footer}
    tall
    onclose={() => {
      closing = true;
      onclose();
    }}>{@render children()}</Sheet
  >
{:else}
  <div class="editor-layer" use:portal>
    <button class="scrim" aria-label="Close" tabindex="-1" onclick={close}></button>
    <div
      class="panel"
      style={colStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-title"
      tabindex="-1"
      bind:this={panel}
      style:--tone={tone ? `var(--tone-${tone})` : undefined}
    >
      <header class="panel-head">
        {#if icon}<span class="chip"><Icon name={icon} size={22} /></span>{/if}
        <div class="titles">
          <p class="eyebrow">{eyebrow}</p>
          <h1 id="editor-title">{title}</h1>
        </div>
        <div class="head-actions">
          {@render actions?.()}
          <button class="btn ghost icon close-x" aria-label="Close" onclick={close}><Icon name="x" size={18} /></button>
        </div>
      </header>
      <div class="body">{@render children()}</div>
      {#if footer}<footer class="panel-foot">{@render footer()}</footer>{/if}
    </div>
  </div>
{/if}

<style>
  /* The space the page has: beside the dock, under the top bar. A phone gives it the whole screen. */
  .editor-layer {
    position: fixed;
    inset: 0;
    z-index: 80;
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    animation: fade-in 260ms var(--ease) both;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  .panel {
    position: absolute;
    inset: 4.5rem var(--s-6) var(--s-6) 6.25rem;
    /* In the page's column when there is one: its left edge and width */
    left: var(--col-left, 6.25rem);
    right: auto;
    width: var(--col-width, calc(100% - 6.25rem - var(--s-6)));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-xl);
    background: var(--surface-1);
    box-shadow: 0 30px 80px -30px rgb(0 0 0 / 0.8);
    transform-origin: 50% 40%;
    outline: none;
  }
  @media (max-width: 900px) {
    .panel {
      inset: 0;
      width: auto;
      max-width: none;
      border: 0;
      border-radius: 0;
    }
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-5) var(--s-5) var(--s-4) var(--s-6);
    border-bottom: 1px solid var(--border);
  }
  .chip {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 3rem;
    height: 3rem;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--tone, var(--fg)) 16%, transparent);
    color: var(--tone, var(--fg));
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h1 {
    margin: var(--s-1) 0 0;
    overflow: hidden;
    color: var(--fg);
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 3vw, 2rem);
    font-style: italic;
    font-weight: 400;
    line-height: 1.05;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    align-self: flex-start;
  }
  .body {
    flex: 1;
    min-height: 0;
    padding: var(--s-5) var(--s-6) var(--s-6);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  /* Always in view at the bottom: the panel's own actions, on the right */
  .panel-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-5);
    padding-bottom: max(var(--s-3), env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }
  @media (max-width: 600px) {
    .panel-head {
      padding: var(--s-4);
    }
    .chip {
      display: none;
    }
    .body {
      padding: var(--s-4) var(--s-4) var(--s-6);
    }
  }
</style>
