<script lang="ts">
  // A tournament's table (ADR 0061): its group games with a result, points, then goal difference, then goals for, with
  // its own points for a win, draw and loss; the champions marked once it's decided. On the board, on a past one's
  // page (History), and at the after-party in its final order.
  import { nameOfTeam, teamNamesOf } from "./names";
  import { PLAYERS } from "../demo/data";
  import type { Tournament, TournamentType } from "../demo/model";
  import { teamHref, teamTone } from "./team-tones";
  import TeamCrest from "./TeamCrest.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import InkStamp from "./InkStamp.svelte";
  import { kanjiFor } from "./motif";
  import { champion, table, type TableRow } from "./fixtures";

  let {
    type,
    tournament,
    order,
  }: {
    type: TournamentType;
    tournament: Tournament;
    /** The rows in another order: the after-party's, the champions first (lib/afters.ts finalOrder). */
    order?: TableRow[];
  } = $props();

  // This tournament's own points (ADR 0030)
  const points = $derived({ win: tournament.pointsWin, draw: tournament.pointsDraw, loss: tournament.pointsLoss });
  const teams = $derived(tournament.teams);
  const group = $derived((tournament.games ?? []).filter((g) => g.stage === "group"));
  const rows = $derived(
    order ??
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

<!-- A row a team: the whole row is the way to it (its name the link, its hit area the row), the chevron at the row's
     end lined up down the table, a long name cut short rather than wrapped -->
<div class="list">
  <table class="num">
    <thead
      ><tr
        ><th class="l">Team</th><th title="Played">P</th><th title="Won">W</th><th title="Drawn">D</th><th title="Lost"
          >L</th
        ><th title="Goal difference">GD</th><th class="pts" title="Points">Pts</th><th class="go"
          ><span class="sr-only">Open</span></th
        ></tr
      ></thead
    >
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
              /><a class="team-link" href={teamHref(type.slug, r.teamId)}>{teamName(r.teamId)}</a
              >{#if r.teamId === champ}<span class="champ-badge" title="{type.shortName} Champions"
                  ><InkStamp
                    size="card"
                    tone="bone"
                    kanji={kanjiFor(type, "champions")}
                    icon="trophy"
                    text="{type.shortName} Champions"
                  /></span
                >{/if}</span
            ></td
          >
          <td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td>
          <td>{r.gf - r.ga > 0 ? "+" : ""}{r.gf - r.ga}</td>
          <td class="pts">{r.pts}</td>
          <td class="go" aria-hidden="true"><Icon name="chevronRight" size={16} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
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
  /* The team's column takes what the figures leave, and a long name is cut short in it */
  .l {
    width: 100%;
    max-width: 0;
    text-align: left;
    padding-left: var(--s-4);
    color: var(--fg);
    font-weight: 500;
  }
  /* The team: its place, its crest, its name, on one line */
  .team {
    display: flex;
    align-items: center;
    min-width: 0;
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
  .team-link {
    min-width: 0;
    overflow: hidden;
    color: inherit;
    text-overflow: ellipsis;
  }
  /* The whole row is the link's: its hit area stretched over the row */
  tbody tr {
    position: relative;
    transition: background-color var(--t-fast) var(--ease-in-out);
  }
  .team-link::after {
    content: "";
    position: absolute;
    inset: 0;
  }
  .team-link:focus-visible {
    outline: none;
  }
  /* Under the pointer or focus: the row warms with the club's red, as a match card does, and its chevron firms up */
  tbody tr:has(.team-link:focus-visible) {
    background: color-mix(in srgb, var(--red-hot) 7%, var(--surface-2));
    outline: 2px solid var(--focus, var(--fg-muted));
    outline-offset: -2px;
  }
  @media (hover: hover) {
    tbody tr:hover {
      background: color-mix(in srgb, var(--red-hot) 7%, var(--surface-2));
    }
    tbody tr:hover .go {
      color: var(--fg);
    }
  }
  /* The champions' stamp, as the match cards' (lib/InkStamp): bone, the win's ink */
  .champ-badge {
    display: inline-flex;
    flex: none;
    margin-left: var(--s-3);
  }
  .pts {
    color: var(--fg);
    font-weight: 700;
  }
  /* The way to the team, at the row's end: the same place in every row */
  .go {
    width: 1rem;
    padding-left: 0;
    padding-right: var(--s-3);
    color: var(--fg-subtle);
  }
  td.go :global(svg) {
    display: block;
    margin-left: auto;
  }
  /* A phone: every column in the width (none past the edge), the figures closer */
  @media (max-width: 600px) {
    th,
    td {
      padding-inline: var(--s-2);
    }
    .l {
      padding-left: var(--s-3);
    }
    .go {
      padding-left: 0;
      padding-right: var(--s-2);
    }
    .l :global(.crest) {
      margin-right: var(--s-2);
    }
    /* The champions: the stamp's block alone (優勝, or the trophy), the name keeping the room */
    .champ-badge :global(.word) {
      display: none;
    }
    .champ-badge {
      margin-left: var(--s-2);
    }
  }
  /* A narrow one: the crests go (the names say it), so the table's columns fit */
  @media (max-width: 420px) {
    .l :global(.crest) {
      display: none;
    }
  }
</style>
