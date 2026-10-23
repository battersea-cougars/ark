<script lang="ts">
  // A step of draft night (ADR 0060) as one card in the middle of the page column, the clear thing to do now: Draw
  // the order, Open the draft, Seal the teams. Its mark is the series' motif for the step (lib/motif.ts): on the Kumite
  // a big kanji (籤 lots, 開 open) or the red hanko (決, the teams decided); a series without the motif shows its icon.
  // Then the step's name, one line, and for whoever runs it the one main button; everyone else sees the card without
  // it. The same shape every step, the line kept to two lines' room, so moving on a step changes only what it says.
  // `body` goes under the name (the captains, for the draw, shuffled there); `quiet` lets the card go, leaving only
  // the body where it was, which is how the draw hands over to the next step: the card's mark, words and button slide
  // away and its panel fades, the order staying put as the page's order row.
  import type { Snippet } from "svelte";
  import { slide } from "svelte/transition";
  import { prefersReducedMotion } from "../app/motion";
  import Icon from "../app/shell/Icon.svelte";
  import type { IconName } from "../app/shell/icons";
  import HankoPress from "./HankoPress.svelte";
  import { kanjiFor, type MotifKey } from "./motif";
  import type { TournamentType } from "../demo/model";

  let {
    type,
    mark,
    title,
    seal = false,
    quiet = false,
    body,
    children,
    action,
    icon,
    pressed = false,
  }: {
    type: TournamentType;
    /** The step's kanji (draw, open, sealed). */
    mark: MotifKey;
    /** The step, in the display face: "Draw the order". */
    title: string;
    /** The mark as a hanko seal rather than a big kanji. */
    seal?: boolean;
    /** The card gone: only the body stays, where it was. */
    quiet?: boolean;
    /** Under the step's name: what the step works on (the captains, shuffled in the card). */
    body?: Snippet;
    /** The line: what happens, or where it stands for someone who doesn't run it. */
    children: Snippet;
    /** The one main button, for whoever runs the draft. */
    action?: Snippet;
    /** In place of the mark: an icon (the closed draft's blindfold). */
    icon?: IconName;
    /** The seal pressed down onto the card, like a rubber stamp (the teams sealed), and the card lifting away. */
    pressed?: boolean;
  } = $props();

  const kanji = $derived(kanjiFor(type, mark));
  const out = { duration: prefersReducedMotion ? 0 : 320 };
</script>

<section class="step-card" class:quiet class:pressed aria-label={quiet ? undefined : title}>
  {#if !quiet}
    <div class="head" out:slide={out}>
      <div class="mark">
        {#if icon}<span class="icon"><Icon name={icon} size={44} /></span>
        {:else if kanji && seal}<HankoPress text={kanji} {pressed} />
        {:else if kanji}<span class="big" lang="ja" aria-hidden="true">{kanji}</span>
        {:else}<span class="icon"><Icon name={type.icon} size={34} /></span>{/if}
      </div>
      <h2 class="display">{title}</h2>
    </div>
  {/if}
  {#if body}<div class="body">{@render body()}</div>{/if}
  {#if !quiet}
    <div class="foot" out:slide={out}>
      <p class="line" aria-live="polite">{@render children()}</p>
      {#if action}<div class="act">{@render action()}</div>{/if}
    </div>
  {/if}
</section>

<style>
  /* The teams sealed: the hanko comes down on the card like a rubber stamp (lib/HankoPress), held a moment, and the
     card lifts away. Less motion: none of it */
  .step-card.pressed {
    animation: lift 260ms 650ms ease-in both;
  }
  @keyframes lift {
    to {
      opacity: 0;
      transform: translateY(-0.75rem) scale(0.98);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .step-card.pressed {
      animation: none;
    }
  }
  /* A solid dark panel, modest radius, no lines: red only in the mark */
  .step-card {
    display: grid;
    justify-items: center;
    gap: var(--s-3);
    width: 100%;
    max-width: 30rem;
    margin: var(--s-4) auto var(--s-6);
    padding: var(--s-6) var(--s-5);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    text-align: center;
    transition:
      max-width 420ms var(--ease),
      padding 420ms var(--ease),
      margin 420ms var(--ease),
      background-color 420ms var(--ease);
  }
  /* The card gone: its body as part of the page, where the card was */
  .step-card.quiet {
    max-width: 100%;
    margin-block: 0;
    padding: 0;
    background: transparent;
  }
  .head,
  .foot {
    display: grid;
    justify-items: center;
    gap: var(--s-3);
    width: 100%;
  }
  .body {
    width: 100%;
    text-align: left;
  }
  @media (prefers-reduced-motion: reduce) {
    .step-card {
      transition: none;
    }
  }
  .mark {
    display: grid;
    place-items: center;
    height: 4.25rem;
  }
  .big {
    color: var(--red-hot);
    font-family: var(--font-kanji);
    font-size: 3.6rem;
    font-weight: 900;
    line-height: 1;
  }
  /* The hanko, a size up: the teams' seal */
  .mark :global(.seal) {
    width: 4rem;
    height: 4rem;
    font-size: 2rem;
  }
  .icon {
    color: var(--red-hot);
  }
  h2 {
    margin: 0;
    color: var(--fg);
    font-size: var(--text-xl);
    line-height: 1;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .line {
    max-width: 24rem;
    min-height: 2lh;
    margin: 0;
    color: var(--fg-body);
    font-size: var(--text-sm);
    text-wrap: balance;
  }
  .line :global(strong) {
    color: var(--fg);
  }
  .line :global(.warn) {
    color: var(--tone-amber);
  }
  .act {
    display: grid;
    gap: var(--s-2);
    width: 100%;
    justify-items: center;
    margin-top: var(--s-2);
  }
  .act :global(.btn) {
    min-width: 15rem;
  }
  @media (max-width: 599px) {
    .step-card {
      margin-block: var(--s-3) var(--s-5);
    }
    .act :global(.btn) {
      width: 100%;
      min-width: 0;
    }
  }
</style>
