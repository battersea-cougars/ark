<script lang="ts">
  /**
   * The phone's one overlay (ADR 0103): a sheet up from the bottom, with a handle you can pull down to close it. A short
   * job (Filters, + Event) is sized to what's in it; a `tall` one (a drawer's list, an editor) rises near the top and
   * scrolls inside, its header and footer staying put. lib/Drawer and lib/EditorPanel are drawn as this on a phone.
   * On a desktop it's a centred modal. A native modal dialog, so it sits above everything, traps focus and closes on
   * Escape (and Android's back); a full click on the dimmed page closes it too. Nothing on the page moves when it opens.
   * Every way out asks first when its form has unsaved changes (`edits`), as lib/Drawer does (lib/overlay.ts).
   */
  import type { Snippet } from "svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { EASE_IN, prefersReducedMotion } from "../app/motion";
  import { phone } from "./viewport.svelte";
  import { swipeCloses } from "./sheet";
  import { backdropClicks, lockScroll, outside, rememberFocus, requestClose } from "./overlay";
  import type { Edits } from "./dirty.svelte";

  let {
    open = $bindable(false),
    title,
    sub,
    onclose,
    head,
    top,
    children,
    footer,
    tall = false,
    fill = false,
    lazy = false,
    edits,
  }: {
    open?: boolean;
    title: string;
    /** A line under the title. */
    sub?: string;
    /** After it closes, however it was closed (for a parent that keeps its own state rather than binding). */
    onclose?: () => void;
    /** Beside the title (a status badge, an editor's own buttons). */
    head?: Snippet;
    /** Under the header, outside the scroll (stats and a search that stay put). */
    top?: Snippet;
    children: Snippet;
    footer?: Snippet;
    /** Something that grows (a list, the register, an editor): near full height on a phone, scrolling inside. */
    tall?: boolean;
    /** What's in it lays itself out to the sheet's height, with its own scrolling and foot (lib/Wizard). */
    fill?: boolean;
    /** Its contents exist only while it's open (a drawer's, which expect to start afresh each time). */
    lazy?: boolean;
    /** Its form's unsaved changes (lib/dirty.svelte.ts): closing with some asks first, in its footer (lib/SaveBar). */
    edits?: Edits;
  } = $props();

  /** The one way out: asks first if there are unsaved changes. */
  export function close() {
    requestClose(() => (open = false), edits?.guard);
  }
  // While it's open: the page under it stays put, and focus goes back where it was once it's closed
  let unlock: (() => void) | undefined;
  let refocus: (() => void) | undefined;
  function shown() {
    unlock = lockScroll();
    refocus = rememberFocus();
  }

  let dialog = $state<HTMLDialogElement | undefined>();
  // Sliding away: still open (and its contents still there) until the motion ends
  let leaving = $state(false);
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const LEAVE_MS = 220;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      shown();
      dialog.showModal();
    } else if (open && leaving) stay();
    else if (!open && dialog.open) leave();
  });

  /** Out the way it came: down off a phone, fading on a desktop; then really closed. */
  function leave() {
    if (!dialog || leaving) return;
    if (prefersReducedMotion) return dialog.close();
    leaving = true;
    const from = dialog.style.translate || "0 0";
    const frames = phone.current
      ? [{ translate: from }, { translate: "0 100%" }]
      : [{ opacity: 1 }, { opacity: 0, translate: "0 8px", scale: "0.98" }];
    dialog.animate(frames, { duration: LEAVE_MS, easing: EASE_IN, fill: "forwards" });
    leaveTimer = setTimeout(() => {
      leaving = false;
      dialog?.getAnimations().forEach((a) => a.cancel());
      if (dialog) dialog.style.translate = "";
      dialog?.close();
    }, LEAVE_MS);
  }
  /** Opened again while it was leaving: it stays. */
  function stay() {
    clearTimeout(leaveTimer);
    leaving = false;
    dialog?.getAnimations().forEach((a) => a.cancel());
    if (dialog) dialog.style.translate = "";
  }

  // A click on the dimmed page closes it: pressed and let go there. Selecting a field's text and letting go outside
  // the sheet is a click on the dialog too, and mustn't close it.
  const backdrop = backdropClicks();
  const onBackdrop = (e: MouseEvent) =>
    !!dialog && e.detail > 0 && outside(dialog.getBoundingClientRect(), e.clientX, e.clientY);
  function closed() {
    // Closed by the browser without asking (a second Escape straight after the first): still open if it should ask
    if (open && !leaving && edits?.dirty && dialog) {
      dialog.showModal();
      return void close();
    }
    stay();
    open = false;
    unlock?.();
    refocus?.();
    edits?.closed();
    onclose?.();
  }

  // Pulled down by its handle or header (a phone): it follows the finger, and closes if let go far enough down or
  // flicked; otherwise it settles back. Only the header, so the list inside still scrolls. A touch-only shortcut:
  // the close button, Escape and a tap outside do the same for everyone else.
  function pullToClose(node: HTMLElement) {
    let drag: { y: number; t: number; id: number } | undefined;
    let pulled = 0;
    function grab(e: PointerEvent) {
      if (!phone.current || !dialog || leaving || (e.target as Element).closest("button, a, input, select, textarea"))
        return;
      drag = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
      pulled = 0;
      node.setPointerCapture(e.pointerId);
    }
    function pull(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.id || !dialog) return;
      pulled = Math.max(0, e.clientY - drag.y);
      dialog.style.translate = `0 ${pulled}px`;
    }
    function letGo(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.id || !dialog) return;
      const ms = e.timeStamp - drag.t;
      drag = undefined;
      if (swipeCloses(pulled, ms, dialog.offsetHeight) && requestClose(() => (open = false), edits?.guard)) return;
      if (pulled > 0 && !prefersReducedMotion)
        dialog.animate([{ translate: `0 ${pulled}px` }, { translate: "0 0" }], { duration: 200, easing: "ease-out" });
      dialog.style.translate = "";
    }
    const on = [
      ["pointerdown", grab],
      ["pointermove", pull],
      ["pointerup", letGo],
      ["pointercancel", letGo],
    ] as const;
    for (const [type, fn] of on) node.addEventListener(type, fn);
    return { destroy: () => on.forEach(([type, fn]) => node.removeEventListener(type, fn)) };
  }
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  class:tall
  class:leaving
  aria-label={title}
  onclose={closed}
  oncancel={(e) => {
    // Escape or Android's back: out with the same motion as the close button
    e.preventDefault();
    close();
  }}
  onpointerdown={(e) => backdrop.press(e.target === dialog && onBackdrop(e))}
  onclick={(e) => {
    if (backdrop.release(e.target === dialog && onBackdrop(e))) close();
  }}
