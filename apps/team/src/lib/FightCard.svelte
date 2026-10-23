<script lang="ts">
  // Fight card rows (ADR 0074): games in order of play, one compact row each, the same whatever the game's got to (the
  // front page's first match, Home's next fight). The time (Up next under the next one, Live on the one being played), the two teams one
  // over the other, a crest and a name each (yours in the club's red) with the score once there is one, and the game's
  // number (a playoff's name, the Final). A tap opens the game: its matchup, or on now its live page. Which games:
  // the caller's (lib/tournament-front.ts firstUpOf on the front page).
  import type { Tournament, TournamentGame } from "../demo/model";
  import { PLAYERS } from "../demo/data";
  import { typeById } from "../demo/schedule.svelte";
  import { nameOfTeam, teamNamesOf } from "./names";
  import { teamTone } from "./team-tones";
  import { clock } from "./dates";
  import { matchTime } from "./fixtures";
  import TeamCrest from "./TeamCrest.svelte";
  import Icon from "../app/shell/Icon.svelte";

  let {
    tournament: t,
    games,
    upNext,
    teamId,
    chant = "Live",
  }: {
    tournament: Tournament;
    /** The games to show, in order of play. */
    games: TournamentGame[];
    /** The next game to be played: marked Up next. */
    upNext?: TournamentGame;
    /** Your team, if you're on one: its name in red. */
    teamId?: number;
    /** What a game being played says: the crowd's chant ("Kumite!"). */
    chant?: string;
  } = $props();

  const slug = $derived(typeById(t.typeId)?.slug ?? "");
  const person = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const crestNames = $derived(teamNamesOf(t.teams, person));
  const nth = (n: number | null) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
  const side = (id: number | null, seed: number | null, goals: number | null) => {
    const i = t.teams.findIndex((x) => x.id === id);
    return {
      id,
      name: id ? nameOfTeam(t.teams[i], t.teams, person) : nth(seed),
      logo: t.teams[i]?.logo ?? null,
      tone: teamTone(i),
      goals,
    };
  };
  // Its kick-off, or once it's on or played, when it actually started (lib/fixtures.ts matchTime)
  const at = (g: TournamentGame) => clock(matchTime(t, g));
  // Once played, who won (nobody, a draw): the loser fades
  const lost = (g: TournamentGame, home: boolean) =>
    g.status === "done" &&
    g.homeGoals !== null &&
    g.awayGoals !== null &&
    (home ? g.homeGoals < g.awayGoals : g.awayGoals < g.homeGoals);
</script>

<ol class="fight-card">
  {#each games as g (g.id)}
    {@const live = g.status === "live"}
    {@const next = g === upNext}
    {@const sides = [side(g.homeTeamId, g.homeSeed, g.homeGoals), side(g.awayTeamId, g.awaySeed, g.awayGoals)]}
    <li>
      <a
        class="fight"
        class:done={g.status === "done"}
        href="/tournaments/{slug}/games/{g.id}{live ? '/live' : ''}"
        aria-label="{g.name || `Game ${g.position}`}, {live ? 'on now' : at(g)}: {sides[0].name} vs {sides[1].name}{next
          ? ', up next'
          : ''}"
      >
        <span class="when">
          <span class="at num">{at(g)}</span>
          {#if live}<span class="badge red live">{chant}</span>
          {:else if next}<span class="badge">Up next</span>
          {:else if g.status === "done"}<span class="hint small">Final</span>{/if}
        </span>
        <span class="sides">
          {#each sides as s, k (k)}
            <span class="side" class:lost={lost(g, k === 0)}>
              {#if s.id}<TeamCrest among={crestNames} name={s.name} logo={s.logo} tone={s.tone} size="1.75rem" />
              {:else}<span class="no-crest" aria-hidden="true"></span>{/if}
              <span class="name display" class:ours={!!teamId && s.id === teamId} class:seed={!s.id}>{s.name}</span>
              {#if s.goals !== null}<span class="goals num">{s.goals}</span>{/if}
            </span>
          {/each}
        </span>
        <span class="game hint small">{g.name || `Game ${g.position}`}</span>
        <Icon name="chevronRight" size={16} />
      </a>
    </li>
  {/each}
</ol>

<style>
  /* A desktop's column is wide: the rows keep to a list's width, so the number stays by the teams */
  .fight-card {
    display: grid;
    max-width: 40rem;
    gap: var(--s-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* One row a game: when, the two teams one over the other, its number. On the page, no card: warmed under the pointer */
  .fight {
    display: grid;
    /* Room for the longest time, "10:17am", beside the crests */
    grid-template-columns: 5.5rem minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-2) var(--s-2) 0;
    border-radius: var(--r-lg);
    color: var(--fg-muted);
    transition: background-color var(--t-fast) var(--ease);
  }
  @media (hover: hover) {
    .fight:hover {
      background: color-mix(in srgb, var(--red-hot) 7%, var(--surface-2));
    }
  }
  .when {
    display: grid;
    justify-items: start;
    gap: var(--s-1);
    padding-left: var(--s-2);
  }
  .at {
    color: var(--fg);
    white-space: nowrap;
    font-weight: 600;
  }
  .done .at {
    color: var(--fg-muted);
    font-weight: 400;
  }
  .sides {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  .side {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    color: var(--fg);
  }
  .side.lost {
    color: var(--fg-muted);
  }
  /* A playoff waiting on the table: the place, where the crest goes, so the names line up */
  .no-crest {
    flex: none;
    width: 1.75rem;
  }
  /* A name takes a second line rather than being cut short */
  .name {
    flex: 1;
    min-width: 0;
    font-size: 1.1rem;
    line-height: 1.1;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  /* A playoff waiting on the table: the places, quieter than a team */
  .seed {
    color: var(--fg-muted);
  }
  /* Yours, in the club's red: the accent, not a fill */
  .ours {
    color: var(--red-hot);
  }
  .goals {
    min-width: 1.5ch;
    font-size: var(--text-md);
    font-weight: 700;
    text-align: right;
  }
  .game {
    white-space: nowrap;
  }
  /* A narrow phone: the time's column and the gaps a little closer, so the names keep their room */
  @media (max-width: 380px) {
    .fight {
      grid-template-columns: 5rem minmax(0, 1fr) auto auto;
      gap: var(--s-2);
    }
    .when {
      padding-left: var(--s-1);
    }
  }
</style>
