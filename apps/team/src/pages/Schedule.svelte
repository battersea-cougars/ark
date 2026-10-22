<script lang="ts">
  // The matches of a tournament's page (ADR 0074, 0061), in its Fixtures set and KUMITE! views: every match in the
  // day's order as a carousel, the one that matters now in front (lib/MatchCarousel). Teams that enter, all in: the
  // Make the fixtures card for whoever runs it. Made again from Manage, until a match has a result.
  import EmptyState from "../lib/EmptyState.svelte";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import { makeFixtures } from "../app/backend.svelte";
  import { gameLength } from "../lib/periods";
  import MatchCarousel from "../lib/MatchCarousel.svelte";
  import GameCard from "../lib/GameCard.svelte";
  import { prefersReducedMotion } from "../app/motion";
  import { backOut } from "svelte/easing";
  import DraftStep from "../lib/DraftStep.svelte";

  let {
    typeId,
    carousel = false,
    deal = false,
  }: {
    typeId: number;
    /** The day, while it runs: the matches as a carousel, the one on now in front; before then, a plain list. */
    carousel?: boolean;
    /** The fixtures just made while watching: the cards are dealt in, one by one, in order. */
    deal?: boolean;
  } = $props();
  // Dealt in: each a little after the last, up a touch and fading in, a tiny settle. In place from the start (no
  // shift), only the look moves; less motion, or opened later, they're just there
  const dealIn = (_node: Element, { i }: { i: number }) => ({
    delay: deal && !prefersReducedMotion ? 300 + i * 70 : 0,
    duration: deal && !prefersReducedMotion ? 380 : 0,
    easing: backOut,
    css: (t: number, u: number) => `transform: translateY(${u * 14}px); opacity: ${Math.min(1, t * 1.4)}`,
  });

  const perms = $derived(granted());
  const type = $derived(typeById(typeId)!);
  const tournament = $derived(currentTournament(typeId));
  const teams = $derived(tournament?.teams ?? []);
  const games = $derived(tournament?.games ?? []);
  // Two teams are enough to make the fixtures: a draft's captains are its teams before anyone's picked (ADR 0060)
  const teamsSet = $derived(!!tournament && teams.length >= 2);
  const manage = $derived(can(perms, "manage:Tournament"));
  const then = $derived(
    tournament?.playoffs.length ? `, then ${tournament.playoffs.map((p) => p.name).join(" and ")}` : "",
  );
</script>

{#if tournament && games.length}
  <div class="fixtures">
    {#if carousel}
      <!-- The day: every match in order, the one that matters now brought forward (lib/MatchCarousel) -->
      <MatchCarousel {tournament} />
    {:else}
      <!-- Before the day: a plain list in the order of play, the first wearing You are next! -->
      <div class="cards">
        {#each [...games].sort((a, b) => a.position - b.position) as g, i (g.id)}<div in:dealIn|global={{ i }}>
            <GameCard {tournament} game={g} />
          </div>{/each}
      </div>
    {/if}
  </div>
{:else if tournament && teamsSet}
  <!-- The teams are in: the one step left, for whoever runs it; everyone else sees it coming -->
  <DraftStep {type} mark="fights" title="Make the fixtures">
    {teams.length} teams: every team plays every other once{then}.
    {#if !manage}Out soon.{/if}
    {#snippet action()}
      {#if manage}<button class="btn primary" onclick={() => makeFixtures(tournament.id)}>Make the fixtures</button
        >{/if}
    {/snippet}
  </DraftStep>
{:else}
  <EmptyState icon={type.slug === "kumite" ? "gong" : "calendar"} title="No fixtures yet">
    They're made once the teams are in: a round robin, {gameLength(tournament ?? type)}{then}.
  </EmptyState>
{/if}

<style>
  .cards {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-6);
    padding-top: var(--s-3);
  }
  .fixtures {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-5);
  }
</style>
