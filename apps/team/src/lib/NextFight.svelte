<script lang="ts">
  // Your next fight (ADR 0074): your team against theirs, when, and a tap to the game (its matchup; on now, the live
  // page). The lead of a tournament's front page once the fixtures are out, and on Home while you've one coming. One
  // line on the page, not a card: the two crests, the names in the display face, yours first and marked.
  import type { Tournament, TournamentGame } from "../demo/model";
  import { PLAYERS } from "../demo/data";
  import { typeById } from "../demo/schedule.svelte";
  import { nameOfTeam } from "./names";
  import { teamTone } from "./team-tones";
  import { clock, formatDayDate, londonISO, londonToday } from "./dates";
  import { kickOff, slotMinutes } from "./fixtures";
  import TeamCrest from "./TeamCrest.svelte";
  import Icon from "../app/shell/Icon.svelte";

  let {
    tournament: t,
    game: g,
    teamId,
    day = false,
  }: {
    tournament: Tournament;
    game: TournamentGame;
    /** Your team: it goes first, whichever end it's at. */
    teamId: number;
    /** Say the day too, unless it's today (Home: it isn't under the tournament's own date). */
    day?: boolean;
  } = $props();

  const slug = $derived(typeById(t.typeId)?.slug ?? "");
  const live = $derived(g.status === "live");
  const href = $derived(`/tournaments/${slug}/games/${g.id}${live ? "/live" : ""}`);
  const side = (id: number | null) => {
    const i = t.teams.findIndex((x) => x.id === id);
    return {
      name: nameOfTeam(t.teams[i], t.teams, (p) => PLAYERS.find((x) => x.id === p)),
      logo: t.teams[i]?.logo ?? null,
      tone: teamTone(i),
    };
  };
  const ours = $derived(side(teamId));
  const theirs = $derived(side(g.homeTeamId === teamId ? g.awayTeamId : g.homeTeamId));
  const at = $derived(clock(kickOff(t.startTime, slotMinutes(t), g.position)));
  const on = $derived(
    day && !t.season && t.heldOn !== londonToday() ? formatDayDate(londonISO(t.heldOn, t.startTime)) : "",
  );
</script>

<a class="next-fight" {href} aria-label="Your next fight: {ours.name} vs {theirs.name}, {live ? 'on now' : at}">
  <span class="crests" aria-hidden="true">
    <TeamCrest name={ours.name} logo={ours.logo} tone={ours.tone} size="2.75rem" />
    <TeamCrest name={theirs.name} logo={theirs.logo} tone={theirs.tone} size="2.75rem" />
  </span>
  <span class="words">
    <span class="match display"
      ><span class="name ours">{ours.name}</span> <span class="vs">vs</span>
      <span class="name">{theirs.name}</span></span
    >
    <span class="when">
      {#if live}<span class="badge red live">On now</span>{:else}<span class="at num">{at}</span>{/if}
      {#if on}<span>{on}</span>{/if}
      <span>Game {g.position}</span>
    </span>
  </span>
  <Icon name="chevronRight" size={18} />
</a>

<style>
  .next-fight {
    display: flex;
    align-items: center;
    gap: var(--s-3) var(--s-4);
    min-width: 0;
    padding: var(--s-3) var(--s-2) var(--s-3) 0;
    border-radius: var(--r-lg);
    color: var(--fg-muted);
    transition: background-color var(--t-fast) var(--ease);
  }
  @media (hover: hover) {
    .next-fight:hover {
      background: color-mix(in srgb, var(--red-hot) 7%, var(--surface-2));
    }
  }
  /* Yours, then theirs, side by side */
  .crests {
    display: flex;
    flex: none;
    gap: var(--s-1);
  }
  .words {
    display: grid;
    flex: 1;
    gap: var(--s-1);
    min-width: 0;
  }
  .match {
    color: var(--fg);
    font-size: clamp(1.25rem, 4.5vw, 1.6rem);
    line-height: 1.1;
    text-transform: uppercase;
  }
  /* A name breaks between names, never inside one; too long for the line, it's cut short */
  .name {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    vertical-align: bottom;
  }
  /* Yours, in the club's red: the accent, not a fill */
  .ours {
    color: var(--red-hot);
  }
  .vs {
    color: var(--fg-subtle);
    font-family: var(--font);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    vertical-align: 0.2em;
  }
  .when {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1) var(--s-3);
    font-size: var(--text-sm);
  }
  .at {
    color: var(--fg);
    font-weight: 600;
  }
</style>
