<script lang="ts">
  // Dev only (ADR 0123): the rest of a tournament played out at random, from Manage, so its after-party can be tried
  // without scoring every match by hand. One question, then it plays (lib/simulation.ts), a move at a time, paced to
  // watch, paused or stopped from its floating control (lib/SimulationControl). The bootstrap says whether it's here
  // (`simulator`): never in production. A sheet on a phone, a side drawer on a desktop.
  import type { Tournament, TournamentType } from "../demo/model";
  import { simulation } from "../app/backend.svelte";
  import { formatDayDate, londonEvening, londonISO } from "./dates";
  import { phone } from "./viewport.svelte";
  import Sheet from "./Sheet.svelte";
  import Drawer from "./Drawer.svelte";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  let open = $state(false);
  // The after-party is on its evening only (lib/edition.ts atAfters)
  const notTonight = $derived(!tournament.season && tournament.heldOn !== londonEvening());
  const title = $derived(`Play out the ${type.shortName}`);

  export function start() {
    open = true;
  }
  function go() {
    open = false;
    void simulation.start(tournament.id);
  }
</script>

{#snippet ask()}
  <div class="confirm" role="alert">
    <p>
      Whatever's left, at random and by the rules: the order drawn and every pick made, then each match scored on the
      clock, goals and the odd penalty, the playoffs too. It stops at the after-party, the awards for you to confirm and
      reveal.
    </p>
    <p>A move at a time, slow enough to follow: pause it, speed it up or stop it from the bar it shows.</p>
    {#if notTonight}
      <p>
        Its after-party shows on its own evening, {formatDayDate(londonISO(tournament.heldOn, "12:00"))}: set its day to
        today first to see it now.
      </p>
    {/if}
    <p class="dev">Dev only. Never in production.</p>
    <div class="keys">
      <button class="btn ghost" onclick={() => (open = false)}>Not now</button>
      <button class="btn outline" onclick={go}>Play it out</button>
    </div>
  </div>
{/snippet}

{#if phone.current}
  <Sheet bind:open {title}>{@render ask()}</Sheet>
{:else}
  <Drawer bind:open {title} sub={`${type.shortName}: ${tournament.name}`}>{@render ask()}</Drawer>
{/if}

<style>
  .confirm {
    display: grid;
    gap: var(--s-4);
  }
  .confirm p {
    margin: 0;
    color: var(--fg-body);
  }
  .confirm .dev {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s-3);
  }
</style>
