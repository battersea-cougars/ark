<script lang="ts">
  // A tournament's full schedule (ADR 0061): every game in the day's order, the round robin then the playoffs (which
  // show their places, 1st v 2nd, until the table fills them in), each the same card as on the Kumite's home. Admins
  // make the fixtures (again, until a game has a result); goal by goal, with the clock, is live scoring.
  import { clock } from "../lib/dates";
  import EmptyState from "../lib/EmptyState.svelte";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import { makeFixtures } from "../app/backend.svelte";
  import { BREAK_MINUTES } from "../lib/fixtures";
  import { gameLength } from "../lib/periods";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import GameCard from "../lib/GameCard.svelte";
  import { listScroll } from "../lib/list-scroll";

  let { typeId }: { typeId: number } = $props();

  const perms = $derived(granted());
  const type = $derived(typeById(typeId)!);
  const tournament = $derived(currentTournament(typeId));
  const teams = $derived(tournament?.teams ?? []);
  const games = $derived(tournament?.games ?? []);
  // Two teams are enough to make the fixtures: a draft's captains are its teams before anyone's picked (ADR 0060)
  const teamsSet = $derived(!!tournament && teams.length >= 2);
  const hasResult = $derived(games.some((g) => g.homeGoals !== null));
  const manage = $derived(can(perms, "manage:Tournament"));
  // The day's games in two groups, each under its header: the round robin (its cards
  // needn't each say so), then the playoffs (each card keeps its name: Semi-final, Final)
  const groups = $derived.by(() => {
    const sorted = [...games].sort((a, b) => a.position - b.position);
    return [
      { name: "Round robin", games: sorted.filter((g) => g.stage !== "playoff") },
      { name: "Playoffs", games: sorted.filter((g) => g.stage === "playoff") },
    ].filter((x) => x.games.length);
  });
  // The group the box is showing: its header names it, swapping to Playoffs as their heading reaches the top
  let box = $state<HTMLElement | undefined>();
  let showing = $state(0);
  function track() {
    if (!box) return;
    const top = box.scrollTop + 1;
    let at = 0;
    box.querySelectorAll<HTMLElement>(".group").forEach((el, i) => {
      if (el.offsetTop <= top) at = i;
    });
    showing = at;
  }
  const then = $derived(
    tournament?.playoffs.length ? `, then ${tournament.playoffs.map((p) => p.name).join(" and ")}` : "",
  );
</script>

<div class="page">
  <TournamentHead {type} {tournament} title="Fight card" />

  {#if tournament && games.length}
    <div class="head">
      <p class="hint num">
        {gameLength(tournament)}, {BREAK_MINUTES} minutes between, from {clock(tournament.startTime)}
      </p>
      <span class="head-actions">
        {#if manage && !hasResult}
          <button class="btn ghost sm" onclick={() => makeFixtures(tournament.id)}>Make them again</button>
        {/if}
        <!-- The board isn't a step on the track (ADR 0074): it's a link from here and the front page -->
        <a class="btn ghost sm" href="/tournaments/{type.slug}/standings"><Icon name="list" size={16} />The board</a>
      </span>
    </div>
    <!-- Every game in the day's order, grouped by stage. One scroller, the page (lib/list-scroll.ts): it scrolls until
         the header reaches the top, then the cards pass in the box under it, never under a bar; the header names the
         group in view -->
    <div class="hybrid fight" use:listScroll>
      <div class="stuck">
        <div class="list-tabs group-bar">
          <h2 class="section-title group-head">{groups[showing]?.name ?? groups[0]?.name}</h2>
        </div>
        <div class="list-box" bind:this={box} onscroll={track}>
          {#each groups as group, i (group.name)}
            <section class="group" aria-label={group.name}>
              {#if i > 0}<h3 class="section-title group-head">{group.name}</h3>{/if}
              <div class="cards">
                {#each group.games as g (g.id)}<GameCard {tournament} game={g} grouped />{/each}
              </div>
            </section>
          {/each}
        </div>
      </div>
      <div class="list-spacer"></div>
    </div>
  {:else if tournament && teamsSet && manage}
    <div class="panel pad make">
      <p>{teams.length} teams. Make the fixtures: every team plays every other once{then}.</p>
      <button class="btn primary sm" onclick={() => makeFixtures(tournament.id)}>Make the fixtures</button>
    </div>
  {:else}
    <EmptyState icon={type.slug === "kumite" ? "gong" : "calendar"} title="No fight card yet">
      It's made once the teams are in: a round robin, {gameLength(tournament ?? type)}{then}.
    </EmptyState>
  {/if}
</div>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .head p {
    margin: 0;
  }
  .head-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .head-actions .btn {
    gap: var(--s-1);
  }
  /* The header of the stuck block (the table's own row, nothing passing behind it), then the groups in the box: a
     later group's heading scrolls up to meet it, and it takes that group's name (ADR 0065) */
  .group-bar {
    padding: var(--s-3) var(--s-4);
  }
  .group-head {
    margin: 0;
  }
  /* Room either side of the cards inside the glass, more on a wider screen */
  .list-box {
    padding-inline: var(--s-4);
  }
  /* Here the block is clear (each game is its own glass card), and the cards keep the glass the box's rule strips */
  .fight .stuck {
    background: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  .list-box :global(.game-card) {
    border-radius: var(--r-table);
    background: var(--glass);
  }
  /* A phone: the box is clear and each game is its own card, so the cards take the page's width and the names
     their room */
  @media (max-width: 600px) {
    .fight .list-box,
    .fight .group-bar {
      padding-inline: 0;
    }
  }
  @media (min-width: 901px) {
    .list-box {
      padding-inline: var(--s-6);
    }
    .group-bar {
      padding-inline: var(--s-6);
    }
  }
  .group {
    display: grid;
    gap: var(--s-3);
    padding-bottom: var(--s-3);
  }
  .group + .group {
    padding-top: var(--s-3);
  }
  .cards {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-3);
  }
  .make {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .make p {
    margin: 0;
  }
</style>
