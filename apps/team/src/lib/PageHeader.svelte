<script lang="ts">
  /**
   * The top of a page: an eyebrow, the title (with a badge beside it), one line under it, then the toolbar row:
   * the section's pages (Games, Standings, Draft), the page's search or tabs, its filters, and its actions on the
   * right. On desktop the title scrolls away like content and the row docks just under the top of the window; the
   * moment it docks, a band of the page's background drops down from above and catches it. A page with a row is kept a little taller than the window, so a filter that
   * shortens the list can't snap the scroll back and move the row under your pointer. Phones show the title in
   * the shell's slim bar (so here it's for screen readers only), and the shell takes the actions and filters too;
   * the line and the search or tabs stay here. Home has no header.
   */
  import type { Snippet } from "svelte";
  import Icon from "../app/shell/Icon.svelte";
  import type { IconName } from "../app/shell/icons";
  import Pills from "./Pills.svelte";
  import { pageBar } from "../app/shell/page-bar.svelte";
  import { phone } from "./viewport.svelte";

  let {
    title,
    subtitle,
    sub,
    eyebrow,
    eyebrowIcon,
    badge,
    actions,
    toolbar,
    filters,
    active = 0,
    onclear,
  }: {
    title: string;
    /** What the page is, in a line: desktop only (phones are short of room). */
    subtitle?: string;
    /** The line under the title, when it needs links. Shown on phones too, unlike `subtitle`. */
    sub?: Snippet;
    /** Above the title: the section this page belongs to. Coloured with --tone, when the page sets one. */
    eyebrow?: string;
    eyebrowIcon?: IconName;
    /** Beside the title: a status. */
    badge?: Snippet;
    actions?: Snippet;
    /** Always shown: search, a page's tabs. */
    toolbar?: Snippet;
    /** Inline on desktop; in the Filters sheet on phones. */
    filters?: Snippet;
    /** How many filters are on. */
    active?: number;
    onclear?: () => void;
  } = $props();

  // Lend the phone bar this page's actions and filters. A page arriving can register before the one leaving has
  // cleaned up, so each only clears what it set.
  const me = Symbol("page");
  $effect(() => {
    Object.assign(pageBar, { owner: me, actions, filters, active, onclear });
  });
  $effect(() => () => {
    if (pageBar.owner === me)
      Object.assign(pageBar, {
        owner: undefined,
        actions: undefined,
        filters: undefined,
        active: 0,
        onclear: undefined,
      });
  });

  const strip = $derived(!phone.current && pageBar.strip.length > 1 ? pageBar.strip : []);
  const hasToolbar = $derived(Boolean(toolbar || strip.length || (!phone.current && (filters || actions))));

  // Desktop: when the page gets shorter under the docked row (a filter left a few results), and what's left fits
  // on one screen, start it right under the row. The row stays where it is; the results come to it, rather than
  // sitting hidden above it under the veil.
  // Docked: the sticky row has reached its place at the top. That's when its band comes in, not before.
  let docked = $state(false);
  $effect(() => {
    const el = row;
    if (!el || phone.current) {
      docked = false;
      return;
    }
    const view = el.closest<HTMLElement>(".view");
    if (!view) return;
    const check = () => {
      // Its sticky top, below the view's top padding: the height of whatever is pinned above (the View-as banner)
      const dockAt = (parseFloat(getComputedStyle(el).top) || 0) + (parseFloat(getComputedStyle(view).paddingTop) || 0);
      docked = view.scrollTop > 0 && el.getBoundingClientRect().top - view.getBoundingClientRect().top <= dockAt + 0.5;
    };
    check();
    view.addEventListener("scroll", check, { passive: true });
    return () => view.removeEventListener("scroll", check);
  });

  let header = $state<HTMLElement | undefined>();
  let row = $state<HTMLElement | undefined>();
  $effect(() => {
    const el = row;
    const hd = header;
    if (!el || !hd || phone.current) return;
    const view = el.closest<HTMLElement>(".view");
    const page = el.parentElement;
    if (!view || !page) return;
    const ro = new ResizeObserver(() => {
      const dock = page.offsetTop + hd.offsetTop + hd.offsetHeight;
      const last = page.lastElementChild;
      if (view.scrollTop <= dock || !last) return;
      const content = last.getBoundingClientRect().bottom - page.getBoundingClientRect().top;
      if (content - dock <= view.clientHeight) view.scrollTop = dock;
    });
    ro.observe(page);
    return () => ro.disconnect();
  });
