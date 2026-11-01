<script lang="ts">
  // A Save form's footer (ADR 0065), in every drawer, sheet and editor panel with a Save: where it stands on the left,
  // Save on the right. Unsaved: a dot and "Unsaved changes", and Save is the main button. Clean: Save is quiet and
  // off, and it says "Saved ✓ · just now" once saved (or "No changes"). Closing with changes: "Discard your changes?",
  // Keep editing or Discard, in the same place. The line is always there and only its words change, so nothing moves.
  import { onMount, type Snippet } from "svelte";
  import type { Edits } from "./dirty.svelte";
  import { canSave, footNote } from "./dirty";

  let {
    edits,
    form,
    label = "Save",
    start,
    onsave,
    ready = true,
    problem = "",
  }: {
    edits: Edits;
    /** The form's id: Save submits it (it can be anywhere in the overlay). */
    form?: string;
    /** "Save", or what saving a new one does ("Add venue", "Schedule it"). */
    label?: string;
    /** At the start of the bar, before the words (a quiet Delete). Hidden while it asks. */
    start?: Snippet;
    /** Saving without a form: called by Save. */
    onsave?: () => void;
    /** Whether what's typed can be saved yet (a rating out of range): Save waits for it. */
    ready?: boolean;
    /** Why it can't be, said in place of the usual words. */
    problem?: string;
  } = $props();

  // "just now" turns into the time after a minute
  let now = $state(Date.now());
  onMount(() => {
    const tick = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(tick);
  });
  $effect(() => {
    void edits.savedAt;
    now = Date.now();
  });
  const note = $derived(
    problem && !edits.asking ? { kind: "failed" as const, text: problem } : footNote(edits.state, now),
  );
  const live = $derived(ready && canSave(edits.state));
</script>

<div class="save-bar" class:asking={edits.asking}>
  {#if start && !edits.asking}{@render start()}{/if}
  <p class="note {note.kind}" role="status" aria-live="polite">
    {#if note.kind === "dirty" || note.kind === "failed"}<span class="dot" aria-hidden="true"></span>{/if}
    <span class="words">{note.text || " "}</span>
  </p>
  {#if edits.asking}
    <button class="btn ghost" type="button" onclick={() => edits.keep()}>Keep editing</button>
    <button class="btn discard" type="button" onclick={() => edits.discard()}>Discard</button>
  {:else}
    <button
      class="btn save"
      class:primary={live}
      type={onsave ? "button" : "submit"}
      {form}
      disabled={!live}
      onclick={onsave}>{label}</button
    >
  {/if}
</div>

<style>
  .save-bar {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  /* One line, always there: its words change, its height never does */
  .note {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    line-height: var(--control-h);
    white-space: nowrap;
  }
  .words {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note.dirty,
  .note.asking {
    color: var(--fg-body);
  }
  .note.failed {
    color: var(--red-hot);
  }
  /* The accent: a dot, never a fill */
  .dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--action);
  }
  .failed .dot {
    background: var(--red-hot);
  }
  /* Nothing to save: just the word, quiet, no edge or fill */
  .save:disabled {
    border-color: transparent;
    background: none;
    color: var(--fg-subtle);
  }
  /* The one red fill: the tap that throws the changes away */
  .discard {
    background: var(--red);
    color: var(--on-red);
  }
  .discard:hover {
    background: var(--red-hot);
  }
</style>
