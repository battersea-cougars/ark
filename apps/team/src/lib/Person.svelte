<script lang="ts">
  import { POSITIONS, type Player } from "../demo/data";
  import { goesBy } from "./names";

  let {
    player,
    showRating = false,
    meta,
    short = false,
  }: {
    player: Player;
    showRating?: boolean;
    meta?: string;
    /** The position as its letter (F, D, K), the word kept for screen readers: a tight list (Friday's) */
    short?: boolean;
  } = $props();
  const initials = $derived(
    goesBy(player)
      .split(" ")
      .map((w) => w[0])
      .join(""),
  );
  const position = $derived(POSITIONS[player.position]);
</script>

<span class="avatar">{initials}</span>
<span class="grow">
  <span class="title">{goesBy(player)}</span>
  <span class="sub"
    >{#if meta}{meta}{:else if short}<abbr title={position}
        ><span aria-hidden="true">{position[0]}</span><span class="sr-only">{position}</span></abbr
      >{:else}{position}{/if}{showRating ? ` · ${player.rating}` : ""}</span
  >
</span>

<style>
  /* The letter reads as plain text, not a dotted abbreviation */
  abbr {
    text-decoration: none;
  }
</style>
