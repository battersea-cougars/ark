<script lang="ts">
  import { goesBy, matchesName, nameOfTeam } from "./names";
  import { MEMBERS, type Player } from "../demo/data";
  import type { Tournament } from "../demo/model";
  import Icon from "../app/shell/Icon.svelte";
  import Drawer from "./Drawer.svelte";
  import Person from "./Person.svelte";
  import { putOnTeam, takeOffTeam } from "../app/backend.svelte";

  // One team, edited directly, outside the draft (ADR 0060): someone drops out and an admin puts a replacement on.
  // Its players first (tap to take off: they stay signed up), then who could join: signed up and on no team, on
  // another team (they move), or anyone else (they're put in the tournament too). The captain stays.
  let {
    tournament,
    teamIndex,
    name,
    open = $bindable(false),
  }: { tournament: Tournament; teamIndex: number; name: string; open?: boolean } = $props();

  let search = $state("");
  const team = $derived(tournament.teams[teamIndex]);
  const captains = $derived(new Set(tournament.teams.map((t) => t.captainMemberId)));
  const teamOf = $derived(
    new Map(tournament.teams.flatMap((t, i) => t.players.flatMap((p) => (p.memberId ? [[p.memberId, i]] : [])))),
  );
  const active = $derived(
    MEMBERS.filter((m) => m.status === "active")
      .map((m) => m.player)
      .sort((a, b) => goesBy(a).localeCompare(goesBy(b))),
  );
  const found = (p: Player) => search.length < 2 || matchesName(p, search);
  const byId = (id: number) => active.find((p) => p.id === id);
  const teamLabel = (i: number) => nameOfTeam(tournament.teams[i], tournament.teams, (id) => byId(id ?? 0));

  const on = $derived(team.players.flatMap((p) => (p.memberId ? (byId(p.memberId) ?? []) : [])).filter(found));
  const free = $derived(
    active.filter((p) => tournament.going.includes(p.id) && !captains.has(p.id) && !teamOf.has(p.id) && found(p)),
  );
  const elsewhere = $derived(active.filter((p) => teamOf.has(p.id) && teamOf.get(p.id) !== teamIndex && found(p)));
  const others = $derived(
    active.filter((p) => !tournament.going.includes(p.id) && !captains.has(p.id) && !teamOf.has(p.id) && found(p)),
  );
</script>

{#snippet row(p: Player, action: "off" | "add" | "move", note = "")}
  <button
    class="row"
    onclick={() =>
      team.id &&
      (action === "off" ? takeOffTeam(tournament.id, team.id, p.id) : putOnTeam(tournament.id, team.id, p.id))}
  >
    <Person player={p} />
    <span class="state">
      {#if action === "off"}<span class="badge green">On</span>
      {:else if action === "move"}<span class="badge">{note} <Icon name="chevronRight" size={14} /></span>
      {:else}<span class="badge"><Icon name="plus" size={14} /> Add</span>{/if}
    </span>
  </button>
{/snippet}

<Drawer bind:open title={name} sub="{tournament.name} · edit the team">
  {#snippet top()}
    <label class="search">
      <Icon name="search" size={18} />
      <input class="input" placeholder="Find a player" bind:value={search} />
    </label>
  {/snippet}

  <h3 class="section-title">On the team · tap to take off</h3>
  <div class="list">
    {#if team.captainMemberId && byId(team.captainMemberId)}
      <div class="row">
        <Person player={byId(team.captainMemberId)!} />
        <span class="state"><span class="captain-mark"><span class="c" aria-hidden="true">C</span>Captain</span></span>
      </div>
    {/if}
    {#each on as p (p.id)}{@render row(p, "off")}{/each}
  </div>

  {#if free.length}
    <h3 class="section-title">Signed up, on no team · tap to add</h3>
    <div class="list">
      {#each free as p (p.id)}{@render row(p, "add")}{/each}
    </div>
  {/if}

  {#if elsewhere.length}
    <h3 class="section-title">On another team · tap to move here</h3>
    <div class="list">
      {#each elsewhere as p (p.id)}{@render row(p, "move", teamLabel(teamOf.get(p.id)!))}{/each}
    </div>
  {/if}

  {#if others.length}
    <h3 class="section-title">Everyone else · tap to put them in</h3>
    <div class="list">
      {#each others as p (p.id)}{@render row(p, "add")}{/each}
    </div>
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
