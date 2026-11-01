<script lang="ts">
  /**
   * One group of an editor's fields, as Gwenda ops groups its forms: a small heading (and an optional quiet line
   * beside it), then the fields. Groups are divided by a thin rule, never boxed, so the form reads as one thing.
   */
  import type { Snippet } from "svelte";

  let {
    title,
    description,
    stacked = false,
    children,
  }: {
    title: string;
    description?: string;
    /** The line under the heading, not beside it: for a list that starts right under it. */
    stacked?: boolean;
    children: Snippet;
  } = $props();

  const headingId = `sec-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section class="form-section" aria-labelledby={headingId}>
  <header class="form-heading" class:stacked>
    <h2 id={headingId}>{title}</h2>
    {#if description}<p class="description">{description}</p>{/if}
  </header>
  {@render children()}
</section>

<style>
  .form-section {
    display: grid;
    gap: var(--s-4);
    align-content: start;
    min-width: 0;
    padding-block: var(--s-5) var(--s-6);
    border-top: 1px solid var(--border);
  }
  .form-section:first-child {
    padding-top: 0;
    border-top: 0;
  }
  .form-section:last-child {
    padding-bottom: 0;
  }
  .form-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-1) var(--s-3);
  }
  .form-heading.stacked {
    display: grid;
    gap: var(--s-1);
  }
  h2 {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
    line-height: 1.25;
  }
  .description {
    flex: 1 1 12rem;
    color: var(--fg-subtle);
    font-size: var(--text-xs);
  }
</style>
