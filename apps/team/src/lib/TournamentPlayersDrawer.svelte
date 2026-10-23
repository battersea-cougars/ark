<script lang="ts">
  import { goesBy, matchesName } from "./names";
  import { MEMBERS, type Player } from "../demo/data";
  import Icon from "../app/shell/Icon.svelte";
  import Drawer from "./Drawer.svelte";
  import Person from "./Person.svelte";
  import { setTournamentPlayers } from "../app/backend.svelte";
  import { SvelteMap } from "svelte/reactivity";

  // Who's in a tournament, in a drawer over the draft: an admin puts in someone who didn't sign up (sign-up shut or
  // not, past the limit) or takes someone off, who then comes off their team too. Captains are in automatically and
  // change in the tournament's settings. Search narrows the list. One list, A to Z: a tap says In or Add at once and
  // the row stays where it is, so adding a run of people needs no scrolling. Nothing's sent until the drawer closes
  // (Done, or however it's shut): then every change goes in one save.
  let {
    tournamentId,
    going,
    captains,
    sub,
    open = $bindable(false),
  }: { tournamentId: number; going: number[]; captains: Set<number | null>; sub: string; open?: boolean } = $props();

  let search = $state("");
  const active = $derived(
    MEMBERS.filter((m) => m.status === "active")
      .map((m) => m.player)
      .sort((a, b) => goesBy(a).localeCompare(goesBy(b))),
  );
  const found = (p: Player) => search.length < 2 || matchesName(p, search);
  // The taps so far, kept here until the drawer closes
  const tapped = new SvelteMap<number, boolean>();
  const isIn = (id: number) => tapped.get(id) ?? going.includes(id);
  const shown = $derived(active.filter((p) => !captains.has(p.id) && found(p)));
  const count = $derived(active.filter((p) => !captains.has(p.id) && isIn(p.id)).length);

  function toggle(id: number) {
    const to = !isIn(id);
    if (going.includes(id) === to) tapped.delete(id);
    else tapped.set(id, to);
  }

  // Closed: what changed is saved, then the list reads from `going` again
  $effect(() => {
    if (open || !tapped.size) return;
    const players = [...tapped].map(([memberId, inIt]) => ({ memberId, in: inIt }));
    tapped.clear();
    void setTournamentPlayers(tournamentId, players);
  });
</script>

{#snippet row(p: Player)}
  {@const on = isIn(p.id)}
  <button class="row" aria-label={on ? `${goesBy(p)}, in: take off` : `Add ${goesBy(p)}`} onclick={() => toggle(p.id)}>
    <Person player={p} />
    <span class="state">
      {#if on}<span class="badge green">In</span>
      {:else}<span class="badge"><Icon name="plus" size={14} /> Add</span>{/if}
    </span>
  </button>
{/snippet}

<Drawer bind:open title="Add player" {sub}>
  {#snippet top()}
    <label class="search">
      <Icon name="search" size={18} />
      <input class="input" aria-label="Find a player" placeholder="Find a player" bind:value={search} />
    </label>
  {/snippet}

  <h3 class="section-title"><span class="num">{count}</span> in · tap to add or take off</h3>
  {#if shown.length}
    <div class="list">
      {#each shown as p (p.id)}{@render row(p)}{/each}
    </div>
  {:else}
    <p class="hint">No one matches.</p>
  {/if}

  {#snippet footer()}
    <button class="btn primary block" onclick={() => (open = false)}>Done</button>
  {/snippet}
</Drawer>

<style>
  .search {
    position: relative;
    display: block;
    color: var(--fg-subtle);
  }
  .search :global(svg) {
    position: absolute;
    left: var(--s-4);
    top: 50%;
    translate: 0 -50%;
  }
  .search input {
    padding-left: 2.75rem;
  }
  .state {
    display: inline-flex;
    justify-content: flex-end;
    min-width: 5.5rem;
  }
</style>
