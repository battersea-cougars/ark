<script lang="ts">
  // What a live page says about following along (ADR 0072): "Live" while the hub's stream is open, else how often it
  // checks (the admins' setting, ADR 0072). Both are laid out on top of each other so the words can swap without
  // anything around them moving. `tail` says why it only checks now and then, so it's only on that one.
  import { everyHowOften, liveFeed } from "./live-updates.svelte";

  let { what = "Updates", live = "Live", tail = "" }: { what?: string; live?: string; tail?: string } = $props();
</script>

<span class="swap">
  <span class="word" class:ghost={!liveFeed.on} aria-hidden={!liveFeed.on}>{live}</span>
  <span class="word" class:ghost={liveFeed.on} aria-hidden={liveFeed.on}>{what} {everyHowOften()}{tail}</span>
</span>

<style>
  .swap {
    display: inline-grid;
  }
  /* Either may wrap on a narrow phone ("Updates every 30 seconds, to keep the club on the free plan"): the box is
     as tall as the taller, so the swap still moves nothing */
  .word {
    grid-area: 1 / 1;
    text-wrap: balance;
  }
  .ghost {
    visibility: hidden;
  }
</style>
