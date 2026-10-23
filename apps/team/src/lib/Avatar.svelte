<script lang="ts">
  // A member's avatar: their photo (ADR 0123), or their initials on a disc. The club's copy of them (the store) says
  // whether they have one, so a new photo shows everywhere as soon as it's saved.
  import type { Player } from "../demo/data";
  import { db } from "../demo/store.svelte";
  import { goesBy } from "./names";
  import { initials } from "./initials";
  import { photoUrl } from "./photo";

  let {
    player,
    big = false,
    extra = "",
  }: { player: Player; big?: boolean; /** More classes */ extra?: string } = $props();
  const src = $derived(photoUrl(db.members.find((m) => m.player.id === player.id)?.player ?? player));
</script>

<span class="avatar {extra}" class:big class:has-photo={src} aria-hidden="true"
  >{#if src}<img {src} alt="" loading="lazy" decoding="async" />{:else}{initials(goesBy(player))}{/if}</span
>
