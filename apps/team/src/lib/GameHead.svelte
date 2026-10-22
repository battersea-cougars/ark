<script lang="ts">
  // Over a game in a list, the same two lines on every card so they line up: where it sits in the day (Game 1 of 7),
  // then its stage (the round robin, the Final) in the poster face with its kanji. A playoff is in the club's red,
  // like the section titles; the round robin stays quiet. What's on now is the card's to say (its KUMITE! stamp, in
  // the middle). On the right: the whistle, Live, or on hover (its card, lib/GameCard) a chevron as the stage lights.
  import Kanji from "./Kanji.svelte";
  import type { Snippet } from "svelte";
  import Icon from "../app/shell/Icon.svelte";

  let {
    stage,
    kanji = "",
    playoff = false,
    place,
    opens = false,
    action,
    centre,
  }: {
    /** Empty when a group's header already says it (the Fight card's Round robin). */
    stage: string;
    kanji?: string;
    playoff?: boolean;
    place: string;
    /** Its card opens the game: a chevron shows on hover, in space kept for it so nothing moves. */
    opens?: boolean;
    /** A button on the right, after the place (Live, on the game on now). */
    action?: Snippet;
    /** Top middle of the card (the Kumite! chant, on the game on now). */
    centre?: Snippet;
  } = $props();
</script>

<div class="game-head" class:playoff>
  <!-- The same two lines on every card, so they line up down a list: what it is to you and where it sits in the
       day, then the stage -->
  <span class="titles">
    <span class="place">{place}</span>
    {#if stage}<span class="stage">{stage}<Kanji text={kanji} /></span>{/if}
  </span>
  {#if centre}<span class="centre">{@render centre()}</span>{/if}
  <span class="end"
    >{#if opens}<span class="go" aria-hidden="true"><Icon name="chevronRight" size={16} /></span
      >{/if}{@render action?.()}</span
  >
</div>

<style>
  /* Three columns, so whatever's in the middle sits in the card's middle whatever's either side */
  .game-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--s-3);
    /* Lined up with its card's row (FixtureRow .carded): room round the corner's button */
    padding: var(--s-6) var(--s-6) var(--s-2);
  }
  .titles {
    display: grid;
    flex-shrink: 0;
    gap: var(--s-1);
  }
  /* What it is to you, in an accent: Now playing in the club's hot red with its REC light, anything coming up in
     amber (the sticker yellow is the main button's alone, ADR 0084) */
  .place {
    color: var(--fg-subtle);
    font-size: var(--text-sm);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .stage {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-style: italic;
    line-height: 1;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .playoff .stage {
    color: var(--red-muted);
  }
  .stage :global(.kanji) {
    margin-left: 0;
  }
  .centre {
    grid-column: 2;
    display: inline-flex;
  }
  /* The right: the whistle, Live, or the chevron on hover */
  .end {
    grid-column: 3;
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
  }
  @media (max-width: 600px) {
    .game-head {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--s-2) var(--s-3);
      padding: var(--s-4) var(--s-4) var(--s-2);
    }
    /* No room for three across: the stamp (KUMITE!, You are next!, a result) is a sticker on the card's top edge,
       half over it, centred, so a card wearing one is no taller than one without */
    .game-head {
      position: relative;
    }
    .centre {
      position: absolute;
      grid-column: 1 / -1;
      grid-row: 1;
      /* The card's top edge: up past the head's padding */
      top: calc(-1 * var(--s-4));
      left: 50%;
      z-index: 2;
      transform: translate(-50%, -55%);
    }
    .end {
      grid-column: 2;
    }
  }
  .stage,
  .go {
    transition:
      color var(--t-fast) var(--ease-in-out),
      opacity var(--t-fast) var(--ease-in-out);
  }
  .go {
    display: inline-flex;
    opacity: 0;
    color: var(--fg-muted);
  }
  /* Its card under the pointer (Games' .game-card): the stage lights up, the chevron shows */
  @media (hover: hover) {
    :global(.game-card:hover) .stage {
      color: var(--fg);
    }
    :global(.game-card:hover) .playoff .stage {
      color: var(--red-hot);
    }
    :global(.game-card:hover) .go {
      opacity: 1;
    }
  }
</style>