</script>

<header class="page-header" bind:this={header}>
  <div class="titles">
    <!-- On a desktop the eyebrow's line is kept even when there's none, so every title sits at the same height -->
    {#if eyebrow}
      <p class="eyebrow-line">
        {#if eyebrowIcon}<Icon name={eyebrowIcon} size={14} />{/if}{eyebrow}
        {#if badge && phone.current}{@render badge()}{/if}
      </p>
    {:else if !phone.current}
      <p class="eyebrow-line" aria-hidden="true"></p>
    {/if}
    <div class="title-row">
      <h1 class="poster">{title}</h1>
      {#if badge && !phone.current}{@render badge()}{/if}
    </div>
    <!-- A phone has no room for a page describing itself: the plain subtitle is desktop's; `sub` (a tournament's day and
         place) is what the page is about, so it stays -->
    {#if sub}<p class="line hint">{@render sub()}</p>{:else if subtitle && !phone.current}<p class="line hint">
        {subtitle}
      </p>{/if}
  </div>
</header>
<!-- A sibling of the header, not a child: a sticky element can only pin within its parent, and the header scrolls away -->
{#if hasToolbar}
  <div class="toolbar page-toolbar" class:docked bind:this={row}>
    {#if strip.length}<Pills items={strip} current={pageBar.current} />{/if}
    {#if toolbar}{@render toolbar()}{/if}
    {#if filters && !phone.current}{@render filters()}{/if}
    {#if actions && !phone.current}<div class="bar-actions">{@render actions()}</div>{/if}
  </div>
{/if}

<style>
  .page-header {
    display: grid;
    gap: var(--s-4);
    min-width: 0;
  }
  .titles {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }
  .eyebrow-line {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 1.5rem;
    color: var(--tone, var(--fg-muted));
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .eyebrow-line :global(.badge) {
    letter-spacing: normal;
    text-transform: none;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .line :global(a) {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .toolbar {
    margin-top: calc(var(--s-4) - var(--s-5));
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s-3);
    min-width: 0;
  }

  .toolbar > :global(*) {
    min-width: 0;
  }
  /* Styled with the phone bar's actions (app.css), so both bars look the same */
  .bar-actions {
    margin-left: auto;
  }

  /* Desktop: the row docks just under the top as the page scrolls */
  @media (min-width: 901px) {
    .toolbar {
      position: sticky;
      top: var(--s-4);
      z-index: 4;
    }
    /* Behind the docked row, the phone bar's frosted band, ending a little below it so the cards stop short of
       the chips. No line, no shadow. */
    .toolbar::before {
      content: "";
      position: fixed;
      z-index: -1;
      top: 0;
      left: 0;
      right: 0;
      /* Down past whatever is pinned at the top (the View-as banner), which pushes the docked row down too */
      height: calc(var(--chrome-h, 0px) + var(--s-4) + 2.25rem + var(--s-4));
      background: var(--chrome-bg-solid);
      backdrop-filter: var(--blur);
      -webkit-backdrop-filter: var(--blur);
      opacity: 0;
      translate: 0 -100%;
      pointer-events: none;
      transition:
        translate var(--t-slow) var(--ease),
        opacity var(--t) var(--ease);
    }
    /* The moment the row docks, the band drops down from above and catches it */
    .toolbar.docked::before {
      opacity: 1;
      translate: 0 0;
    }
    /* The search starts small and grows into what's left, so the chips and the actions stay on the one row */
    .toolbar {
      --open-width: 14rem;
    }
    .toolbar :global(.search:not(.collapsible)) {
      flex: 1 1 9rem;
      width: auto;
      min-width: 0;
      max-width: 14rem;
    }
    /* Always a little taller than the window, so a shorter list can't snap the scroll back past the dock */
    :global(.page:has(> .page-toolbar)) {
      align-content: start;
      min-height: calc(100% + 12rem);
    }
  }

  /* Phones: the slim bar names the page; the line stays, up to two lines */
  @media (max-width: 900px) {
    .page-header {
      gap: var(--s-3);
    }
    h1 {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .title-row:not(:has(> :not(h1))) {
      display: none;
    }
    /* Two lines at most: a page's line is a sentence, so cutting it at one loses what it says */
    .line {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
    .page-header:not(:has(.line, .toolbar, .eyebrow-line)) {
      display: none;
    }
  }
</style>
