<script lang="ts">
  // The matches as a vertical carousel (ADR 0074), for a tournament's KUMITE! view: the match that matters now
  // (lib/tournament-front.ts currentMatchOf: on now, else up next, else the last) near the top, brought forward, full
  // size and bright, with its stamp; a sliver of the one before over it and the ones after below, smaller and dim,
  // as the draft's ticker lifts the pick on the clock. A thumb scrolls it, a match a snap; on a desktop the arrows
  // beside it, ↑/↓ once it's focused, or the wheel. It opens on the current match and glides to the new one when that
  // changes, unless someone's just been looking along it. A tap on the one in front opens it; on one peeking, brings
  // it forward. Back to now, when the one in front isn't the current one. Less motion: no scaling, a plain snap.
  import type { Tournament } from "../demo/model";
  import GameCard from "./GameCard.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { currentMatchOf } from "./tournament-front";
  import { prefersReducedMotion } from "../app/motion";
  import { onMount, tick } from "svelte";

  let { tournament }: { tournament: Tournament } = $props();

  const games = $derived([...(tournament.games ?? [])].sort((a, b) => a.position - b.position));
  const current = $derived(currentMatchOf(games));
  let box = $state<HTMLElement | undefined>();
  let focus = $state(0);
  // When someone last moved it themselves: a change to the current match doesn't pull it away from them for a while
  let touched = 0;
  const LEAVE_ALONE_MS = 5000;

  const items = () => [...(box?.querySelectorAll<HTMLElement>(":scope > .item") ?? [])];
  /** Where the one in front sits: near the band's top, a sliver of the one before showing over it. */
  const SLIVER = 40;
  /** Bring a match forward: scroll it to the front place (snap does the rest). */
  function bring(i: number, smooth = !prefersReducedMotion) {
    const el = items()[i];
    if (!box || !el) return;
    box.scrollTo({ top: el.offsetTop - SLIVER, behavior: smooth ? "smooth" : "auto" });
  }
  // Which one's in front, and how far each is from the middle: the depth (scale and dim) follows it, in a frame
  let frame = 0;
  function measure() {
    frame = 0;
    if (!box) return;
    const front = box.scrollTop + SLIVER;
    let best = 0;
    let bestD = Infinity;
    items().forEach((el, i) => {
      const d = (el.offsetTop - front) / el.offsetHeight;
      // 0 in front, 1 a neighbour, 2 the next ones: the depth follows the scroll, not just the snap
      el.style.setProperty("--k", String(Math.min(2, Math.abs(d))));
      // Shrinking toward the one in front, so the one before keeps its bottom edge in view as the sliver
      el.style.transformOrigin = d < 0 ? "center bottom" : "center top";
      if (Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        best = i;
      }
    });
    focus = best;
  }
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const byHand = () => (touched = Date.now());

  onMount(() => {
    void tick().then(() => {
      bring(Math.max(0, games.indexOf(current!)), false);
      measure();
    });
  });
  // The current match moved on (a result in, the next one started): glide to it, unless they're looking elsewhere
  let lastCurrent: number | undefined;
  $effect(() => {
    const id = current?.id;
    if (lastCurrent !== undefined && id !== lastCurrent && Date.now() - touched > LEAVE_ALONE_MS)
      bring(games.findIndex((g) => g.id === id));
    lastCurrent = id;
  });

  function step(by: 1 | -1) {
    byHand();
    bring(Math.max(0, Math.min(games.length - 1, focus + by)));
  }
  function key(e: KeyboardEvent) {
    if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else return;
    e.preventDefault();
  }
  // A tap on a match peeking brings it forward, rather than opening it
  function tap(e: MouseEvent, i: number) {
    if (i === focus) return;
    e.preventDefault();
    e.stopPropagation();
    byHand();
    bring(i);
  }
  const atNow = $derived(games[focus]?.id === current?.id);
</script>

