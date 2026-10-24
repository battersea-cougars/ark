<script lang="ts">
  // Asked before it's done (#153): what will happen, in words (the children), then two keys, the way out and the tap
  // that does it. `kind` is that tap's look: `primary` to go on, `outline` for a step that keeps everything, `danger`
  // (the one red fill) for what's gone for good. Inside a sheet or drawer (lib/Drawer `short`).
  import type { Snippet } from "svelte";

  let {
    children,
    cancel,
    confirm,
    kind = "primary",
    busy = false,
    oncancel,
    onconfirm,
  }: {
    children: Snippet;
    /** The way out: "Not now", "Keep it". */
    cancel: string;
    /** What the tap does: "Reset the draft", "Move back". */
    confirm: string;
    kind?: "primary" | "outline" | "danger";
    busy?: boolean;
    oncancel: () => void;
    onconfirm: () => void;
  } = $props();
</script>

<div class="confirm" role="alert">
  {@render children()}
  <div class="keys">
    <button class="btn ghost" onclick={oncancel}>{cancel}</button>
    <button class="btn {kind}" disabled={busy} onclick={onconfirm}>{confirm}</button>
  </div>
</div>

<style>
  .confirm {
    display: grid;
    gap: var(--s-4);
  }
  .confirm :global(p) {
    margin: 0;
    color: var(--fg-body);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s-3);
  }
</style>
