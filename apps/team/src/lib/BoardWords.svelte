<script lang="ts">
  // Words on an old scoreboard: the text in the display face, upper case, a dark tile per word (ADR 0074, the
  // after-party's awards). Words wrap whole, and the face shrinks so the longest word fits its line (and the text,
  // about `lines` lines). Still: whatever shows it rolls it into view (AfterParty's roll-in), the tiles and all.
  let {
    text,
    lines = 2,
    size = "1.5rem",
  }: {
    text: string;
    /** About how many lines it may take before the face shrinks. */
    lines?: number;
    /** The face's size at most. */
    size?: string;
  } = $props();

  const words = $derived(text.toUpperCase().split(/\s+/).filter(Boolean));
  const chars = $derived(words.reduce((n, w) => n + w.length, 0));
  // Characters across the box at the most: the longest word on its line, the whole in about `lines` of them
  const fit = $derived(Math.max(...words.map((w) => w.length), Math.ceil(chars / lines) + 2, 1));
</script>

<span class="board-words">
  <span class="sr-only">{text}</span>
  <span class="board display num" aria-hidden="true" style:--size={size} style:--fit={fit}>
    {#each words as word, w (w)}<span class="tile">{word}</span>{/each}
  </span>
</span>

<style>
  .board-words {
    display: block;
    min-width: 0;
    container-type: inline-size;
  }
  /* The face: as big as `size`, smaller when the longest word (or the whole, over its lines) wouldn't fit */
  .board {
    display: flex;
    flex-wrap: wrap;
    gap: 0.16em 0.3em;
    font-size: min(var(--size), calc(100cqi / (var(--fit) * 0.62)));
    font-style: normal;
    line-height: 1;
    letter-spacing: 0.06em;
  }
  /* A word's tile: dark, a little rounded, the word whole on it */
  .tile {
    padding: 0.14em 0.24em 0.1em;
    border-radius: 3px;
    background: var(--flap-face, var(--surface-2));
    box-shadow: inset 0 -0.12em 0.2em rgb(0 0 0 / 0.35);
    white-space: nowrap;
  }
</style>
