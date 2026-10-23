<script lang="ts">
  // A tournament's table (ADR 0061): its group games with a result, points, then goal difference, then goals for, with
  // its own points for a win, draw and loss; the champions marked once it's decided. On the board, and on a past
  // one's page (History).
  import { nameOfTeam, teamNamesOf } from "./names";
  import { PLAYERS } from "../demo/data";
  import type { Tournament, TournamentType } from "../demo/model";
  import { teamHref, teamTone } from "./team-tones";
  import TeamCrest from "./TeamCrest.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { champion, table } from "./fixtures";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  // This tournament's own points (ADR 0030)
  const points = $derived({ win: tournament.pointsWin, draw: tournament.pointsDraw, loss: tournament.pointsLoss });
  const teams = $derived(tournament.teams);
  const group = $derived((tournament.games ?? []).filter((g) => g.stage === "group"));
  const rows = $derived(
    table(
      teams.flatMap((t) => (t.id ? [t.id] : [])),
      group,
      points,
    ),
  );
  // Who won, once it's decided: the final's winner, else the top of the table (lib/fixtures.ts)
  const champ = $derived(
    champion(
      teams.flatMap((t) => (t.id ? [t.id] : [])),
      tournament.games ?? [],
      points,
    ),
  );
  const teamName = (id: number) => {
    const t = teams.find((x) => x.id === id);
    return nameOfTeam(t, teams, (id) => PLAYERS.find((p) => p.id === id));
  };
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, (id) => PLAYERS.find((p) => p.id === id)));
</script>

<div class="list">
  <table class="num">
    <thead><tr><th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
    <tbody>
      {#each rows as r, i (r.teamId)}
        <tr class:top={i === 0 && r.p > 0} class:champ={r.teamId === champ}>
          <td class="l"
            ><span class="team"
              ><span class="pos">{i + 1}</span><TeamCrest
                among={crestNames}
                name={teamName(r.teamId)}
                logo={teams.find((t) => t.id === r.teamId)?.logo ?? null}
                tone={teamTone(teams.findIndex((t) => t.id === r.teamId))}
                size="2.75rem"
              /><a class="team-link" href={teamHref(type.slug, r.teamId)}
                >{teamName(r.teamId)}<Icon name="chevronRight" size={14} /></a
              ></span
            >{#if r.teamId === champ}<span class="badge champ-badge"><Icon name="trophy" size={13} />Champions</span
              >{/if}</td
          >
          <td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td>
          <td>{r.gf - r.ga > 0 ? "+" : ""}{r.gf - r.ga}</td>
          <td class="pts">{r.pts}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .champ-badge {
    gap: 0.3rem;
    margin-left: var(--s-3);
    vertical-align: middle;
  }
  /* Plainly a way to the team, pointer or not: the name with a chevron */
  .team-link {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: inherit;
  }
  .team-link :global(svg) {
    flex: none;
    color: var(--fg-subtle);
  }
  .team-link:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: var(--s-4) var(--s-3);
    text-align: right;
    white-space: nowrap;
  }
  td {
    border-top: 1px solid var(--border);
    color: var(--fg-body);
  }
  thead th {
    padding-top: var(--s-3);
    padding-bottom: var(--s-2);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .l {
    text-align: left;
    padding-left: var(--s-4);
    color: var(--fg);
    font-weight: 500;
  }
  /* The team: its place, its crest, its name, on one line (a long name wraps beside them on a phone) */
  .team {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
  }
  .l :global(.crest) {
    flex-shrink: 0;
    margin-right: var(--s-3);
  }
  .pos {
    flex-shrink: 0;
    width: 1.5rem;
    color: var(--fg-subtle);
    font-weight: 400;
  }
  /* The leaders' places in bone, bold: the table's colour is the words, the club's red kept for what's on now */
  .top .pos {
    color: var(--fg);
    font-weight: 700;
  }
  .pts {
    padding-right: var(--s-4);
    color: var(--fg);
    font-weight: 700;
  }
  /* A phone: every column in the width (none past the edge), the figures closer, a long name on two lines */
  @media (max-width: 600px) {
    th,
    td {
      padding-inline: var(--s-2);
    }
    .l {
      padding-left: var(--s-3);
      white-space: normal;
    }
    .pts {
      padding-right: var(--s-3);
    }
    .l :global(.crest) {
      margin-right: var(--s-2);
    }
  }
  /* A narrow one: the crests go (the names say it), so the table's seven columns fit */
  @media (max-width: 420px) {
    .l :global(.crest) {
      display: none;
    }
  }
</style>
