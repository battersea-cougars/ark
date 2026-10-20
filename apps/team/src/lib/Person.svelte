<script lang="ts">
  import { POSITIONS, type Player } from "../demo/data";
  import { goesBy } from "./names";

  let {
    player,
    showRating = false,
    meta,
    bare = false,
  }: {
    player: Player;
    showRating?: boolean;
    meta?: string;
    /** Just the name, on one line: the row shows the position itself, as a badge (Friday's tight lists) */
    bare?: boolean;
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
  {#if !bare}<span class="sub">{meta || position}{showRating ? ` · ${player.rating}` : ""}</span>{/if}
</span>
