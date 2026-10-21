<script lang="ts">
  // You're on Team X (ADR 0074): the lead of a tournament's front page once the teams are set. Its crest, its name big,
  // its captain and your teammates, on the page (not a card); a tap opens the team.
  import type { Tournament, TournamentType } from "../demo/model";
  import { PLAYERS } from "../demo/data";
  import { me } from "../demo/session.svelte";
  import { goesByOf, nameOfTeam, teamNamesOf } from "./names";
  import { teamHref, teamTone } from "./team-tones";
  import TeamCrest from "./TeamCrest.svelte";
  import Icon from "../app/shell/Icon.svelte";

  let { type, tournament: t, index }: { type: TournamentType; tournament: Tournament; index: number } = $props();

  const team = $derived(t.teams[index]);
  const byId = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const name = $derived(nameOfTeam(team, t.teams, byId));
  const captain = $derived(
    team.captainMemberId === me().id
      ? "You're the captain"
      : `Captain ${goesByOf(byId(team.captainMemberId)) || team.captainName}`,
  );
  // Everyone else on it, by the name they go by (a player from outside by theirs)
  const mates = $derived(
    team.players
      .filter((p) => p.memberId !== me().id && p.memberId !== team.captainMemberId)
      .map((p) => (p.memberId ? goesByOf(byId(p.memberId)) : p.name))
      .filter(Boolean),
  );
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(t.teams, byId));
</script>

<a class="your-team" href={team.id ? teamHref(type.slug, team.id) : undefined}>
  <TeamCrest among={crestNames} {name} logo={team.logo} tone={teamTone(index)} size="4.5rem" />
  <span class="words">
    <span class="eyebrow">You're on</span>
    <span class="name display">{name}</span>
    <span class="who"
      >{captain}{#if mates.length}<span class="mates">&nbsp;· with {mates.join(", ")}</span>{/if}</span
    >
  </span>
  <Icon name="chevronRight" size={18} />
</a>

<style>
  .your-team {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    min-width: 0;
    padding: var(--s-3) var(--s-3) var(--s-3) 0;
    border-radius: var(--r-lg);
    color: var(--fg-muted);
    transition: background-color var(--t-fast) var(--ease);
  }
  @media (hover: hover) {
    .your-team:hover {
      background: var(--surface-2);
    }
  }
  .words {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }
  .name {
    color: var(--fg);
    font-size: clamp(1.6rem, 6vw, 2.2rem);
    line-height: 1;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .who {
    font-size: var(--text-sm);
  }
  .mates {
    color: var(--fg-muted);
  }
</style>
