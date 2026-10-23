<script lang="ts">
  // The awards once every one's out (ADR 0074): the champions the hero, their card big and ringed in brass (none
  // without them), then every other award a smaller card in a grid, face up, in the admin's order. The finished
  // Kumite's page (the after-party) shows it; the awards page's end too, its stage holding the hero (`hero` false).
  import type { Tournament, TournamentType } from "../demo/model";
  import AwardStage from "./AwardStage.svelte";
  import { isFinale, revealOf } from "./afters";
  import "./award-reveal.css";

  let { type, tournament: t, hero = true }: { type: TournamentType; tournament: Tournament; hero?: boolean } = $props();

  const awards = $derived(revealOf(t).awards);
  const championsAt = $derived(awards.findIndex((a) => isFinale(a)));
  const others = $derived(awards.map((a, i) => ({ a, i })).filter(({ i }) => i !== championsAt));
</script>

<div class="won award-reveal">
  {#if hero && championsAt >= 0}
    <div class="hero award-reveal finale">
      <AwardStage
        {type}
        tournament={t}
        award={awards[championsAt]}
        at={championsAt}
        count={awards.length}
        face="up"
        finale
      />
    </div>
  {/if}
  {#if others.length}
    <ol class="grid" aria-label="The awards">
      {#each others as { a, i } (a.name)}
        <li>
          <AwardStage {type} tournament={t} award={a} at={i} count={awards.length} face="up" finale={false} small />
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .won {
    --brass: #d9a84e;
    --brass-ink: #f0c879;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-5);
  }
  /* The champions' card in a room its size, centred, as on the awards' stage */
  .hero {
    display: grid;
    place-items: center;
    width: min(100%, 32rem);
    height: 22rem;
    margin-inline: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    gap: var(--s-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .grid li {
    display: grid;
  }
</style>
