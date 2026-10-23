<script lang="ts">
  // A split-flap board, like the old scoreboards and departures boards: the text in the display face, a dark cell per
  // character with a hairline across its middle. Playing, each cell turns through a few others (its top half folding
  // down, the next one's bottom half landing) and settles on its own, left to right (lib/split-flap: seeded by the
  // text, so everyone watching sees the same). Not playing (opened later), or with reduced motion, the text is just
  // there. Every cell is there from the start, blank till it turns, so the text's room is kept and nothing moves;
  // words wrap whole, and the face shrinks so the longest word fits its line (and the text, about `lines` lines).
  // Screen readers get the text; the flaps are hidden from them.
  import { prefersReducedMotion } from "../app/motion";
  import { FLAP_STEP_MS, flapAt, flapBoard, flapMs } from "./split-flap";

  let {
    text,
    play = false,
    delay = 0,
    lines = 2,
    size = "1.5rem",
  }: {
    text: string;
    /** Turn the flaps now (on a reveal); otherwise the text is settled. */
    play?: boolean;
    /** How long it waits before its first cell turns, ms. */
    delay?: number;
    /** About how many lines it may take before the face shrinks. */
    lines?: number;
    /** The face's size at most. */
    size?: string;
  } = $props();

  const board = $derived(flapBoard(text));
  const cells = $derived(board.reduce((n, w) => n + w.length, 0));
  // Cells across the box at the most: the longest word on its line, the whole in about `lines` of them
  const fit = $derived(Math.max(...board.map((w) => w.length), Math.ceil(cells / lines) + 2, 1));

  // ms into the board while it plays; null once it's settled (or it never played)
  let at = $state<number | null>(null);
  $effect(() => {
    if (!play || prefersReducedMotion) {
      at = null;
      return;
    }
    const settled = flapMs(text);
    const t0 = performance.now() + delay;
    at = -delay;
    let frame = requestAnimationFrame(function tick(now) {
      at = now - t0;
      if (at < settled) frame = requestAnimationFrame(tick);
      else at = null;
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

<span class="split-flap">
  <span class="sr-only">{text}</span>
  <span
    class="board display num"
    aria-hidden="true"
    style:--size={size}
    style:--fit={fit}
    style:--step="{FLAP_STEP_MS}ms"
  >
    {#each board as word, w (w)}
      <span class="word">
        {#each word as cell, c (c)}
          {@const now = at === null ? cell.char : flapAt(cell, at)}
          {@const was = at === null ? now : flapAt(cell, at - FLAP_STEP_MS)}
          <span class="cell">
            {#key now}
              <span class="half top"><span>{now}</span></span>
              {#if was !== now}
                <!-- The last one's bottom half, under the new one's landing; its top half folding away -->
                <span class="half bottom"><span>{was}</span></span>
                <span class="half bottom land"><span>{now}</span></span>
                <span class="half top fold"><span>{was}</span></span>
              {:else}
                <span class="half bottom"><span>{now}</span></span>
              {/if}
            {/key}
          </span>
        {/each}
      </span>
    {/each}
  </span>
</span>

<style>
  .split-flap {
    display: block;
    min-width: 0;
    container-type: inline-size;
  }
  /* The face: as big as `size`, smaller when the longest word (or the whole, over its lines) wouldn't fit */
  .board {
    --cell: 0.7em;
    --gap: 0.07em;
    display: flex;
    flex-wrap: wrap;
    gap: 0.14em 0.34em;
    font-size: min(var(--size), calc(100cqi / (var(--fit) * 0.77)));
    font-style: normal;
    line-height: 1;
  }
  .word {
    display: flex;
    gap: var(--gap);
  }
  /* A flap: a dark cell, its two halves split by a hairline across the middle */
  .cell {
    position: relative;
    width: var(--cell);
    height: 1.22em;
    perspective: 4em;
  }
  .cell::after {
    position: absolute;
    inset: calc(50% - 0.5px) 0 auto;
    z-index: 4;
    height: 1px;
    background: rgb(0 0 0 / 0.6);
    content: "";
  }
  .half {
    position: absolute;
    right: 0;
    left: 0;
    height: 50%;
    overflow: hidden;
    background: var(--flap-face, var(--surface-2));
    backface-visibility: hidden;
  }
  .half > span {
    position: absolute;
    left: 0;
    width: 100%;
    height: 200%;
    line-height: 1.22em;
    text-align: center;
  }
  .top {
    top: 0;
    border-radius: 2px 2px 0 0;
    transform-origin: 50% 100%;
  }
  .top > span {
    top: 0;
  }
  .bottom {
    bottom: 0;
    border-radius: 0 0 2px 2px;
    background: var(--flap-face-low, color-mix(in srgb, var(--flap-face, var(--surface-2)) 88%, black));
    transform-origin: 50% 0;
  }
  .bottom > span {
    bottom: 0;
  }
  /* A change: the old top half folds down and away, then the new bottom half lands */
  .fold {
    z-index: 3;
    animation: fold calc(var(--step) / 2) ease-in both;
  }
  .land {
    z-index: 2;
    animation: land calc(var(--step) / 2) calc(var(--step) / 2) ease-out both;
  }
  @keyframes fold {
    to {
      transform: rotateX(-90deg);
    }
  }
  @keyframes land {
    from {
      transform: rotateX(90deg);
    }
  }
</style>
