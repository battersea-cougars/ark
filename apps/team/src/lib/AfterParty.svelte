<script lang="ts">
  // The after-party (ADR 0074): the evening a tournament ends, its last status. Everyone's at the afterwards (the
  // Kumite's The Anchor), so the page is the pub after the film's last match: warm brass on the carbon, the Kumite's
  // motif kept. Where everyone is; the awards, a big card to their own page (pages/Awards, the stage where they're
  // revealed one at a time), with everyone who played voting on it and whoever runs it confirming them on it too
  // (lib/AwardsEntry, ADR 0044); every one out, the awards themselves instead, the champions the hero and the rest in
  // a grid (lib/AwardsWon): the finished Kumite's page. Then the final table (the champions first) and the day's
  // results, one line each.
  import type { Tournament, TournamentType } from "../demo/model";
  import type { After } from "@cougars/shared/places";
  import Icon from "../app/shell/Icon.svelte";
  import AwardsEntry from "./AwardsEntry.svelte";
  import AwardsWon from "./AwardsWon.svelte";
  import { revealOf } from "./afters";
  import FinalResults from "./FinalResults.svelte";
  import { afterNoteWords } from "./tournament-front";
  import { clock } from "./dates";

  let {
    type,
    tournament: t,
    after,
    manage,
  }: {
    type: TournamentType;
    tournament: Tournament;
    /** Where everyone is: the afterwards, or none this time. */
    after: After | null;
    /** Whoever runs it (manage:Tournament): the reveal is theirs. */
    manage: boolean;
  } = $props();

  const sub = $derived(
    after
      ? [afterNoteWords(after.note) || "celebration and awards", after.time && `from ${clock(after.time)}`]
          .filter(Boolean)
          .join(" · ")
      : "",
  );
</script>

<div class="afters">
  <!-- Where everyone is now: the place big, what for, the map -->
  <section class="part pub">
    <span class="eyebrow">Now</span>
    <div class="pub-body">
      <span class="pub-place display"
        ><Icon name="glass" size={24} />{after?.name ?? `After the ${type.shortName}`}</span
      >
      <span class="pub-sub">{sub || "Everyone's done. Get a round in."}</span>
      {#if after}
        <a class="btn sm outline" href={after.mapUrl} target="_blank" rel="noopener noreferrer"
          ><Icon name="pin" size={16} />Map</a
        >
      {/if}
    </div>
  </section>

  {#if revealOf(t).all}
    <!-- Every award out: the finished Kumite's page shows them, the champions the hero, the rest in a grid -->
    <AwardsWon {type} tournament={t} />
  {:else}
    <!-- The awards: voted and confirmed here, on one card, revealed on their own page, the stage -->
    <AwardsEntry {type} tournament={t} {manage} />
  {/if}

  <!-- The final table (the champions first), then the day's results -->
  <FinalResults {type} tournament={t} />
</div>

<style>
  /* The pub after the last fight: brass on the carbon, a warm glow over the top of the view in place of the red */
  .afters {
    --brass: #d9a84e;
    --brass-ink: #f0c879;
    --brass-wash: color-mix(in srgb, var(--brass) 10%, transparent);
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-6);
  }
  /* The glow fades to nothing inside its own box on every side (the mask), and the box stays inside the page's
     sides (.view clips across), so it reads as warm light with no edge on a phone or a desktop */
  .afters::before {
    position: absolute;
    inset: -4rem -1rem auto;
    z-index: -1;
    height: 26rem;
    background: radial-gradient(60% 55% at 32% 40%, color-mix(in srgb, var(--brass) 15%, transparent), transparent 75%);
    content: "";
    pointer-events: none;
    mask-image: radial-gradient(closest-side, #000 55%, transparent);
  }
  .part {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-3);
  }
  /* Where everyone is: on the page, no panel */
  .pub {
    gap: var(--s-1);
  }
  .pub .eyebrow {
    color: var(--brass-ink);
  }
  .pub-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-1) var(--s-4);
  }
  .pub-place {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    color: var(--fg);
    font-size: clamp(1.9rem, 6vw, 2.6rem);
    line-height: 1;
  }
  .pub-place :global(svg) {
    flex: none;
    color: var(--brass);
  }
  .pub-sub {
    grid-column: 1;
    color: var(--fg-muted);
  }
  .pub-body .btn {
    grid-row: 1 / span 2;
    grid-column: 2;
    gap: var(--s-1);
  }
</style>
