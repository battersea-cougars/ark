<script lang="ts">
  // The draft's pick order (ADR 0060), on the Draft page. The order the captains were named in means nothing: until
  // the draft opens they're shown without numbers, and opening it draws the order at random on the server. Whoever's
  // on the page as the draw arrives (ADR 0072) sees it happen: the names shuffle a few times and settle into the
  // drawn order, the numbers stamped on (and, on the Kumite, its seal). Anyone opening the page later just sees the
  // order; so does anyone who asks for less motion. It's round one's: the snake turns it each round.
  import { onDestroy, untrack } from "svelte";
  import { flip } from "svelte/animate";
  import { cubicInOut } from "svelte/easing";
  import Kanji from "./Kanji.svelte";
  import { kanjiFor } from "./motif";
  import { prefersReducedMotion } from "../app/motion";
  import type { TournamentType } from "../demo/model";

  let {
    type,
    captains,
    drawn,
  }: {
    type: TournamentType;
    /** The captains, in the order the server has them: drawn, once the draft's opened. */
    captains: { id: number; name: string; you: boolean }[];
    /** The draft's opened, so the order is drawn and fixed. */
    drawn: boolean;
  } = $props();

  const seal = $derived(kanjiFor(type, "blood"));

  // The shuffle: a few swaps (the order on screen while it runs), then the drawn order with its numbers stamped on
  const SWAPS = 7;
  const SWAP_MS = 290;
  const MOVE_MS = 260;
  const STAMP_MS = 700;
  let shuffling = $state<number[] | null>(null);
  let stamping = $state(false);
  let timers: ReturnType<typeof setTimeout>[] = [];
  const later = (ms: number, f: () => void) => void timers.push(setTimeout(f, ms));
  onDestroy(() => timers.forEach(clearTimeout));

  function shuffle(from: number[]) {
    if (from.length < 2) return;
    const order = [...from];
    shuffling = [...order];
    for (let k = 0; k < SWAPS; k++)
      later(120 + k * SWAP_MS, () => {
        // Only for the show: the order itself was drawn on the server
        const i = Math.floor(Math.random() * order.length);
        let j = Math.floor(Math.random() * (order.length - 1));
        if (j >= i) j++;
        [order[i], order[j]] = [order[j], order[i]];
        shuffling = [...order];
      });
    later(120 + SWAPS * SWAP_MS, () => {
      shuffling = null;
      stamping = true;
    });
    later(120 + SWAPS * SWAP_MS + STAMP_MS, () => (stamping = false));
  }

  // The order arriving while the page is open: shuffle from the order shown before it. Opened already when the page
  // came up: nothing to see but the order
  let before: number[] = [];
  let wasDrawn = untrack(() => drawn);
  $effect(() => {
    const ids = captains.map((c) => c.id);
    if (!drawn) {
      before = ids;
      wasDrawn = false;
      return;
    }
    if (!wasDrawn && !prefersReducedMotion) {
      // The same captains, from where they were (one added at the last moment goes on the end)
      const from = [...before.filter((id) => ids.includes(id)), ...ids.filter((id) => !before.includes(id))];
      untrack(() => shuffle(from));
    }
    wasDrawn = true;
  });

  const shown = $derived(shuffling ? shuffling.flatMap((id) => captains.find((c) => c.id === id) ?? []) : captains);
  const numbered = $derived(drawn && !shuffling);
</script>

<section class="order" class:shuffling={!!shuffling} aria-label="Pick order">
  <header>
    <!-- The Kumite's seal: faint until the order's drawn, then stamped on it -->
    {#if seal}
      <span class="seal-slot" class:unsealed={!numbered} aria-hidden="true">
        {#key numbered}<span class="sealed" class:stamp={stamping}><Kanji text={seal} seal /></span>{/key}
      </span>
    {/if}
    <h2 class="eyebrow">Pick order</h2>
    <!-- One line, the same whatever it says, so the draw arriving moves nothing -->
    <p class="hint" aria-live="polite">
      {#if !drawn}Order drawn when the draft starts.
      {:else if shuffling}Drawing the order…
      {:else}Drawn at random.{/if}
    </p>
  </header>
  <ol class="names">
    {#each shown as c, i (c.id)}
      <li class="cap" class:you={c.you} animate:flip={{ duration: MOVE_MS, easing: cubicInOut }}>
        <span class="n num display" class:stamp={stamping}>{numbered ? i + 1 : ""}</span>
        <span class="who display">{c.name}</span>
        {#if c.you}<small>you</small>{/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .order {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 2.25rem;
    min-width: 0;
  }
  h2 {
    margin: 0;
    flex-shrink: 0;
  }
  .hint {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: var(--text-sm);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* The seal's place: kept, so it stamping on moves nothing */
  .seal-slot {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2.25rem;
    height: 2.25rem;
  }
  .unsealed {
    opacity: 0.18;
    filter: grayscale(1);
  }
  .seal-slot :global(.seal) {
    width: 2.25rem;
    height: 2.25rem;
    font-size: 1.1rem;
  }
  /* Equal places, so a swap never changes how they wrap */
  .names {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .cap {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    height: 3rem;
    padding: 0 var(--s-4) 0 var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
    transition:
      scale var(--t-slow) var(--ease),
      opacity var(--t-slow) var(--ease);
  }
  /* While they shuffle: a step back, as cards in a dealer's hands */
  .shuffling .cap {
    scale: 0.96;
    opacity: 0.8;
  }
  /* The number: its place always kept, empty until the order's drawn */
  .n {
    flex-shrink: 0;
    width: 1.6rem;
    color: var(--fg);
    font-size: 1.5rem;
    line-height: 1;
    text-align: center;
  }
  .who {
    min-width: 0;
    overflow: hidden;
    color: var(--fg);
    font-size: 1.05rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  small {
    flex-shrink: 0;
    color: var(--fg-muted);
    font-size: var(--text-xs);
  }
  /* Settled: the numbers and the seal stamped on, hard and a little askew, like a hanko */
  .stamp {
    animation: stamp 420ms var(--ease) both;
  }
  .cap:nth-child(2) .stamp {
    animation-delay: 70ms;
  }
  .cap:nth-child(3) .stamp {
    animation-delay: 140ms;
  }
  .cap:nth-child(n + 4) .stamp {
    animation-delay: 210ms;
  }
  .sealed.stamp {
    animation-delay: 280ms;
  }
  @keyframes stamp {
    0% {
      opacity: 0;
      scale: 1.9;
      rotate: -12deg;
    }
    60% {
      opacity: 1;
      scale: 0.92;
    }
    100% {
      opacity: 1;
      scale: 1;
      rotate: 0deg;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stamp {
      animation: none;
    }
  }
</style>
