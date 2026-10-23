<script lang="ts">
  // The matches as a vertical carousel (ADR 0074), for a tournament's KUMITE! view: the match that matters now
  // (lib/tournament-front.ts currentMatchOf: on now, else up next, else the last) near the top, brought forward, full
  // size and bright, with its stamp; a sliver of the one before over it and the ones after below, smaller and dim,
  // as the draft's ticker lifts the pick on the clock. A thumb scrolls it, a match a snap; on a desktop the arrows
  // beside it, ↑/↓ once it's focused, or the wheel. It opens on the current match and glides to the new one when that
  // changes, unless someone's just been looking along it. A tap on the one in front opens it; on one peeking, brings
  // it forward. Back to now, when the one in front isn't the current one, and on its own once they've left it alone a
  // while. Less motion: no scaling, a plain snap.
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
  // Left on another match: after this long untouched it glides back to the current one by itself
  const DRIFT_BACK_MS = 8000;
  let driftBack: ReturnType<typeof setTimeout> | undefined;

  const items = () => [...(box?.querySelectorAll<HTMLElement>(":scope > .item") ?? [])];
  /** Where the one in front sits: near the band's top, a sliver of the one before showing over it. */
  const SLIVER = 40;
  const still = prefersReducedMotion;
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
    const all = items();
    let best = 0;
    let bestD = Infinity;
    all.forEach((el, i) => {
      const d = (el.offsetTop - front) / el.offsetHeight;
      const k = Math.abs(d);
      // 0 in front, 1 a neighbour, 2 the next ones: the depth follows the scroll, not just the snap
      el.style.setProperty("--k", String(Math.min(2, k)));
      // Smaller, dimmer and further back the further from the front: a neighbour 0.82 and 0.8, the next 0.68 and
      // 0.5, softly blurred; each shrinks toward the front, so the one before keeps its foot in view as the sliver.
      // Dimmed by brightness more than see-through, so a neighbour still reads as a card on a phone's carbon
      const near = Math.min(k, 1);
      const far = Math.max(Math.min(k, 2) - 1, 0);
      el.style.transformOrigin = d < 0 ? "center bottom" : "center top";
      el.style.transform = still ? "" : `scale(${1 - near * 0.18 - far * 0.14})`;
      el.style.opacity = String(1 - near * 0.2 - far * 0.3);
      el.style.filter = still ? "" : `brightness(${1 - near * 0.35}) blur(${far * 1.5}px)`;
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
  function backToNow() {
    touched = 0;
    bring(games.findIndex((g) => g.id === current?.id));
  }
  function byHand() {
    touched = Date.now();
    clearTimeout(driftBack);
    driftBack = setTimeout(() => {
      if (!atNow && !document.hidden) backToNow();
    }, DRIFT_BACK_MS);
  }

  onMount(() => {
    void tick().then(() => {
      bring(Math.max(0, games.indexOf(current!)), false);
      measure();
    });
    return () => clearTimeout(driftBack);
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
    ontouchmove={byHand}
    onwheel={byHand}
    onpointermove={byHand}
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
  <button class="btn sm now" class:shown={!atNow} tabindex={atNow ? -1 : 0} aria-hidden={atNow} onclick={backToNow}
    ><Icon name="clock" size={14} />Back to now</button
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
  /* Forward the nearer the front: in front full size, bright and floating; the others smaller, dimmer and further
     back the further they are (measure() sets them as it scrolls) */
  .item {
    scroll-snap-align: start;
  }
  .item :global(.game-card) {
    border-radius: var(--r-lg);
    backdrop-filter: none;
    box-shadow: 0 calc(24px * (1 - min(var(--k, 0), 1))) calc(48px * (1 - min(var(--k, 0), 1))) -10px rgb(0 0 0 / 0.7);
  }
  /* The one in front catches the light, as a hovered event card does (EventCard): a sheen down from a lit top edge,
     and a soft light sweeps across it once, as it comes to the front. Less motion: the sheen, still */
  .item.front :global(.game-card) {
    overflow: hidden;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 0.06), rgb(255 255 255 / 0.01) 55%, transparent),
      var(--card-fill, var(--surface-1));
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.12),
      0 24px 48px -10px rgb(0 0 0 / 0.7);
  }
  .item.front :global(.game-card)::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: inherit;
    background: linear-gradient(115deg, transparent 35%, rgb(255 255 255 / 0.07) 50%, transparent 65%) no-repeat;
    background-size: 250% 100%;
    pointer-events: none;
    animation: sweep 2.1s var(--ease-in-out) both;
  }
  @keyframes sweep {
    0% {
      background-position: 120% 0;
    }
    35%,
    100% {
      background-position: -120% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .item.front :global(.game-card)::before {
      display: none;
    }
  }
  .item:not(.front) {
    cursor: pointer;
  }
  .still .item {
    filter: none;
  }
  .still .item:not(.front) {
    opacity: 0.6;
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