<div class="carousel" class:still={prefersReducedMotion}>
  <!-- A scrolling list is focusable, so the keys step it (a scroll region, not a widget) -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <ol
    class="band"
    bind:this={box}
    onscroll={onScroll}
    ontouchstart={byHand}
    onwheel={byHand}
    onkeydown={key}
    tabindex="0"
    aria-label="Matches, in order of play"
  >
    {#each games as g, i (g.id)}
      <li
        class="item"
        class:front={i === focus}
        aria-current={i === focus ? "true" : undefined}
        onclickcapture={(e) => tap(e, i)}
      >
        <GameCard {tournament} game={g} />
      </li>
    {/each}
  </ol>
  <div class="arrows">
    <button class="btn ghost icon sm" aria-label="Previous match" disabled={focus <= 0} onclick={() => step(-1)}
      ><Icon name="chevronUp" size={20} /></button
    >
    <button
      class="btn ghost icon sm"
      aria-label="Next match"
      disabled={focus >= games.length - 1}
      onclick={() => step(1)}><Icon name="chevronDown" size={20} /></button
    >
  </div>
  <!-- Always there, shown only when the one in front isn't the current one, so nothing moves when it appears -->
  <button
    class="btn sm now"
    class:shown={!atNow}
    tabindex={atNow ? -1 : 0}
    aria-hidden={atNow}
    onclick={() => {
      touched = 0;
      bring(games.findIndex((g) => g.id === current?.id));
    }}><Icon name="clock" size={14} />Back to now</button
  >
</div>

<style>
  .carousel {
    /* Most of a phone's height under the track, so a neighbour shows whole either side and the next ones' edges */
    --band: min(72vh, 40rem);
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-3);
  }
  /* A band of fixed height: the one in front in the middle, the ones either side peeking, fading out top and bottom so
     the list plainly goes on. The page scrolls round it; a thumb on it scrolls the matches, one a snap */
  .band {
    display: grid;
    gap: var(--s-4);
    height: var(--band);
    margin: 0;
    /* The one in front near the top, a sliver of the one before over it; room under the last to bring it up */
    padding: 2.5rem var(--s-2) calc(var(--band) - 16rem);
    scroll-padding-top: 2.5rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
    scroll-snap-type: y mandatory;
    scrollbar-width: none;
    /* The sliver of the one before dimmed, not gone; the ones after fading out at the foot, so the list plainly goes on */
    mask-image: linear-gradient(rgb(0 0 0 / 0.55), #000 2.5rem, #000 86%, transparent);
  }
  .band::-webkit-scrollbar {
    display: none;
  }
  .band:focus-visible {
    outline: 2px solid var(--fg-muted);
    outline-offset: 2px;
  }
  /* Forward the nearer the middle: in front full size, bright and lifted; a neighbour smaller (0.85), dim and darker;
     the next ones smaller again (0.72). Each a solid card, the same panel */
  .item {
    --s: calc(1 - min(var(--k, 0), 1) * 0.15 - max(var(--k, 0) - 1, 0) * 0.13);
    scroll-snap-align: start;
    transform: scale(var(--s));
    opacity: calc(1 - min(var(--k, 0), 1) * 0.5);
    filter: brightness(calc(1 - min(var(--k, 0), 1) * 0.35));
  }
  .item :global(.game-card) {
    border-radius: var(--r-lg);
    background: var(--surface-1);
    box-shadow: 0 calc(18px * (1 - min(var(--k, 0), 1))) calc(40px * (1 - min(var(--k, 0), 1))) -12px rgb(0 0 0 / 0.7);
  }
  .item:not(.front) {
    cursor: pointer;
  }
  .still .item {
    transform: none;
    filter: none;
  }
  .arrows {
    display: grid;
    align-content: center;
    gap: var(--s-2);
  }
  /* A phone: the thumb does it, no arrows */
  @media (max-width: 600px) {
    .carousel {
      grid-template-columns: minmax(0, 1fr);
    }
    .arrows {
      display: none;
    }
  }
  .now {
    position: absolute;
    bottom: var(--s-2);
    left: 50%;
    gap: var(--s-1);
    opacity: 0;
    pointer-events: none;
    transform: translateX(-50%);
    transition: opacity var(--t-fast) var(--ease-in-out);
  }
  .now.shown {
    opacity: 1;
    pointer-events: auto;
  }
</style>
