<script lang="ts">
  // The app's one side drawer (ADR 0065): every job that opens over a page on a desktop or tablet, from a
  // menu (Manage) to a form (Add player) to an editor (lib/EditorPanel, in the page's column). It slides in from the
  // right; on a phone it's the one overlay every job uses there, lib/Sheet, tall, decided as it opens and kept that
  // way while it's open. Both keep one close contract (lib/overlay.ts): a native modal dialog, so focus stays in it
  // and the page under it is inert and doesn't scroll; Escape closes the top one only; a click on the dimmed page
  // closes it only when it was pressed and let go there; the × closes it; focus goes back to what opened it. Every
  // one of those asks first when its form has unsaved changes (`edits`, lib/dirty.svelte.ts).
  import type { Snippet } from "svelte";
  import { fly } from "svelte/transition";
  import { easeOut, prefersReducedMotion } from "../app/motion";
  import Icon from "../app/shell/Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { drawnAsSheet } from "./sheet";
  import { phone } from "./viewport.svelte";
  import { backdropClicks, lockScroll, outside, rememberFocus, requestClose } from "./overlay";
  import { pageColumnStyle } from "./page-column";
  import type { Edits } from "./dirty.svelte";

  let {
    open = $bindable(false),
    title,
    sub,
    head,
    top,
    children,
    footer,
    wide = false,
    page = false,
    side = false,
    fill = false,
    tone,
    edits,
    onclose,
  }: {
    open?: boolean;
    title: string;
    sub?: string;
    /** Beside the title (a status badge, an editor's own buttons). */
    head?: Snippet;
    /** Under the header, outside the scroll (stats and a search that stay put). */
    top?: Snippet;
    children: Snippet;
    footer?: Snippet;
    /** A form that needs the room (Charge a quarter): wider on desktop; phones are full width anyway. */
    wide?: boolean;
    /** An editor (lib/EditorPanel): in the page's own column, its left edge and width, not at the window's side. */
    page?: boolean;
    /** From the right on a phone too, not the phone's sheet: a list worked beside the page (the draft's players). */
    side?: boolean;
    /** The body lays itself out to the drawer's height, with its own scrolling and foot (lib/Wizard). */
    fill?: boolean;
    /** A colour the contents pick up (`--tone`): a training's, a series'. */
    tone?: string;
    /** Its form's unsaved changes: closing with some asks first, in its footer (lib/SaveBar). */
    edits?: Edits;
    /** Once it's closed and gone, however it was closed. */
    onclose?: () => void;
  } = $props();

  // What it was when it last opened: kept while it's open (lib/sheet.ts)
  let wasSheet = phone.current;
  const asSheet = $derived.by(() => !side && (wasSheet = drawnAsSheet(open, wasSheet, phone.current)));
  let sheet = $state<Sheet | undefined>();
  let dialog = $state<HTMLDialogElement | undefined>();
  let leaving = $state(false);

  /** The one way out: asks first if there are unsaved changes. */
  export function close() {
    if (asSheet) return sheet?.close();
    requestClose(() => (open = false), edits?.guard);
  }

  // An editor's column, measured as it opens and again as the window changes (lib/page-column.ts)
  let colStyle = $state("");
  let settle: ReturnType<typeof setTimeout> | undefined;
  function remeasure() {
    if (!page) return;
    colStyle = pageColumnStyle();
    // The page's sides ease across when the window crosses a width (the settings list grows): again once they land
    clearTimeout(settle);
    settle = setTimeout(() => (colStyle = pageColumnStyle()), 400);
  }

  /** Open as a modal from the moment it's there; the page locked and focus remembered until it goes. */
  function modal(node: HTMLDialogElement) {
    if (page) colStyle = pageColumnStyle();
    const unlock = lockScroll();
    const refocus = rememberFocus();
    node.showModal();
    return {
      destroy() {
        unlock();
        refocus();
      },
    };
  }

  const backdrop = backdropClicks();
  const onBackdrop = (e: MouseEvent) =>
    !!dialog && e.target === dialog && e.detail > 0 && outside(dialog.getBoundingClientRect(), e.clientX, e.clientY);

  function gone() {
    leaving = false;
    edits?.closed();
    onclose?.();
  }
</script>

<svelte:window onresize={remeasure} />

