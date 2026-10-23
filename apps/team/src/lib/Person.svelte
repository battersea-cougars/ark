<script lang="ts">
  import { POSITIONS, type Player } from "../demo/data";
  import { initials } from "./initials";
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
  const avatar = $derived(initials(goesBy(player)));
  const position = $derived(POSITIONS[player.position]);
</script>

<span class="avatar">{avatar}</span>
<span class="grow">
  <span class="title">{goesBy(player)}</span>
  {#if !bare}<span class="sub">{meta || position}{showRating ? ` · ${player.rating}` : ""}</span>{/if}
</span>
