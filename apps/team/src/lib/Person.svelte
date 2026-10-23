<script lang="ts">
  import { POSITIONS, type Player } from "../demo/data";
  import { goesBy } from "./names";
  import Avatar from "./Avatar.svelte";

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
  const position = $derived(POSITIONS[player.position]);
</script>

<Avatar {player} />
<span class="grow">
  <span class="title">{goesBy(player)}</span>
  {#if !bare}<span class="sub">{meta || position}{showRating ? ` · ${player.rating}` : ""}</span>{/if}
</span>
