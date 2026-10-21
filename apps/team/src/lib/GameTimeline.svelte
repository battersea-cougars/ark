<script lang="ts">
  // A game's goals and penalties in time order (ADR 0061): each on its team's side, when down the middle, with the
  // score a goal made, or a penalty's minutes (a penalty shot, where that's the tournament's rule). Grouped under each
  // period when the game has more than one. Latest first while it's on; in order once it's played. With `onremove`
  // (an admin putting a result right), each row has Take off.
  import Icon from "../app/shell/Icon.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { goesByOf, nameOfTeam } from "./names";
  import { teamTone } from "./team-tones";
  import { mmss } from "./game-clock.svelte";
  import { infractionLabel } from "./penalties";
  import { periodName } from "./periods";
  import { PLAYERS } from "../demo/data";
  import type { GamePenalty, Tournament, TournamentGame } from "../demo/model";

  let {
    tournament,
    game,
    latestFirst = false,
    busy = false,
    onremove,
  }: {
    tournament: Tournament;
    game: TournamentGame;
    latestFirst?: boolean;
    busy?: boolean;
    onremove?: (kind: "goal" | "penalty", id: number) => void;
  } = $props();

  const teams = $derived(tournament.teams);
  const byId = (id: number | null) => (id ? PLAYERS.find((p) => p.id === id) : undefined);
  const indexOf = (teamId: number | null) => teams.findIndex((t) => t.id === teamId);
  const teamName = (teamId: number | null) => nameOfTeam(teams[indexOf(teamId)], teams, byId);
  const who = (memberId: number | null) => goesByOf(byId(memberId)) || "Bench";
  const sitOut = $derived(tournament.penaltyRule === "sit_out");
  const periods = $derived(tournament.periods ?? 1);

  type Entry =
    | (NonNullable<TournamentGame["goals"]>[number] & { kind: "goal"; key: string; isHome: boolean; score: string })
    | (GamePenalty & { kind: "penalty"; key: string; isHome: boolean });
  const entries = $derived.by(() => {
    let home = 0;
    let away = 0;
    const goals: Entry[] = (game.goals ?? []).map((g) => {
      const isHome = g.teamId === game.homeTeamId;
      if (isHome) home++;
      else away++;
      return { ...g, kind: "goal" as const, key: `g${g.id}`, isHome, score: `${home}–${away}` };
    });
    const penalties: Entry[] = (game.penalties ?? []).map((p) => ({
      ...p,
      kind: "penalty" as const,
      key: `p${p.id}`,
      isHome: p.teamId === game.homeTeamId,
    }));
    // In time order (none said: last), goals first at the same moment, each kind in its own order
    const when = (e: Entry) => (e.atMs === null ? Infinity : ((e.period ?? 1) - 1) * 1e9 + e.atMs);
    const sorted = [...goals, ...penalties]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => when(a.e) - when(b.e) || a.i - b.i)
      .map(({ e }) => e);
    return latestFirst ? sorted.reverse() : sorted;
  });
  // Under each period (none said: under none), in the entries' order
  const groups = $derived.by(() => {
    const out: { key: string; title: string; rows: Entry[] }[] = [];
    for (const e of entries) {
      const p = periods > 1 && e.atMs !== null ? (e.period ?? 1) : 0;
      const key = String(p);
      let g = out.find((x) => x.key === key);
      if (!g) out.push((g = { key, title: p ? `${periodName(p)} period` : periods > 1 ? "Not timed" : "", rows: [] }));
      g.rows.push(e);
    }
    return out;
  });
</script>

{#each groups as group (group.key)}
  {#if group.title}<h3 class="period-title">{group.title}</h3>{/if}
  <ol class="stream">
    {#each group.rows as g (g.key)}
      <li class="goal-row" class:home={g.isHome} class:pen={g.kind === "penalty"}>
        <span class="scored">
          <TeamCrest
            name={teamName(g.teamId)}
            logo={teams[indexOf(g.teamId)]?.logo ?? null}
            tone={teamTone(indexOf(g.teamId))}
            size={g.kind === "goal" ? "3.75rem" : "2.25rem"}
          />
          <span class="who">
            <span class="team-label">{teamName(g.teamId)}</span>
            {#if g.kind === "goal"}
              <span class="scorer">{goesByOf(byId(g.scorerId)) || "Goal"}</span>
              {#if g.assistId}<span class="assist">Assist · {goesByOf(byId(g.assistId))}</span>{/if}
            {:else}
              <span class="scorer">{who(g.memberId)}</span>
              {#if (sitOut && g.memberId !== null) || g.infraction}<span class="assist"
                  >{[sitOut && g.memberId !== null ? `Sits ${g.minutes}` : "", infractionLabel(g.infraction)]
                    .filter(Boolean)
                    .join(" · ")}</span
                >{/if}
            {/if}
          </span>
        </span>
        {#if onremove}
          <!-- Putting it right: any goal or penalty comes off, from the empty side of its row -->
          <button class="btn ghost sm take-off" disabled={busy} onclick={() => onremove(g.kind, g.id)}
            ><Icon name="x" size={15} />Take off</button
          >
        {/if}
        <span class="at">
          <span class="at-time display num">{g.atMs === null ? "–" : mmss(g.atMs)}</span>
          <span class="at-score num">{g.kind === "goal" ? g.score : sitOut ? "Penalty shot" : `PIM ${g.minutes}`}</span>
        </span>
      </li>
    {/each}
  </ol>
{/each}

<style>
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .period-title {
    margin: var(--s-3) var(--s-1) 0;
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .stream {
    display: grid;
  }

  .goal-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 4.5rem minmax(0, 1fr);
    align-items: center;
    min-height: 5.5rem;
    padding-block: var(--s-3);
  }

  .goal-row + .goal-row {
    border-top: 1px solid var(--border);
  }

  .at {
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    grid-column: 2;
    grid-row: 1;
  }

  .at-time {
    color: var(--fg);
    font-size: 1.5rem;
    line-height: 1;
  }

  .at-score {
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .scored {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    grid-column: 3;
    grid-row: 1;
  }

  .home .scored {
    flex-direction: row-reverse;
    grid-column: 1;
    text-align: right;
  }

  .who {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .team-label {
    overflow: hidden;
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .scorer {
    overflow: hidden;
    color: var(--fg);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .assist {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .take-off {
    grid-row: 1;
    grid-column: 3;
    justify-self: start;
    gap: var(--s-1);
  }

  .home .take-off {
    grid-column: 3;
  }

  .goal-row:not(.home) .take-off {
    grid-column: 1;
    justify-self: end;
  }

  .goal-row.pen {
    min-height: 3.75rem;
  }

  .pen .scorer {
    font-weight: 500;
  }

  .pen .at-time {
    font-size: 1.1rem;
  }
</style>
