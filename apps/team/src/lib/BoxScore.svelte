<script lang="ts">
  // A game's box score (ADR 0061): each team's goals per period, then the total (just the total for a one-period
  // game). No shots: we don't count them. Once it's over, the winner's row is bright and the loser's fades, as on the
  // fight card.
  import TeamCrest from "./TeamCrest.svelte";
  import { nameOfTeam } from "./names";
  import { teamTone } from "./team-tones";
  import { boxScore } from "./periods";
  import { PLAYERS } from "../demo/data";
  import type { Tournament, TournamentGame } from "../demo/model";

  let { tournament, game }: { tournament: Tournament; game: TournamentGame } = $props();

  const byId = (id: number | null) => (id ? PLAYERS.find((p) => p.id === id) : undefined);
  const sides = $derived([game.homeTeamId, game.awayTeamId].filter((t): t is number => t !== null));
  const box = $derived(boxScore(game.goals ?? [], sides, tournament.periods ?? 1));
  const totals = $derived(box.rows.map((r) => r.total));
  // Once played, who won it (nobody: level)
  const won = $derived(
    game.status !== "done" || totals[0] === totals[1] ? null : totals[0] > totals[1] ? sides[0] : sides[1],
  );
  const team = (id: number) => tournament.teams.find((t) => t.id === id);
  const indexOf = (id: number) => tournament.teams.findIndex((t) => t.id === id);
</script>

{#if sides.length === 2}
  <table class="box-score">
    <thead>
      <tr>
        <th scope="col"><span class="sr">Team</span></th>
        {#each box.columns as c (c)}<th scope="col" class="n">{c}</th>{/each}
        <th scope="col" class="n t">T</th>
      </tr>
    </thead>
    <tbody>
      {#each box.rows as r (r.teamId)}
        <tr class:won={won === r.teamId} class:lost={won !== null && won !== r.teamId}>
          <th scope="row">
            <span class="team">
              <TeamCrest
                name={nameOfTeam(team(r.teamId), tournament.teams, byId)}
                logo={team(r.teamId)?.logo ?? null}
                tone={teamTone(indexOf(r.teamId))}
                size="2rem"
              />
              <span class="tn">{nameOfTeam(team(r.teamId), tournament.teams, byId)}</span>
            </span>
          </th>
          {#each r.byPeriod as n, i (i)}<td class="n num">{n}</td>{/each}
          <td class="n t num">{r.total}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .box-score {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: var(--s-2) 0;
    font-weight: 400;
    text-align: left;
  }
  thead th {
    padding-top: 0;
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .n {
    width: 2.75rem;
    color: var(--fg-muted);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .t {
    color: var(--fg);
    font-weight: 700;
  }
  thead .t {
    color: var(--fg-subtle);
  }
  .team {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
  }
  .tn {
    overflow: hidden;
    color: var(--fg-body);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  tbody tr + tr th,
  tbody tr + tr td {
    padding-top: var(--s-1);
  }
  .won .tn {
    color: var(--fg);
    font-weight: 700;
  }
  .lost .tn,
  .lost .n {
    color: var(--fg-subtle);
  }
  .lost :global(.crest) {
    opacity: 0.55;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
