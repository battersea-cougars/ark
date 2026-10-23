<script lang="ts">
  // A team in a tournament: its crest and name, the squad, and its games. Every team has one, reached from wherever
  // the team's shown, with a way back to them all; yours is also My team (no teamId: the one you're on). Its captain
  // (or an admin) edits its name and logo behind Edit, in a sheet (no name: "Team Dan", after them; no logo: the
  // initials). A draft's players only show once it's closed, to anyone outside it (ADR 0060).
  import PositionIcon from "../lib/PositionIcon.svelte";
  import { goesByOf, nameOfTeam, teamNamesOf } from "../lib/names";
  import EmptyState from "../lib/EmptyState.svelte";
  import { db } from "../demo/store.svelte";
  import { PLAYERS } from "../demo/data";
  import { granted, me } from "../demo/session.svelte";
  import { can } from "../access/actions";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import FixtureRow from "../lib/FixtureRow.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import TeamDrawer from "../lib/TeamDrawer.svelte";
  import TeamLookSheet from "../lib/TeamLookSheet.svelte";
  import { teamTone } from "../lib/team-tones";

  let { typeId, teamId }: { typeId: number; teamId?: number } = $props();

  const type = $derived(typeById(typeId)!);
  // The team's own tournament (a past one's team, from History), else the current one: yours is My team
  const tournament = $derived(
    (teamId && db.tournaments.find((t) => t.teams.some((x) => x.id === teamId))) || currentTournament(typeId),
  );
  const teams = $derived(tournament?.teams ?? []);
  const isMine = (t: (typeof teams)[number]) =>
    t.captainMemberId === me().id || t.players.some((p) => p.memberId === me().id);
  const index = $derived(teamId ? teams.findIndex((t) => t.id === teamId) : teams.findIndex(isMine));
  const mine = $derived(index >= 0 && isMine(teams[index]));
  // Still drafting, and you're not in it: who's on the team is the captains' business until it closes
  const drafting = $derived(
    tournament?.kind === "draft" &&
      tournament.draftState !== "closed" &&
      !mine &&
      !can(granted(), "run:Draft") &&
      !can(granted(), "manage:Tournament"),
  );
  const team = $derived(index >= 0 ? teams[index] : undefined);
  const byId = (id: number | null) => (id ? PLAYERS.find((p) => p.id === id) : undefined);
  const captain = $derived(byId(team?.captainMemberId ?? null));
  const fallback = $derived(team ? nameOfTeam({ ...team, name: "" }, teams, byId) : "");
  const isCaptain = $derived(!!team && team.captainMemberId === me().id);
  // An admin edits any team here: its name and logo as its captain does, and who's on it (TeamDrawer, ADR 0060)
  const admin = $derived(can(granted(), "manage:Tournament"));
  const canEdit = $derived(isCaptain || admin);
  let squadOpen = $state(false);
  const games = $derived(
    (tournament?.games ?? []).filter((g) => team?.id && (g.homeTeamId === team.id || g.awayTeamId === team.id)),
  );

  let lookOpen = $state(false);
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, byId));
</script>

