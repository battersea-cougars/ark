<script lang="ts">
  // The leaderboards (lib/leaders.ts): points, goals, assists and penalty minutes over one tournament's games or every
  // edition's (History), a tab a board; on a tournament's own board, each player's team under their name.
  import { teamsOf } from "./tournament-teams";
  import { playerOf } from "../demo/data";
  import { LEADER_STATS, leaders, ranked, type LeaderRow, type LeaderStat } from "./leaders";
  import type { Tournament, TournamentGame } from "../demo/model";
  import { nameOfMember } from "./names";

  let {
    games = [],
    counted,
    tournament,
    label = "Leaders",
  }: {
    games?: TournamentGame[];
    /** Already counted, in place of the games: every edition's, from the Worker (History). */
    counted?: LeaderRow[];
    /** One tournament's: its teams name each player's. */
    tournament?: Tournament;
    label?: string;
  } = $props();

  let stat = $state<LeaderStat>("points");
  const rows = $derived(counted ? ranked(counted, stat) : leaders(games, stat));
  const byId = (id: number | null) => playerOf(id);
  const teams = $derived(tournament?.teams ?? []);
  const look = $derived(teamsOf(teams));
  /** The name of the team they're on, or nothing. */
  const teamOf = (memberId: number) => look.nameOf(look.teamOf(memberId));
  const none: Record<LeaderStat, string> = {
    points: "No goals or assists yet.",
    goals: "No goals yet.",
    assists: "No assists yet.",
    pim: "No penalties yet.",
  };
</script>

<div class="leaders">
  <div class="tablist" role="tablist" aria-label={label}>
    {#each LEADER_STATS as s (s.key)}
      <button type="button" role="tab" aria-selected={stat === s.key} onclick={() => (stat = s.key)}>{s.label}</button>
    {/each}
  </div>
  {#if rows.length}
    <div class="list" role="tabpanel">
      <table class="num">
        <thead>
          <tr>
            <th class="l">Player</th>
            {#each LEADER_STATS.slice(1) as s (s.key)}<th class:on={stat === s.key} title={s.label}>{s.short}</th
              >{/each}
            <th class:on={stat === "points"} title="Points">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r, i (r.memberId)}
            {@const team = tournament ? teamOf(r.memberId) : ""}
            <tr class:top={i === 0}>
              <td class="l"
                ><span class="line"
                  ><span class="pos">{i === 0 || rows[i - 1][stat] !== r[stat] ? i + 1 : ""}</span><span class="who"
                    ><span class="name">{nameOfMember(r.memberId, byId)}</span>{#if team}<span class="team hint"
                        >{team}</span
                      >{/if}</span
                  ></span
                ></td
              >
              <td class:on={stat === "goals"}>{r.goals}</td>
              <td class:on={stat === "assists"}>{r.assists}</td>
              <td class:on={stat === "pim"}>{r.pim}</td>
              <td class:on={stat === "points"} class="pts">{r.points}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div role="tabpanel"><p class="hint empty">{none[stat]}</p></div>
  {/if}
</div>

<style>
  .leaders {
    display: grid;
    gap: var(--s-3);
    min-width: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: var(--s-3) var(--s-3);
    text-align: right;
    white-space: nowrap;
    color: var(--fg-muted);
  }
  td {
    border-top: 1px solid var(--border);
  }
  thead th {
    padding-top: var(--s-3);
    padding-bottom: var(--s-2);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  /* The board's own column: bright, the rest quieter */
  th.on,
  td.on {
    color: var(--fg);
    font-weight: 700;
  }
  .l {
    width: 100%;
    max-width: 0;
    text-align: left;
    padding-left: var(--s-4);
    color: var(--fg);
    font-weight: 500;
  }
  /* Its place, then the name (and team) beside it */
  .line {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .pts {
    padding-right: var(--s-4);
  }
  th:last-child {
    padding-right: var(--s-4);
  }
  .pos {
    flex: none;
    width: 1.75rem;
    color: var(--fg-subtle);
    font-weight: 400;
  }
  /* The leader's place in bone, bold, as the board's (BoardTable): the club's red is for what's on now */
  .top .pos {
    color: var(--fg);
    font-weight: 700;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .name,
  .team {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .team {
    font-size: var(--text-xs);
    font-weight: 400;
  }
  .empty {
    padding: var(--s-3) var(--s-4);
  }
</style>
