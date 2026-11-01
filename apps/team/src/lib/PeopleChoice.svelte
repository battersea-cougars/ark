<script lang="ts">
  // Choose one of a tournament's players (ADR 0044): big rows, one tap, the one chosen ticked, each with their team
  // under them. No drop-down: a member's vote, and the admin's live call at the reveal, both in a sheet.
  import Icon from "../app/shell/Icon.svelte";
  import { PLAYERS } from "../demo/data";
  import type { Tournament } from "../demo/model";
  import { goesByOf, nameOfTeam } from "./names";

  let {
    tournament,
    people,
    value = $bindable(null),
    disabled = false,
    "aria-label": ariaLabel,
  }: {
    tournament: Pick<Tournament, "teams">;
    people: number[];
    value?: number | null;
    disabled?: boolean;
    "aria-label"?: string;
  } = $props();

  const byId = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const teamOf = (id: number) =>
    tournament.teams.find((t) => t.captainMemberId === id || t.players.some((p) => p.memberId === id));
  const rows = $derived(
    people
      .map((id) => ({ id, name: goesByOf(byId(id)), team: teamOf(id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
</script>

<div class="people" role="listbox" aria-label={ariaLabel}>
  {#each rows as p (p.id)}
    <button
      type="button"
      class="option"
      role="option"
      aria-selected={value === p.id}
      {disabled}
      onclick={() => (value = p.id)}
    >
      <span class="who">
        <span class="name">{p.name}</span>
        {#if p.team}<span class="hint">{nameOfTeam(p.team, tournament.teams, (id) => byId(id))}</span>{/if}
      </span>
      <!-- The tick's room kept, so choosing moves nothing -->
      <span class="tick"
        >{#if value === p.id}<Icon name="check" size={18} />{/if}</span
      >
    </button>
  {/each}
</div>

<style>
  .people {
    display: grid;
    gap: var(--s-1);
  }
  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    min-height: 3.5rem;
    padding: var(--s-1) var(--s-4);
    border: 0;
    border-radius: var(--r-lg);
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-md);
    text-align: left;
  }
  .option:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .option[aria-selected="true"] {
    background: var(--surface-2);
    font-weight: 600;
  }
  .option:disabled {
    cursor: default;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .name,
  .hint {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    font-size: var(--text-sm);
    font-weight: 400;
  }
  .tick {
    display: inline-flex;
    flex: none;
    width: 18px;
  }
</style>