<div class="page">
  <TournamentHead
    {type}
    {tournament}
    title={mine || !teamId ? "My team" : "Team"}
    back={{ href: `/tournaments/${type.slug}` }}
  />

  {#if !tournament || !team}
    <EmptyState icon="teams" title={teamId ? "Not found" : "No team yet"}>
      {teamId
        ? "There's no such team in this one."
        : "You're not on a team in this one. Captains pick theirs on draft night."}
      {#snippet action()}
        <a class="btn outline" href="/tournaments/{type.slug}/teams"><Icon name="teams" size={18} />All teams</a>
      {/snippet}
    </EmptyState>
  {:else}
    <section class="hero">
      <TeamCrest
        among={crestNames}
        name={team.name || fallback}
        logo={team.logo}
        tone={teamTone(index)}
        size="7rem"
        onclick={canEdit && team.id ? () => (lookOpen = true) : undefined}
      />
      <div class="who">
        <h2 class="display">{team.name || fallback}</h2>
        <p class="hint">
          Captain {goesByOf(captain)}{isCaptain ? " (you)" : ""}{#if !drafting}&nbsp;· {team.players.length + 1}
            {team.players.length ? "players" : "player so far"}{/if}
        </p>
      </div>
      {#if canEdit && team.id}
        <div class="edit">
          <button class="btn outline sm" onclick={() => (lookOpen = true)}>Edit the team</button>
          {#if admin}<button class="btn ghost sm" onclick={() => (squadOpen = true)}>Edit the squad</button>{/if}
        </div>
      {/if}
    </section>

    <section class="part">
      <div class="part-head">
        <h2 class="section-title">The squad</h2>
      </div>
      <ol class="rows">
        {#if captain}
          <li class="row">
            <span class="c display" title="Captain" aria-label="Captain">C</span>
            <span class="name"
              >{captain.name}{#if captain.id === me().id}<span class="you-stamp">You</span>{/if}</span
            >
            <span class="pos-badge"><PositionIcon position={captain.position} /></span>
          </li>
        {/if}
        {#each team.players as p (p.memberId ?? p.name)}
          {@const m = byId(p.memberId)}
          <li class="row">
            <span class="c"></span>
            <span class="name"
              >{goesByOf(m) || p.name}{#if p.memberId === me().id}<span class="you-stamp">You</span>{/if}</span
            >
            {#if m}<span class="pos-badge"><PositionIcon position={m.position} /></span>{/if}
          </li>
        {/each}
        {#if drafting}
          <li class="row empty">
            <span class="c"></span><span class="name">The rest are picked in the draft. Out once it's done.</span>
          </li>
        {:else if !team.players.length}
          <li class="row empty"><span class="c"></span><span class="name">Nobody picked yet</span></li>
        {/if}
      </ol>
    </section>

    <section class="part">
      <div class="part-head">
        <h2 class="section-title">{mine ? "Your games" : "Their games"}</h2>
        <a class="btn ghost sm" href="/tournaments/{type.slug}/schedule"
          >Full fight card<Icon name="chevronRight" size={16} /></a
        >
      </div>
      {#if games.length}
        <div class="list">
          {#each games as g (g.id)}
            <FixtureRow {tournament} game={g} live={g.status === "live"} chant="{type.shortName}!" />
          {/each}
        </div>
      {:else}
        <p class="note">The fixtures aren't out yet.</p>
      {/if}
    </section>
  {/if}
</div>

{#if tournament && canEdit && lookOpen && team?.id}
  <TeamLookSheet
    tournamentId={tournament.id}
    teamId={team.id}
    name={team.name}
    logo={team.logo}
    {fallback}
    bind:open={lookOpen}
  />
{/if}

{#if tournament && admin && team && index >= 0}
  <TeamDrawer {tournament} teamIndex={index} name={team.name || fallback} bind:open={squadOpen} />
{/if}

<style>
  .edit {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-left: auto;
  }
  .hero {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-4) var(--s-6);
  }
  .who {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }
  .who h2 {
    margin: 0;
    color: var(--fg);
    font-size: clamp(2rem, 5vw, 2.75rem);
    overflow-wrap: anywhere;
  }
  .who .hint {
    margin: 0;
  }
  .part {
    display: grid;
    gap: var(--s-3);
  }
  .part .section-title {
    margin: 0;
  }
  .part-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .part-head .btn {
    gap: var(--s-1);
  }
  .rows {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 2.75rem;
    padding: 0 var(--s-2);
    border-radius: var(--r-md);
    transition: background-color var(--t-fast) var(--ease);
  }
  .row:hover {
    background: var(--surface-2);
  }
  .row.empty .name {
    color: var(--fg-subtle);
    font-weight: 400;
  }
  /* The captain: a red C */
  .c {
    flex-shrink: 0;
    width: 1.2rem;
    color: var(--red-hot);
    font-size: 1.05rem;
    text-align: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--fg);
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
