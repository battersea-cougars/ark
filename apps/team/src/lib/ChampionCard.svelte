<script lang="ts">
  // The tournament's champions, once it's decided (lib/edition.ts championOf: the final's winner, or the top of the
  // table without playoffs). Not a card: the crest big, the trophy, the name in the display face, and how they won
  // it, on the page itself. The crest and name lead to the team.
  import { teamsOf } from "./tournament-teams";
  import type { Tournament, TournamentType } from "../demo/model";
  import Icon from "../app/shell/Icon.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { championOf, wonTheFinal } from "./edition";
  import { finalOf, pointsOf, table, teamIdsOf } from "./fixtures";
  import { teamHref } from "./team-tones";
  import Kanji from "./Kanji.svelte";
  import { kanjiFor } from "./motif";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  const teams = $derived(tournament.teams);
  const winnerId = $derived(championOf(tournament));
  const look = $derived(teamsOf(teams));
  const team = $derived(look.team(winnerId));
  // How they won it: the final's score, or their points at the top of the table
  const how = $derived.by(() => {
    const f = finalOf(tournament);
    if (f) return wonTheFinal(f, winnerId, look.nameOf);
    const top = table(teamIdsOf(tournament), tournament.games ?? [], pointsOf(tournament))[0];
    return top ? `Top of the table, ${top.pts} points from ${top.p}` : "";
  });
</script>

{#if team && winnerId}
  <section class="champ" aria-label="{type.shortName} champions">
    <a class="crest-link" href={teamHref(type.slug, winnerId)}>
      <TeamCrest {...look.crestOf(winnerId)} size="7rem" />
      <!-- The Kumite's victory seal, stamped on the crest's corner -->
      {#if kanjiFor(type, "champions")}<span class="stamp"><Kanji text={kanjiFor(type, "champions")} seal /></span>{/if}
    </a>
    <div class="words">
      <span class="eyebrow"><Icon name="trophy" size={18} />{type.shortName} champions</span>
      <a class="name display" href={teamHref(type.slug, winnerId)}>{look.nameOf(winnerId)}</a>
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