{#if asSheet}
  <Sheet
    bind:this={sheet}
    bind:open
    {title}
    {sub}
    {head}
    {top}
    {footer}
    {fill}
    {edits}
    tall
    lazy
    onclose={() => onclose?.()}>{@render children()}</Sheet
  >
{:else if open}
  <dialog
    bind:this={dialog}
    use:modal
    class="drawer"
    class:wide
    class:page
    class:side
    class:leaving
    style={colStyle}
    style:--tone={tone ? `var(--tone-${tone})` : undefined}
    aria-label={title}
    transition:fly={{
      x: prefersReducedMotion ? 0 : 420,
      duration: prefersReducedMotion ? 0 : 320,
      easing: easeOut,
      opacity: page ? 0 : 1,
    }}
    onoutrostart={() => (leaving = true)}
    onoutroend={gone}
    oncancel={(e) => {
      // Escape (the top dialog's only): the same way out as the ×
      e.preventDefault();
      close();
    }}
    onclose={() => {
      // Closed by the browser without asking (a second Escape straight after the first): open again if it should ask
      if (!open || !dialog) return;
      if (edits?.dirty) {
        dialog.showModal();
        close();
      } else open = false;
    }}
    onpointerdown={(e) => backdrop.press(onBackdrop(e))}
    onclick={(e) => {
      if (backdrop.release(onBackdrop(e))) close();
    }}
  >
    <header>
      <div class="titles">
        <h2>{title}</h2>
        {#if sub}<p class="hint">{sub}</p>{/if}
      </div>
      {@render head?.()}
      <button class="btn ghost icon close-x" aria-label="Close" onclick={close}>
        <Icon name="x" size={18} />
      </button>
    </header>
    {#if top}<div class="top">{@render top()}</div>{/if}
    <div class="body" class:fill>{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </dialog>
{/if}

<style>
  /* At the window's right, its full height */
  .drawer {
    inset: 0 0 0 auto;
    display: flex;
    flex-direction: column;
    width: min(26rem, 100vw);
    max-width: 100vw;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-left: 1px solid var(--border-strong);
    background: var(--surface-1);
    color: var(--fg);
    box-shadow: var(--shadow-pop);
    outline: none;
  }
  /* Drawn only as a modal (a dialog's own display rules give way to the flex above otherwise) */
  .drawer:not([open]) {
    display: none;
  }
  .drawer::backdrop {
    background: color-mix(in srgb, var(--bg) 40%, transparent);
    animation: fade-in 160ms var(--ease) both;
    transition: opacity 220ms var(--ease);
  }
  .drawer.leaving::backdrop {
    opacity: 0;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  .drawer.wide {
    width: min(36rem, 100vw);
  }
  /* An editor: in the page's column (ADR 0065), under the top bar, the cards it opened from grown */
  .drawer.page {
    inset: 4.5rem auto var(--s-6) var(--col-left, 6.25rem);
    width: var(--col-width, calc(100% - 6.25rem - var(--s-6)));
    height: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-xl);
    box-shadow: 0 30px 80px -30px rgb(0 0 0 / 0.8);
  }
  .drawer.page::backdrop {
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  header {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--s-3);
    padding: max(var(--s-4), env(safe-area-inset-top)) var(--s-4) var(--s-3) var(--s-5);
    border-bottom: 1px solid var(--border);
  }
  .page header {
    padding-top: var(--s-4);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
    overflow: hidden;
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--fg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .top {
    display: grid;
    flex-shrink: 0;
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
  .page .body {
    display: block;
    padding: var(--s-5) var(--s-6) var(--s-6);
  }
  .body.fill,
  .page .body.fill {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }
  /* Always in view at the bottom: its actions */
  footer {
    flex-shrink: 0;
    padding: var(--s-3) var(--s-5) max(var(--s-4), env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }
  /* An editor's: on the right, in a row (Delete apart at the start) */
  .page footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-5) max(var(--s-3), env(safe-area-inset-bottom));
  }
  /* Opened on a desktop, then narrowed past the phone breakpoint: full width until it closes. A `side` one stays a
     drawer from the right, leaving a strip of the page to tap off on */
  @media (max-width: 900px) {
    .drawer.side {
      width: min(26rem, calc(100vw - 2.5rem));
    }
    .drawer:not(.side),
    .drawer.wide:not(.side),
    .drawer.page:not(.side) {
      inset: 0;
      width: 100vw;
      height: 100dvh;
      border: 0;
      border-radius: 0;
    }
  }
</style>
