<script lang="ts">
  // A player's position as its icon (the brand's Pick: a stick up front, a shield at the back, the net), its name on
  // hover and for a screen reader. In place of the F, D and G letters wherever a player's listed
  import Icon from "../app/shell/Icon.svelte";
  import { POSITIONS, POSITION_ICONS, type Position } from "../demo/data";

  let { position, size = 14 }: { position: Position; size?: number } = $props();
</script>

<span class="position" title={POSITIONS[position]}
  ><Icon name={POSITION_ICONS[position]} {size} /><span class="sr-only">{POSITIONS[position]}</span></span
>

<style>
  .position {
    display: inline-grid;
    place-items: center;
    vertical-align: middle;
  }
  .position :global(svg) {
    display: block;
  }
</style>
