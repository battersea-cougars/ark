<script lang="ts">
  // Teammates: the club's active players. Everyone sees trading cards, A to Z; tap one to turn it over.
  // Someone who manages members also gets the join requests to approve, and a tap on a card opens everything about
  // them (MemberSheet). The table of everyone is Settings → Members.
  // A link to /more/teammates/:id (Unpaid fees, a training's card) opens here with that card up.
  import { goesBy, matchesName } from "../lib/names";
  import PageHeader from "../lib/PageHeader.svelte";
  import { can } from "../access/actions";
  import type { Player } from "../demo/data";
  import { granted, me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import { navigate } from "../app/router.svelte";
  import { saveMember } from "../app/backend.svelte";
  import Person from "../lib/Person.svelte";
  import PlayerCard from "../lib/PlayerCard.svelte";
  import PlayerCardZoom from "../lib/PlayerCardZoom.svelte";
  import MemberSheet from "../lib/MemberSheet.svelte";
  import AddMemberSheet from "../lib/AddMemberSheet.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import SearchField from "../lib/SearchField.svelte";
  import { phone } from "../lib/viewport.svelte";
  import { flip } from "svelte/animate";
  import { cardMoveMs, deal, easeOut } from "../app/motion";

  let { memberId }: { memberId?: number } = $props();

  const perms = $derived(granted());
  const ratings = $derived(can(perms, "read:Rating"));
  const admin = $derived(can(perms, "manage:Member"));
  // Adding someone to the club (ADR 0069)
  let adding = $state(false);
  const who = $derived(me());
  let filter = $state<"all" | "F" | "D" | "G">("all");
  let query = $state("");

  const pending = $derived(db.members.filter((m) => m.status === "pending"));
  const active = $derived(db.members.filter((m) => m.status === "active"));
  const shown = $derived(
    active.filter((m) => filter === "all" || m.player.position === filter).filter((m) => matchesName(m.player, query)),
  );
  const byCard = $derived([...shown].sort((a, b) => goesBy(a.player).localeCompare(goesBy(b.player))));

  // The card that's been picked up, and where it lies (none: it grows in place). Admins get the member sheet.
  let lifted = $state<{ player: Player; el?: HTMLElement } | null>(null);
  const open = (p: Player, el?: HTMLElement) => (lifted = { player: p, el });
  // Arrived by a link to a member: their card is already up
  $effect(() => {
    const m = memberId != null ? db.members.find((x) => x.player.id === memberId) : undefined;
    if (m && admin) lifted = { player: m.player };
  });
  function close() {
    lifted = null;
    if (memberId != null) navigate("/more/teammates", { replace: true });
  }
  function approve(m: (typeof pending)[number]) {
    m.status = "active";
    m.roles = ["Member"];
    saveMember(m);
  }
</script>

<div class="page full">
  <PageHeader
    title="Teammates"
    subtitle="{active.length} players · {active.filter((m) => m.player.cougar).length} Cougars{admin && pending.length
      ? ` · ${pending.length} asking to join`
      : ''}"
    active={filter === "all" ? 0 : 1}
    onclear={() => (filter = "all")}
  >
    {#snippet actions()}
      {#if admin}
        <button class="btn sm primary" aria-haspopup="dialog" onclick={() => (adding = true)}
          ><Icon name="userPlus" size={16} />Member</button
        >
      {/if}
    {/snippet}
    {#snippet toolbar()}
      <SearchField bind:value={query} placeholder="Search teammates" collapsible={!phone.current} />
    {/snippet}
    {#snippet filters()}
      <div class="filters" role="group" aria-label="Position">
        {#each [["all", "All", "teams"], ["F", "Forwards", "stick"], ["D", "Defence", "shield"], ["G", "Keepers", "net"]] as const as [v, label, icon] (v)}
          <button class="filter" aria-pressed={filter === v} onclick={() => (filter = v as typeof filter)}
            ><Icon name={icon} size={16} />{label}</button
          >
        {/each}
      </div>
    {/snippet}
  </PageHeader>

  {#if admin && pending.length}
    <h2 class="section-title">Asking to join</h2>
    <div class="list rise">
      {#each pending as m (m.player.id)}
        <div class="row">
          <Person player={m.player} />
          <button class="btn primary sm" onclick={() => approve(m)}>Approve</button>
        </div>
      {/each}
    </div>
  {/if}

  {#if !shown.length}<p class="hint">No one matches.</p>{/if}

  <div class="cards">
    <!-- A filter or a search deals cards in and folds them away; the rest glide to their places -->
    {#each byCard as m (m.player.id)}
      <div class="slot" animate:flip={{ duration: cardMoveMs, easing: easeOut }} in:deal out:deal={{ out: true }}>
        <PlayerCard
          player={m.player}
          you={m.player.id === who.id}
          showRating={ratings}
          lifted={lifted?.player.id === m.player.id}
          onopen={(el) => open(m.player, el)}
        />
      </div>
    {/each}
  </div>
</div>

{#if admin}<AddMemberSheet bind:open={adding} />{/if}

{#if lifted && admin}
  {#key lifted.player.id}
    <MemberSheet memberId={lifted.player.id} source={lifted.el} onclose={close} />
  {/key}
{:else if lifted}
  <PlayerCardZoom
    player={lifted.player}
    source={lifted.el}
    you={lifted.player.id === who.id}
    showRating={ratings}
    bio={lifted.player.bio}
    onclose={close}
  />
{/if}

<style>
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(6.4rem, 1fr));
    gap: var(--s-3);
  }
  @media (min-width: 901px) {
    .cards {
      grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
      gap: var(--s-4);
    }
  }
</style>
