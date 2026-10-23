<script lang="ts">
  // The red hanko (lib/Kanji's seal) pressed down like a rubber stamp: big and tilted, then flat on the card, a thud of
  // shadow, ink specks out from it. The teams sealed (lib/DraftStep) and each award revealed (lib/AwardStage, the
  // champions' 優勝 slammed down). `pressed` plays it, after `delay`; `drop`: the hanko isn't there till it lands.
  // Less motion: none of it, the hanko just there.
  import Kanji from "./Kanji.svelte";

  let {
    text,
    pressed = false,
    drop = false,
    delay = "0ms",
  }: {
    text: string;
    /** Pressed down now. */
    pressed?: boolean;
    /** Not there till it lands (an award's hanko); else there all along and pressed (the draft's seal). */
    drop?: boolean;
    /** When it comes down, after whatever comes before it. */
    delay?: string;
  } = $props();

  const SPECKS = [0, 1, 2, 3, 4, 5];
</script>

<span class="hanko-press" class:pressed class:drop style:--press-delay={delay}
  ><Kanji {text} seal />{#if pressed}{#each SPECKS as k (k)}<i
        class="ink"
        style:--a="{k * 60 + 15}deg"
        style:--d="{0.9 + (k % 3) * 0.35}rem"
      ></i>{/each}{/if}</span
>

<style>
  .hanko-press {
    position: relative;
    display: inline-grid;
  }
  .pressed {
    animation: press 350ms var(--press-delay) cubic-bezier(0.55, 0, 0.75, 0.2) both;
  }
  .pressed.drop {
    animation-name: drop;
  }
  @keyframes press {
    0% {
      transform: scale(1.4) rotate(-9deg);
      filter: drop-shadow(0 1.2rem 1rem rgb(0 0 0 / 0.45));
    }
    80% {
      transform: scale(0.96) rotate(-1deg);
      filter: drop-shadow(0 0.1rem 0.15rem rgb(0 0 0 / 0.6));
    }
    100% {
      transform: scale(1) rotate(0);
      filter: drop-shadow(0 0.15rem 0.3rem rgb(0 0 0 / 0.4));
    }
  }
  /* The same, from nothing: it isn't on the card till it comes down */
  @keyframes drop {
    0% {
      opacity: 0;
      transform: scale(1.6) rotate(-12deg);
      filter: drop-shadow(0 1.2rem 1rem rgb(0 0 0 / 0.45));
    }
    25% {
      opacity: 1;
    }
    80% {
      transform: scale(0.96) rotate(-1deg);
      filter: drop-shadow(0 0.1rem 0.15rem rgb(0 0 0 / 0.6));
    }
    100% {
      opacity: 1;
      transform: scale(1) rotate(0);
      filter: drop-shadow(0 0.15rem 0.3rem rgb(0 0 0 / 0.4));
    }
  }
  .ink {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4px;
    height: 4px;
    margin: -2px;
    border-radius: 50%;
    background: var(--red);
    opacity: 0;
    animation: speck 420ms calc(var(--press-delay) + 280ms) ease-out both;
  }
  @keyframes speck {
    0% {
      opacity: 0.9;
      transform: rotate(var(--a)) translateX(1.2rem) scale(1);
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateX(calc(1.2rem + var(--d))) scale(0.5);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pressed,
    .ink {
      animation: none;
    }
    .ink {
      display: none;
    }
  }
</style>
