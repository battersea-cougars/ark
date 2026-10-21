<script lang="ts">
  import { nameOfTeam, teamNamesOf } from "./names";
  // The tournament's champions, once it's decided (lib/edition.ts championOf: the final's winner, or the top of the
  // table without playoffs). Not a card: the crest big, the trophy, the name in the display face, and how they won
  // it, on the page itself. The crest and name lead to the team.
  import { PLAYERS } from "../demo/data";
  import type { Tournament, TournamentType } from "../demo/model";
  import Icon from "../app/shell/Icon.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { championOf } from "./edition";
  import { table } from "./fixtures";
  import { teamHref, teamTone } from "./team-tones";
  import Kanji from "./Kanji.svelte";
  import { kanjiFor } from "./motif";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  const teams = $derived(tournament.teams);
  const winnerId = $derived(championOf(tournament));
  const index = $derived(teams.findIndex((t) => t.id === winnerId));
  const team = $derived(index >= 0 ? teams[index] : undefined);
  const nameOf = (id: number | null) => {
    const t = teams.find((x) => x.id === id);
    return nameOfTeam(t, teams, (id) => PLAYERS.find((p) => p.id === id));
  };
  // How they won it: the final's score, or their points at the top of the table
  const how = $derived.by(() => {
    const playoffs = (tournament.games ?? []).filter((g) => g.stage === "playoff");
    if (playoffs.length) {
      const f = playoffs.reduce((a, b) => (b.position > a.position ? b : a));
      const home = f.homeTeamId === winnerId;
      const [us, them] = home ? [f.homeGoals, f.awayGoals] : [f.awayGoals, f.homeGoals];
      return `Beat ${nameOf(home ? f.awayTeamId : f.homeTeamId)} ${us}–${them} in the final`;
    }
    const top = table(
      teams.flatMap((t) => (t.id ? [t.id] : [])),
      tournament.games ?? [],
      { win: tournament.pointsWin, draw: tournament.pointsDraw, loss: tournament.pointsLoss },
    )[0];
    return top ? `Top of the table, ${top.pts} points from ${top.p}` : "";
  });
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, (id) => PLAYERS.find((p) => p.id === id)));
</script>

{#if team && winnerId}
  <section class="champ" aria-label="{type.shortName} champions">
    <a class="crest-link" href={teamHref(type.slug, winnerId)}>
      <TeamCrest among={crestNames} name={nameOf(winnerId)} logo={team.logo} tone={teamTone(index)} size="7rem" />
      <!-- The Kumite's victory seal, stamped on the crest's corner -->
      {#if kanjiFor(type, "champions")}<span class="stamp"><Kanji text={kanjiFor(type, "champions")} seal /></span>{/if}
    </a>
    <div class="words">
      <span class="eyebrow"><Icon name="trophy" size={18} />{type.shortName} champions</span>
      <a class="name display" href={teamHref(type.slug, winnerId)}>{nameOf(winnerId)}</a>
      {#if how}<span class="how">{how}</span>{/if}
    </div>
  </section>
{/if}

<style>
  .champ {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-4) var(--s-6);
    padding-block: var(--s-4);
  }
  .crest-link {
    position: relative;
    flex-shrink: 0;
  }
  .stamp {
    position: absolute;
    right: -1rem;
    bottom: -0.75rem;
  }
  .words {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--caution-ink);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .name {
    color: var(--fg);
    overflow-wrap: anywhere;
    font-size: clamp(2.5rem, 8vw, 4rem);
    line-height: 0.95;
  }
  .how {
    color: var(--fg-muted);
  }
</style>
