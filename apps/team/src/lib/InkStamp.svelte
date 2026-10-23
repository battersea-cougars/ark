<script lang="ts" module>
  export type InkTone = "red" | "bone" | "faint" | "live";
</script>

<script lang="ts">
  // An ink stamp (the Kumite's hanko, ADR 0074): a kanji pressed in a block of ink, the word beside it in the display
  // face, the ink a little patchy (a noise mask), the edge uneven, askew. One look for every stamp, so they read as a
  // family: a tournament's status (lib/TournamentHead), and on its match cards You are next! and the results
  // (lib/GameCard). Only the ink changes: the club's red for what's yours or on now, bone for what's done, faint for
  // what's quiet; live, the whole stamp a block of red, breathing while it's being played. A series without the motif gets an icon in the block instead.
  import Icon from "../app/shell/Icon.svelte";
  import type { IconName } from "../app/shell/icons";

  let {
    text,
    kanji = "",
    icon,
    tone = "red",
    size = "head",
    tilt = -3,
    land = false,
    pulse = false,
    label,
  }: {
    text: string;
    /** In the block of ink; the Kumite's (lib/motif.ts). */
    kanji?: string;
    /** In the block when there's no kanji (a series without the motif). */
    icon?: IconName;
    tone?: InkTone;
    /** head: beside a page's title (a size down on a phone); card: on a match card, one size everywhere. */
    size?: "head" | "card";
    /** Askew, in degrees. */
    tilt?: number;
    /** Stamped down as it first shows (none with reduced motion). */
    land?: boolean;
    /** Breathing while it's happening (a match being played): the ink's glow swells and fades. */
    pulse?: boolean;
    /** Said for it; a status says "Status: …". */
    label?: string;
  } = $props();
</script>

<span
  class="ink {tone} {size}"
  class:land
  class:pulse
  style:--tilt="{tilt}deg"
  role={label ? "status" : undefined}
  aria-label={label}
  >{#if kanji}<span class="mark" lang="ja" aria-hidden="true">{kanji}</span>{:else if icon}<span
      class="mark icon"
      aria-hidden="true"><Icon name={icon} size={size === "card" ? 12 : 14} /></span
    >{/if}<span class="word">{text}</span></span
>

<style>
  .ink {
    --ink: var(--red-hot);
    display: inline-flex;
    align-items: stretch;
    align-self: center;
    flex: none;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    border: 2px solid var(--ink);
    border-radius: 0.45rem 0.25rem 0.5rem 0.3rem / 0.3rem 0.5rem 0.25rem 0.45rem;
    color: var(--ink);
    font-family: var(--font-display);
    font-size: 1.2rem;
    font-weight: 400;
    line-height: 1;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    transform: rotate(var(--tilt));
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='70'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1.4 1.55'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='70'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1.4 1.55'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    -webkit-mask-size: 140px 70px;
    mask-size: 140px 70px;
  }
  .mark {
    display: inline-grid;
    flex: none;
    place-items: center;
    padding: 0 0.3rem;
    background: var(--ink);
    color: var(--bg);
    font-family: var(--font-kanji);
    font-size: 0.9em;
    font-weight: 900;
    letter-spacing: 0;
  }
  .word {
    min-width: 0;
    overflow: hidden;
    padding: 0.22rem 0.55rem 0.14rem;
    text-overflow: ellipsis;
  }
  /* Quiet (Coming up, a draw, Up next): the same stamp, faint */
  .faint {
    --ink: var(--fg-muted);
  }
  /* Done, a win: bone, the club's red put away */
  .bone {
    --ink: var(--primary);
  }
  /* KUMITE!: the loudest, the whole stamp a block of ink, the kanji knocked out of it */
  .live {
    --ink: var(--red);
    background: var(--red);
    color: var(--on-red);
    box-shadow: 0 0 22px -6px color-mix(in srgb, var(--red) 70%, transparent);
  }
  .live .mark {
    background: color-mix(in srgb, var(--bg) 82%, var(--red));
    color: var(--red-hot);
  }
  /* On a match card: one size on every screen, so a card is the same height whichever stamp it wears */
  .card {
    border-width: 1.5px;
    font-size: 0.95rem;
  }
  .card .word {
    padding: 0.2rem 0.45rem 0.1rem;
  }
  .card .mark {
    padding: 0 0.25rem;
  }
  /* Stamped down: in from a little bigger and fainter, a thump, then still. Its box never changes, so nothing moves */
  @media (prefers-reduced-motion: no-preference) {
    .land {
      animation: land 0.42s cubic-bezier(0.2, 0.9, 0.3, 1.25) both;
    }
  }
  /* Being played: the stamp stays put, its glow breathes (none with reduced motion) */
  @media (prefers-reduced-motion: no-preference) {
    .pulse {
      animation: breathe 1.6s var(--ease-in-out) infinite;
    }
  }
  @keyframes breathe {
    50% {
      box-shadow: 0 0 30px -2px color-mix(in srgb, var(--ink) 85%, transparent);
      filter: brightness(1.18);
    }
  }
  @keyframes land {
    0% {
      opacity: 0;
      transform: rotate(calc(var(--tilt) - 6deg)) scale(1.9);
    }
    60% {
      opacity: 1;
      transform: rotate(var(--tilt)) scale(0.94);
    }
    100% {
      transform: rotate(var(--tilt)) scale(1);
    }
  }
  /* A page's head on a phone: the stamp sits in the eyebrow line, no taller than the line, so the header's height
     never changes */
  @media (max-width: 900px) {
    .head {
      border-width: 1.5px;
      font-size: 0.8rem;
    }
    .head .word {
      padding: 0.12rem 0.4rem 0.06rem;
    }
    .head .mark {
      padding: 0 0.22rem;
    }
  }
</style>