>
  {#if !lazy || open || leaving}
    <div class="head" use:pullToClose>
      <span class="handle" aria-hidden="true"></span>
      <div class="titles">
        <h2 class="title">{title}</h2>
        {#if sub}<p class="hint">{sub}</p>{/if}
      </div>
      {@render head?.()}
      <button class="btn ghost icon close-x" aria-label="Close" onclick={close}><Icon name="x" size={18} /></button>
    </div>
    {#if top}<div class="top">{@render top()}</div>{/if}
    <div class="body" class:fill>{@render children()}</div>
    {#if footer}<div class="foot">{@render footer()}</div>{/if}
  {/if}
</dialog>

<style>
  .sheet {
    width: 100%;
    max-width: 100%;
    max-height: 85dvh;
    margin: auto 0 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    background: var(--surface-1);
    color: var(--fg);
    box-shadow: var(--shadow-pop);
  }
  /* Header and footer stay put; what's between them scrolls */
  .sheet[open] {
    display: flex;
    flex-direction: column;
    animation: up var(--t-slow) var(--ease);
  }
  /* Something that grows: the same sheet, near the top, the same height however much is in it */
  .sheet.tall {
    height: calc(100dvh - max(var(--s-6), env(safe-area-inset-top)));
    max-height: none;
  }
  .sheet::backdrop {
    background: color-mix(in srgb, var(--bg) 60%, transparent);
    transition: opacity 220ms var(--ease);
  }
  .sheet.leaving::backdrop {
    opacity: 0;
  }
  @keyframes up {
    from {
      translate: 0 100%;
    }
  }
  @keyframes pop {
    from {
      translate: 0 12px;
      scale: 0.97;
    }
  }
  .head {
    position: relative;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-4) var(--gutter) var(--s-3);
    /* The finger pulls the sheet, not the page */
    touch-action: none;
  }
  /* The grip: says it can be pulled down */
  .handle {
    position: absolute;
    top: var(--s-2);
    left: 50%;
    width: 2.25rem;
    height: 4px;
    translate: -50% 0;
    border-radius: 2px;
    background: var(--border-strong);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: var(--text-md);
    font-weight: 600;
  }
  .top {
    display: grid;
    flex-shrink: 0;
    gap: var(--s-4);
    padding: 0 var(--gutter) var(--s-4);
  }
  .body {
    /* min-height: 0 lets it shrink below its content, so it scrolls instead of pushing the footer off */
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    align-content: start;
    /* Rows keep their full height (a .list clips, so it would otherwise shrink to fit); the body scrolls instead */
    grid-auto-rows: max-content;
    gap: var(--s-4);
    padding: 0 var(--gutter) max(var(--s-5), env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  /* Filled by something with its own scrolling and foot: the edges are its to keep */
  .body.fill {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }
  .foot {
    display: flex;
    flex-shrink: 0;
    gap: var(--s-2);
    padding: var(--s-3) var(--gutter) max(var(--s-4), env(safe-area-inset-bottom));
  }
  .body:has(+ .foot) {
    padding-bottom: var(--s-2);
  }
  .foot > :global(.btn) {
    flex: 1;
  }
  /* After the phone rules, so the desktop ones win */
  @media (min-width: 901px) {
    .sheet,
    .sheet.tall {
      width: min(30rem, calc(100vw - 4rem));
      /* A dialog's own fit-content: centred, sized to what's in it */
      height: fit-content;
      max-height: 85dvh;
      margin: auto;
      border-radius: var(--r-xl);
    }
    .sheet[open] {
      animation: pop var(--t-slow) var(--ease);
    }
    .head {
      padding: var(--s-4) var(--s-5) var(--s-3);
      touch-action: auto;
    }
    .handle {
      display: none;
    }
    .top,
    .body,
    .foot {
      padding-inline: var(--s-5);
    }
    .body:not(.fill) {
      padding-bottom: var(--s-5);
    }
    .foot {
      padding-bottom: var(--s-5);
    }
  }
</style>
